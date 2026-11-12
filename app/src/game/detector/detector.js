/**
 * Detector module (Developer B — game / progression).
 *
 * The freshness detector is a MAINLINE beat, not a shop upgrade. It is acquired
 * in three steps:
 *   1. USE DAYS — every day the player actually uses the app counts as one
 *      "valid use day" (B derives this from the clock; distinct dates only).
 *      On the 3rd valid use day the detector becomes diggable (the game fires a
 *      letter at the same moment — that wiring lives outside this module).
 *   2. DIG — the player digs the buried detector up next to the fridge. Free.
 *   3. REPAIR — the dug-up detector is broken; repairing it costs a flat
 *      `repairCost` GP. Only a repaired detector can SCAN the food.
 *
 * Acquisition state (use days, found, repaired) and the last scan are persisted.
 *
 * Game-side logic only. A's domains are reached strictly through the injected
 * ports in ./ports.js — detector never imports food / economy / infrastructure.
 *
 * @typedef {import("./ports.js").DetectorDeps} DetectorDeps
 * @typedef {import("./ports.js").FoodItem} FoodItem
 */

export const DEFAULT_STORAGE_KEY = "game.detector";

/** Valid use days before the detector can be dug up (the day the letter comes). */
export const DETECTOR_USE_DAYS = 3;

/** Flat GP cost to repair the dug-up detector. */
export const DETECTOR_REPAIR_COST = 10;

/** What a repaired detector reveals per item. (Single tier — no paid levels.) */
export const DEFAULT_REVEALS = ["status", "daysLeft"];

