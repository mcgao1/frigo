/**
 * Exploration module (Developer B — game / progression).
 *
 * The fridge's surroundings are a small map of areas. Each day the player gets a
 * budget of exploration energy (regenerated against the clock). Spending energy
 * explores a site in an unlocked area and yields a coin find; locked areas are
 * opened by paying coins. Progress (unlocked areas, discovered sites, energy) is
 * persisted.
 *
 * Game-side logic only. A's domains are reached strictly through the injected
 * ports in ./ports.js — exploration never imports food / economy / infrastructure.
 *
 * @typedef {import("./ports.js").ExplorationDeps} ExplorationDeps
 */

export const DEFAULT_STORAGE_KEY = "game.exploration";
export const DEFAULT_MAX_ENERGY = 3;

/**
 * Default map. An area with `unlockCost` 0 starts unlocked. Each `site` is
 * discoverable once and credits `coins` when found. Game-design data (movable to
 * app/src/config/ later by agreement).
 */
export const DEFAULT_MAP = [
  {
    id: "pantry",
    name: "Pantry",
    unlockCost: 0,
    sites: [
      { id: "pantry-1", name: "Dusty shelf", coins: 30 },
      { id: "pantry-2", name: "Back corner", coins: 50 },
    ],
  },
  {
    id: "cellar",
    name: "Cellar",
    unlockCost: 100,
    sites: [
      { id: "cellar-1", name: "Cold rack", coins: 80 },
      { id: "cellar-2", name: "Hidden crate", coins: 120 },
    ],
  },
  {
    id: "attic",
    name: "Attic",
    unlockCost: 250,
    sites: [{ id: "attic-1", name: "Old trunk", coins: 200 }],
  },
];

export const ExplorationErrorCode = Object.freeze({
  UNKNOWN_AREA: "UNKNOWN_AREA",
  AREA_LOCKED: "AREA_LOCKED",
  ALREADY_UNLOCKED: "ALREADY_UNLOCKED",
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  TRANSACTION_FAILED: "TRANSACTION_FAILED",
  NO_ENERGY: "NO_ENERGY",
  AREA_EXHAUSTED: "AREA_EXHAUSTED",
});

export class ExplorationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ExplorationError";
    this.code = code;
    this.details = details;
  }
}

