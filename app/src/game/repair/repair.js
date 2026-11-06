/**
 * Repair module (Developer B — game / progression).
 *
 * The fridge has a set of repairable components. The player spends wallet funds
 * to fix them; a fixed component is reported to infrastructure (which owns the
 * cooling effect) and the repair progress is persisted.
 *
 * This module owns only the game-side logic (catalog, affordability gating,
 * progression, persistence shape). It reaches A's domains strictly through the
 * injected ports in ./ports.js — it never imports food / economy / infrastructure.
 *
 * @typedef {import("./ports.js").RepairDeps} RepairDeps
 */

/** Default storage key for repair progress. */
export const DEFAULT_STORAGE_KEY = "game.repair";

/**
 * Default repairable fridge components and their costs.
 * NOTE: costs are game-design data. They live here for now; if A and B later
 * want a shared price source, this can move to app/src/config/ by agreement.
 */
export const DEFAULT_COMPONENTS = [
  { id: "door_seal", name: "Door seal", cost: 20 },
  { id: "thermostat", name: "Thermostat", cost: 45 },
  { id: "light", name: "Interior light", cost: 10 },
  { id: "compressor", name: "Compressor", cost: 120 },
];

/** Error codes the repair module can raise. */
export const RepairErrorCode = Object.freeze({
  UNKNOWN_COMPONENT: "UNKNOWN_COMPONENT",
  ALREADY_REPAIRED: "ALREADY_REPAIRED",
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  TRANSACTION_FAILED: "TRANSACTION_FAILED",
});

export class RepairError extends Error {
  /** @param {string} code @param {string} message @param {object} [details] */
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RepairError";
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
 * Create a repair module instance.
 * @param {RepairDeps} deps
 * @param {{ components?: Array<{id:string,name:string,cost:number}>,
 *           storageKey?: string }} [options]
 */
export function createRepairModule(deps, options = {}) {
  const { wallet, transaction, gameStorage, clock, infrastructure } = deps ?? {};
  if (!wallet || typeof wallet.getBalance !== "function") {
    throw new TypeError("repair: deps.wallet.getBalance is required");
  }
  if (!transaction || typeof transaction.execute !== "function") {
    throw new TypeError("repair: deps.transaction.execute is required");
  }
  if (!gameStorage || typeof gameStorage.load !== "function" || typeof gameStorage.save !== "function") {
    throw new TypeError("repair: deps.gameStorage.load/save are required");
  }

  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const catalog = (options.components ?? DEFAULT_COMPONENTS).map((c) => ({ ...c }));
  const byId = new Map(catalog.map((c) => [c.id, c]));

  /** @type {{ repaired: Record<string, { at: string | null }> }} */
  let state = { repaired: {} };

  /** Load persisted repair progress. Call once before use. */
  async function init() {
    const loaded = await gameStorage.load(storageKey);
    if (loaded && typeof loaded === "object" && loaded.repaired) {
      state = { repaired: { ...loaded.repaired } };
    } else {
      state = { repaired: {} };
    }
    return snapshot();
  }

  function isRepaired(id) {
    return Boolean(state.repaired[id]);
  }

  /** List every component with status. `affordable` reflects `balance`. */
  function list(balance = Infinity) {
    return catalog.map((c) => ({
      id: c.id,
      name: c.name,
      cost: c.cost,
      repaired: isRepaired(c.id),
      repairedAt: state.repaired[c.id]?.at ?? null,
      affordable: !isRepaired(c.id) && balance >= c.cost,
    }));
  }

  function get(id) {
    const c = byId.get(id);
    if (!c) return null;
    return {
      id: c.id,
      name: c.name,
      cost: c.cost,
      repaired: isRepaired(id),
      repairedAt: state.repaired[id]?.at ?? null,
    };
  }

  function snapshot() {
    return { repaired: { ...state.repaired } };
  }

  /**
   * Repair a component: gate on balance, debit the wallet, mark repaired,
   * notify infrastructure (best-effort), and persist.
   * @param {string} id
   * @returns {Promise<{ ok: true, component: string, balance: number }>}
   */
  async function repair(id) {
    const component = byId.get(id);
    if (!component) {
      throw new RepairError(RepairErrorCode.UNKNOWN_COMPONENT, `Unknown component: ${id}`, { id });
    }
    if (isRepaired(id)) {
      throw new RepairError(RepairErrorCode.ALREADY_REPAIRED, `Already repaired: ${id}`, { id });
    }

    const balance = await wallet.getBalance();
    if (balance < component.cost) {
      throw new RepairError(
        RepairErrorCode.INSUFFICIENT_FUNDS,
        `Need ${component.cost}, have ${balance}`,
        { id, cost: component.cost, balance },
      );
    }

    const result = await transaction.execute({
      amount: component.cost,
      kind: "debit",
      reason: `repair:${id}`,
    });
    if (!result || result.ok !== true) {
      throw new RepairError(RepairErrorCode.TRANSACTION_FAILED, `Transaction failed for ${id}`, { id, result });
    }

    const at = toISODate(clock ? await clock.getLocalDate() : null);
    state.repaired[id] = { at };

    // Best-effort: cooling effect is infrastructure's (A) responsibility and the
    // interface is only Proposed, so a failure here must not fail the repair.
    if (infrastructure && typeof infrastructure.applyRepair === "function") {
      try {
        await infrastructure.applyRepair({ component: id });
      } catch {
        /* ignore until infrastructure.applyRepair is Agreed */
      }
    }

    await gameStorage.save({ key: storageKey, ...snapshot() });

    return { ok: true, component: id, balance: result.balance };
  }

  return { init, list, get, repair, isRepaired, snapshot, storageKey };
}
