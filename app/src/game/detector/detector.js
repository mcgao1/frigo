/**
 * Detector module (Developer B — game / progression).
 *
 * The freshness detector scans the fridge's food and reports each item's
 * condition. How much detail it reveals depends on the detector's level, which
 * the player can upgrade by spending wallet funds. Scans refresh automatically
 * when food changes, and the detector level + last scan are persisted.
 *
 * Game-side logic only. A's domains are reached strictly through the injected
 * ports in ./ports.js — detector never imports food / economy / infrastructure.
 *
 * @typedef {import("./ports.js").DetectorDeps} DetectorDeps
 * @typedef {import("./ports.js").FoodItem} FoodItem
 */

export const DEFAULT_STORAGE_KEY = "game.detector";

/**
 * Detector levels: what each reveals, and the cost to upgrade INTO it.
 * Costs are game-design data (movable to app/src/config/ later by agreement).
 * Level 1 is free (the starting detector).
 */
export const DEFAULT_LEVELS = [
  { level: 1, reveals: ["status"], upgradeCost: 0 },
  { level: 2, reveals: ["status", "daysLeft"], upgradeCost: 50 },
  { level: 3, reveals: ["status", "daysLeft", "freshnessPct"], upgradeCost: 150 },
];

export const DetectorErrorCode = Object.freeze({
  MAX_LEVEL: "MAX_LEVEL",
  UPGRADE_UNAVAILABLE: "UPGRADE_UNAVAILABLE",
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  TRANSACTION_FAILED: "TRANSACTION_FAILED",
});

export class DetectorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DetectorError";
    this.code = code;
    this.details = details;
  }
}

function toISODate(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/** Whole days from `fromISO` to `toISO` (negative = already past). */
function daysBetween(fromISO, toISO) {
  if (!fromISO || !toISO) return null;
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** Bucket an item into a coarse status from freshness and/or daysLeft. */
function statusOf(freshness, daysLeft) {
  if (typeof freshness === "number") {
    if (freshness <= 0) return "spoiled";
    if (freshness < 0.3) return "spoiled";
    if (freshness < 0.6) return "aging";
    return "fresh";
  }
  if (typeof daysLeft === "number") {
    if (daysLeft < 0) return "spoiled";
    if (daysLeft <= 2) return "aging";
    return "fresh";
  }
  return "unknown";
}

/**
 * @param {DetectorDeps} deps
 * @param {{ levels?: typeof DEFAULT_LEVELS, storageKey?: string }} [options]
 */
export function createDetectorModule(deps, options = {}) {
  const { food, gameStorage, clock, wallet, transaction } = deps ?? {};
  if (!food || typeof food.getSnapshot !== "function") {
    throw new TypeError("detector: deps.food.getSnapshot is required");
  }
  if (!gameStorage || typeof gameStorage.load !== "function" || typeof gameStorage.save !== "function") {
    throw new TypeError("detector: deps.gameStorage.load/save are required");
  }

  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const levels = (options.levels ?? DEFAULT_LEVELS).map((l) => ({ ...l }));
  const maxLevel = Math.max(...levels.map((l) => l.level));
  const levelByNumber = new Map(levels.map((l) => [l.level, l]));

  let level = 1;
  /** @type {null | { at: string | null, readings: object[] }} */
  let lastScan = null;
  let unsubscribe = null;
  let stale = true;

  async function persist() {
    await gameStorage.save({ key: storageKey, level, lastScan });
  }

  /** Load persisted level + last scan, and subscribe to food events. */
  async function init() {
    const loaded = await gameStorage.load(storageKey);
    if (loaded && typeof loaded === "object") {
      if (levelByNumber.has(loaded.level)) level = loaded.level;
      lastScan = loaded.lastScan ?? null;
    }
    stale = lastScan == null;

    if (typeof food.subscribeEvents === "function" && !unsubscribe) {
      unsubscribe = food.subscribeEvents(() => {
        stale = true; // next scan() will re-read; callers can watch isStale()
      });
    }
    return { level, lastScan };
  }

  function reveals(key) {
    return levelByNumber.get(level)?.reveals.includes(key) ?? false;
  }

  function readItem(item, todayISO) {
    const daysLeft = reveals("daysLeft") ? daysBetween(todayISO, item.spoilsOn) : null;
    const status = statusOf(item.freshness, daysBetween(todayISO, item.spoilsOn));
    /** @type {{id:string,name:string,status:string,daysLeft?:number,freshnessPct?:number}} */
    const reading = { id: item.id, name: item.name ?? item.id, status };
    if (reveals("daysLeft") && daysLeft != null) reading.daysLeft = daysLeft;
    if (reveals("freshnessPct") && typeof item.freshness === "number") {
      reading.freshnessPct = Math.max(0, Math.min(100, Math.round(item.freshness * 100)));
    }
    return reading;
  }

  /** Scan the current food snapshot and return readings at the current level. */
  async function scan() {
    const snapshot = (await food.getSnapshot()) ?? {};
    const items = Array.isArray(snapshot.items) ? snapshot.items : [];
    const todayISO = toISODate(clock ? await clock.getLocalDate() : null);
    const readings = items.map((it) => readItem(it, todayISO));
    lastScan = { at: todayISO, readings };
    stale = false;
    await persist();
    return { level, at: todayISO, readings };
  }

  function getLevel() {
    return level;
  }

  function isStale() {
    return stale;
  }

  function getLastScan() {
    return lastScan ? { ...lastScan, readings: lastScan.readings.map((r) => ({ ...r })) } : null;
  }

  function nextUpgrade() {
    return levelByNumber.get(level + 1) ?? null;
  }

  /** Spend wallet funds to raise the detector level by one. */
  async function upgrade() {
    const next = nextUpgrade();
    if (!next) {
      throw new DetectorError(DetectorErrorCode.MAX_LEVEL, `Already at max level ${maxLevel}`, { level });
    }
    if (!wallet || typeof wallet.getBalance !== "function" || !transaction || typeof transaction.execute !== "function") {
      throw new DetectorError(
        DetectorErrorCode.UPGRADE_UNAVAILABLE,
        "Upgrading needs deps.wallet + deps.transaction",
        { level },
      );
    }

    const balance = await wallet.getBalance();
    if (balance < next.upgradeCost) {
      throw new DetectorError(
        DetectorErrorCode.INSUFFICIENT_FUNDS,
        `Need ${next.upgradeCost}, have ${balance}`,
        { level, cost: next.upgradeCost, balance },
      );
    }

    const result = await transaction.execute({
      amount: next.upgradeCost,
      kind: "debit",
      reason: `detector:upgrade:${next.level}`,
    });
    if (!result || result.ok !== true) {
      throw new DetectorError(DetectorErrorCode.TRANSACTION_FAILED, `Upgrade transaction failed`, { level, result });
    }

    level = next.level;
    stale = true; // existing scan was taken at the old level
    await persist();
    return { ok: true, level, balance: result.balance };
  }

  /** Stop listening to food events. */
  function dispose() {
    if (typeof unsubscribe === "function") unsubscribe();
    unsubscribe = null;
  }

  return {
    init, scan, upgrade, getLevel, getLastScan, isStale, nextUpgrade, dispose,
    maxLevel, storageKey,
  };
}