function toISODate(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/**
 * @param {ExplorationDeps} deps
 * @param {{ map?: typeof DEFAULT_MAP, storageKey?: string, maxEnergy?: number }} [options]
 */
export function createExplorationModule(deps, options = {}) {
  const { wallet, transaction, gameStorage, clock } = deps ?? {};
  if (!wallet || typeof wallet.getBalance !== "function") {
    throw new TypeError("exploration: deps.wallet.getBalance is required");
  }
  if (!transaction || typeof transaction.execute !== "function") {
    throw new TypeError("exploration: deps.transaction.execute is required");
  }
  if (!gameStorage || typeof gameStorage.load !== "function" || typeof gameStorage.save !== "function") {
    throw new TypeError("exploration: deps.gameStorage.load/save are required");
  }
  if (!clock || typeof clock.getLocalDate !== "function") {
    throw new TypeError("exploration: deps.clock.getLocalDate is required");
  }

  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const maxEnergy = options.maxEnergy ?? DEFAULT_MAX_ENERGY;
  const map = (options.map ?? DEFAULT_MAP).map((a) => ({ ...a, sites: a.sites.map((s) => ({ ...s })) }));
  const areaById = new Map(map.map((a) => [a.id, a]));

  /** @type {{ unlocked: string[], discovered: string[], energy: { value: number, date: string | null } }} */
  let state = { unlocked: [], discovered: [], energy: { value: maxEnergy, date: null } };

  async function persist() {
    await gameStorage.save({ key: storageKey, ...state });
  }

  function ensureStartingUnlocks() {
    for (const area of map) {
      if (area.unlockCost === 0 && !state.unlocked.includes(area.id)) {
        state.unlocked.push(area.id);
      }
    }
  }

  async function today() {
    return toISODate(await clock.getLocalDate());
  }

  /** Refill energy to max when the local date has rolled over. */
  async function refillEnergy() {
    const now = await today();
    if (state.energy.date !== now) {
      state.energy = { value: maxEnergy, date: now };
    }
    return state.energy;
  }

  async function init() {
    const loaded = await gameStorage.load(storageKey);
    if (loaded && typeof loaded === "object") {
      state = {
        unlocked: Array.isArray(loaded.unlocked) ? [...loaded.unlocked] : [],
        discovered: Array.isArray(loaded.discovered) ? [...loaded.discovered] : [],
        energy: loaded.energy && typeof loaded.energy === "object"
          ? { value: loaded.energy.value ?? maxEnergy, date: loaded.energy.date ?? null }
          : { value: maxEnergy, date: null },
      };
    } else {
      state = { unlocked: [], discovered: [], energy: { value: maxEnergy, date: null } };
    }
    ensureStartingUnlocks();
    await refillEnergy();
    await persist();
    return getState();
  }

  function isUnlocked(areaId) {
    return state.unlocked.includes(areaId);
  }

  function undiscoveredSites(area) {
    return area.sites.filter((s) => !state.discovered.includes(s.id));
  }

  function listAreas(balance = Infinity) {
    return map.map((a) => ({
      id: a.id,
      name: a.name,
      unlockCost: a.unlockCost,
      unlocked: isUnlocked(a.id),
      affordableToUnlock: !isUnlocked(a.id) && balance >= a.unlockCost,
      sitesTotal: a.sites.length,
      sitesFound: a.sites.filter((s) => state.discovered.includes(s.id)).length,
    }));
  }

  async function getEnergy() {
    await refillEnergy();
    return { value: state.energy.value, max: maxEnergy, date: state.energy.date };
  }

  function getState() {
    return {
      unlocked: [...state.unlocked],
      discovered: [...state.discovered],
      energy: { ...state.energy },
    };
  }

  /** Pay coins to unlock an area. */
  async function unlock(areaId) {
    const area = areaById.get(areaId);
    if (!area) {
      throw new ExplorationError(ExplorationErrorCode.UNKNOWN_AREA, `Unknown area: ${areaId}`, { areaId });
    }
    if (isUnlocked(areaId)) {
      throw new ExplorationError(ExplorationErrorCode.ALREADY_UNLOCKED, `Already unlocked: ${areaId}`, { areaId });
    }

    const balance = await wallet.getBalance();
    if (balance < area.unlockCost) {
      throw new ExplorationError(ExplorationErrorCode.INSUFFICIENT_FUNDS, `Need ${area.unlockCost}, have ${balance}`, {
        areaId, cost: area.unlockCost, balance,
      });
    }

    const result = await transaction.execute({ amount: area.unlockCost, kind: "debit", reason: `exploration:unlock:${areaId}` });
    if (!result || result.ok !== true) {
      throw new ExplorationError(ExplorationErrorCode.TRANSACTION_FAILED, `Unlock transaction failed for ${areaId}`, { areaId, result });
    }

    state.unlocked.push(areaId);
    await persist();
    return { ok: true, areaId, balance: result.balance };
  }

  /** Spend one energy to discover the next site in an unlocked area. */
  async function explore(areaId) {
    const area = areaById.get(areaId);
    if (!area) {
      throw new ExplorationError(ExplorationErrorCode.UNKNOWN_AREA, `Unknown area: ${areaId}`, { areaId });
    }
    if (!isUnlocked(areaId)) {
      throw new ExplorationError(ExplorationErrorCode.AREA_LOCKED, `Area is locked: ${areaId}`, { areaId });
    }

    await refillEnergy();
    if (state.energy.value < 1) {
      throw new ExplorationError(ExplorationErrorCode.NO_ENERGY, "Out of exploration energy", {
        areaId, nextRefill: "next local date",
      });
    }

    const remaining = undiscoveredSites(area);
    if (remaining.length === 0) {
      throw new ExplorationError(ExplorationErrorCode.AREA_EXHAUSTED, `Nothing left to find in ${areaId}`, { areaId });
    }

    const site = remaining[0];
    const result = await transaction.execute({ amount: site.coins, kind: "credit", reason: `exploration:find:${site.id}` });
    if (!result || result.ok !== true) {
      throw new ExplorationError(ExplorationErrorCode.TRANSACTION_FAILED, `Reward credit failed for ${site.id}`, { site: site.id, result });
    }

    state.energy.value -= 1;
    state.discovered.push(site.id);
    await persist();
    return {
      ok: true,
      area: areaId,
      site: { id: site.id, name: site.name, coins: site.coins },
      energy: state.energy.value,
      balance: result.balance,
    };
  }

  return { init, listAreas, getEnergy, getState, unlock, explore, isUnlocked, storageKey, maxEnergy };
}