export const DetectorErrorCode = Object.freeze({
  NOT_READY_TO_DIG: "NOT_READY_TO_DIG",
  ALREADY_FOUND: "ALREADY_FOUND",
  NOT_FOUND: "NOT_FOUND",
  ALREADY_REPAIRED: "ALREADY_REPAIRED",
  REPAIR_UNAVAILABLE: "REPAIR_UNAVAILABLE",
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  TRANSACTION_FAILED: "TRANSACTION_FAILED",
  NOT_REPAIRED: "NOT_REPAIRED",
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
 * @param {{ storageKey?: string, useDaysToDig?: number, repairCost?: number,
 *           reveals?: string[] }} [options]
 */
export function createDetectorModule(deps, options = {}) {
  const { food, gameStorage, clock, wallet, transaction } = deps ?? {};
  if (!food || typeof food.getSnapshot !== "function") {
    throw new TypeError("detector: deps.food.getSnapshot is required");
  }
  if (!gameStorage || typeof gameStorage.load !== "function" || typeof gameStorage.save !== "function") {
    throw new TypeError("detector: deps.gameStorage.load/save are required");
  }
  if (!clock || typeof clock.getLocalDate !== "function") {
    throw new TypeError("detector: deps.clock.getLocalDate is required");
  }

  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const threshold = options.useDaysToDig ?? DETECTOR_USE_DAYS;
  const repairCost = options.repairCost ?? DETECTOR_REPAIR_COST;
  const reveals = new Set(options.reveals ?? DEFAULT_REVEALS);

  /** @type {{ useDayCount: number, lastUseDate: string|null, foundAt: string|null, repairedAt: string|null }} */
  let state = { useDayCount: 0, lastUseDate: null, foundAt: null, repairedAt: null };
  /** @type {null | { at: string | null, readings: object[] }} */
  let lastScan = null;
  let unsubscribe = null;
  let stale = true;

  async function today() {
    return toISODate(await clock.getLocalDate());
  }

  async function persist() {
    await gameStorage.save({ key: storageKey, ...state, lastScan });
  }

  /** Load persisted progress + last scan, and subscribe to food events. */
  async function init() {
    const loaded = await gameStorage.load(storageKey);
    if (loaded && typeof loaded === "object") {
      state = {
        useDayCount: Number.isFinite(loaded.useDayCount) ? loaded.useDayCount : 0,
        lastUseDate: loaded.lastUseDate ?? null,
        foundAt: loaded.foundAt ?? null,
        repairedAt: loaded.repairedAt ?? null,
      };
      lastScan = loaded.lastScan ?? null;
    }
    stale = lastScan == null;

    if (typeof food.subscribeEvents === "function" && !unsubscribe) {
      unsubscribe = food.subscribeEvents(() => {
        stale = true; // next scan() re-reads; callers can watch isStale()
      });
    }
    return progressOf();
  }

  const isFound = () => Boolean(state.foundAt);
  const isRepaired = () => Boolean(state.repairedAt);
  const isDigReady = () => state.useDayCount >= threshold && !isFound();

  function progressOf(extra = {}) {
    return {
      useDays: state.useDayCount,
      threshold,
      found: isFound(),
      repaired: isRepaired(),
      digReady: isDigReady(),
      complete: isRepaired(),
      repairCost,
      ...extra,
    };
  }

  /**
   * Record a valid use day. Counts distinct local dates only, so calling it
   * several times in one day is harmless. Returns the use-day tally plus
   * `justReady` — true on the single call that first reaches the threshold
   * (used to fire the "come dig the detector up" letter exactly once).
   * @param {string|Date} [dateOverride]
   */
  async function recordUseDay(dateOverride) {
    const todayISO = toISODate(dateOverride ?? (await clock.getLocalDate()));
    const wasReady = state.useDayCount >= threshold;
    if (todayISO && todayISO !== state.lastUseDate) {
      state.lastUseDate = todayISO;
      state.useDayCount += 1;
      await persist();
    }
    const nowReady = state.useDayCount >= threshold;
    return progressOf({ justReady: !wasReady && nowReady && !isFound() });
  }

  /** Dig the buried detector up next to the fridge (free). */
  async function dig(dateOverride) {
    if (isFound()) {
      throw new DetectorError(DetectorErrorCode.ALREADY_FOUND, "Detector already dug up", {});
    }
    if (state.useDayCount < threshold) {
      throw new DetectorError(
        DetectorErrorCode.NOT_READY_TO_DIG,
        `Need ${threshold} use days, have ${state.useDayCount}`,
        { useDays: state.useDayCount, threshold },
      );
    }
    state.foundAt = toISODate(dateOverride ?? (await clock.getLocalDate()));
    await persist();
    return { ok: true, foundAt: state.foundAt };
  }

  /** Repair the dug-up detector (costs `repairCost` GP). */
  async function repair() {
    if (!isFound()) {
      throw new DetectorError(DetectorErrorCode.NOT_FOUND, "Dig the detector up first", {});
    }
    if (isRepaired()) {
      throw new DetectorError(DetectorErrorCode.ALREADY_REPAIRED, "Detector already repaired", {});
    }
    if (!wallet || typeof wallet.getBalance !== "function" || !transaction || typeof transaction.execute !== "function") {
      throw new DetectorError(DetectorErrorCode.REPAIR_UNAVAILABLE, "Repairing needs deps.wallet + deps.transaction", {});
    }

    const balance = await wallet.getBalance();
    if (balance < repairCost) {
      throw new DetectorError(
        DetectorErrorCode.INSUFFICIENT_FUNDS,
        `Need ${repairCost}, have ${balance}`,
        { cost: repairCost, balance },
      );
    }

    const result = await transaction.execute({ amount: repairCost, kind: "debit", reason: "detector:repair" });
    if (!result || result.ok !== true) {
      throw new DetectorError(DetectorErrorCode.TRANSACTION_FAILED, "Repair transaction failed", { result });
    }

    state.repairedAt = toISODate(await clock.getLocalDate());
    await persist();
    return { ok: true, balance: result.balance, repairedAt: state.repairedAt };
  }

  function readItem(item, todayISO) {
    const daysLeft = daysBetween(todayISO, item.spoilsOn);
    const status = statusOf(item.freshness, daysLeft);
    /** @type {{id:string,name:string,status:string,daysLeft?:number,freshnessPct?:number}} */
    const reading = { id: item.id, name: item.name ?? item.id, status };
    if (reveals.has("daysLeft") && daysLeft != null) reading.daysLeft = daysLeft;
    if (reveals.has("freshnessPct") && typeof item.freshness === "number") {
      reading.freshnessPct = Math.max(0, Math.min(100, Math.round(item.freshness * 100)));
    }
    return reading;
  }

  /** Scan the current food snapshot. Requires a repaired detector. */
  async function scan() {
    if (!isRepaired()) {
      throw new DetectorError(DetectorErrorCode.NOT_REPAIRED, "Repair the detector before scanning", {});
    }
    const snapshot = (await food.getSnapshot()) ?? {};
    const items = Array.isArray(snapshot.items) ? snapshot.items : [];
    const todayISO = await today();
    const readings = items.map((it) => readItem(it, todayISO));
    lastScan = { at: todayISO, readings };
    stale = false;
    await persist();
    return { at: todayISO, readings };
  }

  function getProgress() {
    return progressOf();
  }
  function getUseDays() {
    return state.useDayCount;
  }
  function isStale() {
    return stale;
  }
  function getLastScan() {
    return lastScan ? { ...lastScan, readings: lastScan.readings.map((r) => ({ ...r })) } : null;
  }

  /** Stop listening to food events. */
  function dispose() {
    if (typeof unsubscribe === "function") unsubscribe();
    unsubscribe = null;
  }

  return {
    init, recordUseDay, dig, repair, scan,
    getProgress, getUseDays, getLastScan, isStale,
    isFound, isRepaired, isDigReady, dispose,
    repairCost, threshold, storageKey,
  };
}
