/**
 * Voyage module (Developer B — game / progression).
 *
 * The mainline capstone: a ONE-WAY relocation of the fridge to the next planet.
 * It is not a round trip and pays no reward — reaching a new planet IS the
 * reward, and the trip is a 15 GP sink that caps the first mainline loop
 * (6 fragments + detector + voyage). Departing requires the mainline
 * prerequisites to be met (fridge built + detector repaired), which the app
 * supplies as an injected `requirementsMet` predicate so voyage stays decoupled
 * from the repair / detector modules, plus holding at least the fare.
 *
 * The current planet and the arrival log are persisted.
 *
 * Game-side logic only. A's domains are reached strictly through the injected
 * ports in ./ports.js — voyage never imports food / economy / infrastructure,
 * nor any sibling game module.
 *
 * @typedef {import("./ports.js").VoyageDeps} VoyageDeps
 */

export const DEFAULT_STORAGE_KEY = "game.voyage";

/** Flat GP fare for a one-way hop to the next planet. */
export const VOYAGE_COST = 15;

/**
 * Planets in travel order. Index 0 is the starting planet (never departed to).
 * Game-design data (movable to app/src/config/ later by agreement).
 */
export const DEFAULT_PLANETS = [
  { id: "home", name: "Home kitchen" },
  { id: "frostpeak", name: "Frostpeak" },
  { id: "brinedeep", name: "Brinedeep" },
];

export const VoyageErrorCode = Object.freeze({
  NOT_READY: "NOT_READY",
  NO_NEXT_PLANET: "NO_NEXT_PLANET",
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  TRANSACTION_FAILED: "TRANSACTION_FAILED",
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

/**
 * @param {VoyageDeps} deps
 * @param {{ planets?: typeof DEFAULT_PLANETS, cost?: number, storageKey?: string,
 *           requirementsMet?: () => (boolean | Promise<boolean>) }} [options]
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
  const cost = options.cost ?? VOYAGE_COST;
  const planets = (options.planets ?? DEFAULT_PLANETS).map((p) => ({ ...p }));
  const requirementsMet = typeof options.requirementsMet === "function" ? options.requirementsMet : () => true;

  /** @type {{ planetIndex: number, arrivals: object[] }} */
  let state = { planetIndex: 0, arrivals: [] };

  async function persist() {
    await gameStorage.save({ key: storageKey, planetIndex: state.planetIndex, arrivals: state.arrivals });
  }

  async function init() {
    const loaded = await gameStorage.load(storageKey);
    if (loaded && typeof loaded === "object") {
      const idx = Number.isInteger(loaded.planetIndex) ? loaded.planetIndex : 0;
      state = {
        planetIndex: Math.max(0, Math.min(idx, planets.length - 1)),
        arrivals: Array.isArray(loaded.arrivals) ? loaded.arrivals : [],
      };
    } else {
      state = { planetIndex: 0, arrivals: [] };
    }
    return getState();
  }

  async function today() {
    return toISODate(await clock.getLocalDate());
  }

  function currentPlanet() {
    return { ...planets[state.planetIndex] };
  }
  function nextPlanet() {
    const next = planets[state.planetIndex + 1];
    return next ? { ...next } : null;
  }

  function listPlanets() {
    return planets.map((p, i) => ({
      id: p.id,
      name: p.name,
      reached: i <= state.planetIndex,
      current: i === state.planetIndex,
    }));
  }

  /** Whether the injected mainline prerequisites are currently satisfied. */
  async function isReady() {
    return Boolean(await requirementsMet());
  }

  function getState() {
    return {
      planetIndex: state.planetIndex,
      planet: currentPlanet(),
      nextPlanet: nextPlanet(),
      cost,
      arrivals: state.arrivals.map((a) => ({ ...a })),
    };
  }

  /** Pay the fare and move one-way to the next planet. */
  async function depart() {
    const next = nextPlanet();
    if (!next) {
      throw new VoyageError(VoyageErrorCode.NO_NEXT_PLANET, "Already at the last planet", {
        planetIndex: state.planetIndex,
      });
    }
    if (!(await requirementsMet())) {
      throw new VoyageError(VoyageErrorCode.NOT_READY, "Mainline prerequisites not met", {});
    }

    const balance = await wallet.getBalance();
    if (balance < cost) {
      throw new VoyageError(VoyageErrorCode.INSUFFICIENT_FUNDS, `Need ${cost}, have ${balance}`, { cost, balance });
    }

    const result = await transaction.execute({ amount: cost, kind: "debit", reason: `voyage:depart:${next.id}` });
    if (!result || result.ok !== true) {
      throw new VoyageError(VoyageErrorCode.TRANSACTION_FAILED, `Voyage transaction failed for ${next.id}`, { result });
    }

    const at = await today();
    state.planetIndex += 1;
    state.arrivals.push({ planetId: next.id, name: next.name, at, cost });
    await persist();
    return { ok: true, planet: next, planetIndex: state.planetIndex, balance: result.balance };
  }

  return { init, listPlanets, currentPlanet, nextPlanet, isReady, getState, depart, cost, storageKey };
}
