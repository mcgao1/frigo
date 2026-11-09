/**
 * Voyage module (Developer B — game / progression).
 *
 * The fridge sets out on timed expeditions. The player pays to launch a route;
 * the voyage takes a number of in-game days (tracked against the clock) and,
 * once it returns, the player claims a coin reward. One voyage runs at a time;
 * the active voyage and past voyages are persisted.
 *
 * Game-side logic only. A's domains are reached strictly through the injected
 * ports in ./ports.js — voyage never imports food / economy / infrastructure.
 *
 * @typedef {import("./ports.js").VoyageDeps} VoyageDeps
 */

export const DEFAULT_STORAGE_KEY = "game.voyage";

/**
 * Default routes. `cost` is debited at launch, `durationDays` is how long the
 * voyage runs, `reward` is the coin range credited on claim. Game-design data
 * (movable to app/src/config/ later by agreement).
 */
export const DEFAULT_ROUTES = [
  { id: "coastal", name: "Coastal run", cost: 30, durationDays: 1, reward: { min: 40, max: 80 } },
  { id: "deep_sea", name: "Deep sea", cost: 80, durationDays: 3, reward: { min: 120, max: 220 } },
  { id: "arctic", name: "Arctic passage", cost: 200, durationDays: 7, reward: { min: 400, max: 700 } },
];

export const VoyageErrorCode = Object.freeze({
  UNKNOWN_ROUTE: "UNKNOWN_ROUTE",
  VOYAGE_IN_PROGRESS: "VOYAGE_IN_PROGRESS",
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  TRANSACTION_FAILED: "TRANSACTION_FAILED",
  NO_ACTIVE_VOYAGE: "NO_ACTIVE_VOYAGE",
  NOT_RETURNED: "NOT_RETURNED",
});

export class VoyageError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "VoyageError";
    this.code = code;
    this.details = details;
  }
}

function toISODate(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

function addDays(iso, n) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
}

/** Whole days from `fromISO` to `toISO` (negative = past). */
function daysBetween(fromISO, toISO) {
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

function rollReward(reward, rng) {
  if (typeof reward === "number") return reward;
  const { min, max } = reward;
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * @param {VoyageDeps} deps
 * @param {{ routes?: typeof DEFAULT_ROUTES, storageKey?: string, rng?: () => number }} [options]
 */
export function createVoyageModule(deps, options = {}) {
  const { wallet, transaction, gameStorage, clock } = deps ?? {};
  if (!wallet || typeof wallet.getBalance !== "function") {
    throw new TypeError("voyage: deps.wallet.getBalance is required");
  }
  if (!transaction || typeof transaction.execute !== "function") {
    throw new TypeError("voyage: deps.transaction.execute is required");
  }
  if (!gameStorage || typeof gameStorage.load !== "function" || typeof gameStorage.save !== "function") {
    throw new TypeError("voyage: deps.gameStorage.load/save are required");
  }
  if (!clock || typeof clock.getLocalDate !== "function") {
    throw new TypeError("voyage: deps.clock.getLocalDate is required");
  }

  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const rng = options.rng ?? Math.random;
  const routes = (options.routes ?? DEFAULT_ROUTES).map((r) => ({ ...r }));
  const byId = new Map(routes.map((r) => [r.id, r]));

  /** @type {{ active: null | object, history: object[] }} */
  let state = { active: null, history: [] };

  async function persist() {
    await gameStorage.save({ key: storageKey, active: state.active, history: state.history });
  }

  async function init() {
    const loaded = await gameStorage.load(storageKey);
    if (loaded && typeof loaded === "object") {
      state = {
        active: loaded.active ?? null,
        history: Array.isArray(loaded.history) ? loaded.history : [],
      };
    } else {
      state = { active: null, history: [] };
    }
    return getState();
  }

  async function today() {
    return toISODate(await clock.getLocalDate());
  }

  function listRoutes(balance = Infinity) {
    return routes.map((r) => ({
      id: r.id,
      name: r.name,
      cost: r.cost,
      durationDays: r.durationDays,
      reward: { ...r.reward },
      affordable: balance >= r.cost,
    }));
  }

  /** Active voyage plus computed status relative to the clock. */
  async function getActive() {
    if (!state.active) return null;
    const now = await today();
    const daysRemaining = Math.max(0, daysBetween(now, state.active.returnsOn) ?? 0);
    const returned = daysBetween(now, state.active.returnsOn) <= 0;
    return { ...state.active, daysRemaining, returned };
  }

  function getState() {
    return {
      active: state.active ? { ...state.active } : null,
      history: state.history.map((h) => ({ ...h })),
    };
  }

  /** Pay for and start a voyage on `routeId`. */
  async function launch(routeId) {
    const route = byId.get(routeId);
    if (!route) {
      throw new VoyageError(VoyageErrorCode.UNKNOWN_ROUTE, `Unknown route: ${routeId}`, { routeId });
    }
    if (state.active) {
      throw new VoyageError(VoyageErrorCode.VOYAGE_IN_PROGRESS, "A voyage is already in progress", {
        active: state.active.routeId,
      });
    }

    const balance = await wallet.getBalance();
    if (balance < route.cost) {
      throw new VoyageError(VoyageErrorCode.INSUFFICIENT_FUNDS, `Need ${route.cost}, have ${balance}`, {
        routeId, cost: route.cost, balance,
      });
    }

    const result = await transaction.execute({ amount: route.cost, kind: "debit", reason: `voyage:launch:${routeId}` });
    if (!result || result.ok !== true) {
      throw new VoyageError(VoyageErrorCode.TRANSACTION_FAILED, `Launch transaction failed for ${routeId}`, { routeId, result });
    }

    const startedAt = await today();
    state.active = {
      routeId,
      name: route.name,
      startedAt,
      returnsOn: addDays(startedAt, route.durationDays),
      reward: rollReward(route.reward, rng), // rolled now, revealed on claim
    };
    await persist();
    return { ok: true, active: { ...state.active }, balance: result.balance };
  }

  /** Claim a returned voyage: credit the reward and archive it. */
  async function claim() {
    if (!state.active) {
      throw new VoyageError(VoyageErrorCode.NO_ACTIVE_VOYAGE, "No active voyage to claim");
    }
    const now = await today();
    if ((daysBetween(now, state.active.returnsOn) ?? 1) > 0) {
      throw new VoyageError(VoyageErrorCode.NOT_RETURNED, "Voyage has not returned yet", {
        routeId: state.active.routeId, returnsOn: state.active.returnsOn,
      });
    }

    const reward = state.active.reward;
    const result = await transaction.execute({ amount: reward, kind: "credit", reason: `voyage:reward:${state.active.routeId}` });
    if (!result || result.ok !== true) {
      throw new VoyageError(VoyageErrorCode.TRANSACTION_FAILED, "Reward credit failed", { result });
    }

    const completed = { ...state.active, claimedAt: now, reward };
    state.history.push(completed);
    state.active = null;
    await persist();
    return { ok: true, reward, balance: result.balance, voyage: completed };
  }

  return { init, listRoutes, getActive, getState, launch, claim, storageKey };
}
