/**
 * Fridge-build module (Developer B — game / progression).
 *
 * Formerly "component repair". The fridge now starts as a bare shelf and is
 * assembled from a fixed set of same-price FRAGMENTS. The player:
 *   1. BUYS a fragment — spends `cost` GP and receives a RANDOM fragment they do
 *      not own yet (owned fragments are never drawn again); and
 *   2. INSTALLS an owned fragment onto the fridge — free.
 * Buying and installing are tracked separately and persisted. When all fragments
 * are installed the fridge build is complete.
 *
 * Game-side logic only (catalog, affordability gating, random draw, progression,
 * persistence shape). A's domains are reached strictly through the injected ports
 * in ./ports.js — it never imports food / economy / infrastructure.
 *
 * @typedef {import("./ports.js").RepairDeps} RepairDeps
 */

/** Default storage key for fridge-build progress. */
export const DEFAULT_STORAGE_KEY = "game.repair";

/** Every fragment costs the same. */
export const FRAGMENT_COST = 5;

/**
 * The fridge fragments — six same-price parts added onto the starting shelf.
 * `slot` is layout metadata for the UI (where the piece sits); game logic uses
 * only `id`. Game-design data; may move to app/src/config/ by agreement.
 */
export const DEFAULT_FRAGMENTS = [
  { id: "drawer", name: "Crisper drawer", slot: "bottom" },
  { id: "door", name: "Door panel", slot: "left" },
  { id: "light", name: "Interior light", slot: "ceiling" },
  { id: "rack", name: "Side rack", slot: "right" },
  { id: "freezer", name: "Freezer tray", slot: "freezer" },
  { id: "seal", name: "Door seal", slot: "door-edge" },
];

/** Error codes the fridge-build module can raise. */
export const RepairErrorCode = Object.freeze({
  UNKNOWN_FRAGMENT: "UNKNOWN_FRAGMENT",
  ALL_OWNED: "ALL_OWNED",
  NOT_OWNED: "NOT_OWNED",
  ALREADY_INSTALLED: "ALREADY_INSTALLED",
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
 * Create a fridge-build (repair) module instance.
 * @param {RepairDeps} deps
 * @param {{ fragments?: Array<{id:string,name:string,slot?:string}>,
 *           cost?: number, storageKey?: string, random?: () => number }} [options]
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
  const cost = options.cost ?? FRAGMENT_COST;
  const random = typeof options.random === "function" ? options.random : Math.random;
  const catalog = (options.fragments ?? DEFAULT_FRAGMENTS).map((f) => ({ ...f }));
  const byId = new Map(catalog.map((f) => [f.id, f]));

  /** @type {{ fragments: Record<string, { boughtAt: string|null, installedAt: string|null }> }} */
  let state = { fragments: {} };

  /** Load persisted progress. Call once before use. */
  async function init() {
    const loaded = await gameStorage.load(storageKey);
    if (loaded && typeof loaded === "object" && loaded.fragments) {
      state = { fragments: structuredClone(loaded.fragments) };
    } else {
      state = { fragments: {} };
    }
    return snapshot();
  }

  const isOwned = (id) => Boolean(state.fragments[id]);
  const isInstalled = (id) => Boolean(state.fragments[id]?.installedAt);
  const ownedCount = () => Object.keys(state.fragments).length;
  const installedCount = () => Object.values(state.fragments).filter((f) => f.installedAt).length;
  const isComplete = () => installedCount() === catalog.length;

  /** List every fragment with status. `affordable` reflects `balance`. */
  function list(balance = Infinity) {
    return catalog.map((f) => ({
      id: f.id,
      name: f.name,
      slot: f.slot ?? null,
      cost,
      owned: isOwned(f.id),
      installed: isInstalled(f.id),
      boughtAt: state.fragments[f.id]?.boughtAt ?? null,
      installedAt: state.fragments[f.id]?.installedAt ?? null,
      affordable: !isOwned(f.id) && balance >= cost,
    }));
  }

  function get(id) {
    const f = byId.get(id);
    if (!f) return null;
    return {
      id: f.id,
      name: f.name,
      slot: f.slot ?? null,
      cost,
      owned: isOwned(id),
      installed: isInstalled(id),
      boughtAt: state.fragments[id]?.boughtAt ?? null,
      installedAt: state.fragments[id]?.installedAt ?? null,
    };
  }

  function getProgress() {
    return { owned: ownedCount(), installed: installedCount(), total: catalog.length, complete: isComplete() };
  }

  function snapshot() {
    return { fragments: structuredClone(state.fragments) };
  }

  async function persist() {
    await gameStorage.save({ key: storageKey, ...snapshot() });
  }

  /**
   * Buy a RANDOM not-yet-owned fragment: gate on balance, debit the wallet, mark
   * owned (not installed), and persist.
   * @returns {Promise<{ ok: true, fragment: string, name: string, balance: number }>}
   */
  async function buy() {
    const unowned = catalog.filter((f) => !isOwned(f.id));
    if (unowned.length === 0) {
      throw new RepairError(RepairErrorCode.ALL_OWNED, "All fragments already owned", {});
    }

    const balance = await wallet.getBalance();
    if (balance < cost) {
      throw new RepairError(RepairErrorCode.INSUFFICIENT_FUNDS, `Need ${cost}, have ${balance}`, { cost, balance });
    }

    const pick = unowned[Math.floor(random() * unowned.length)] ?? unowned[0];

    const result = await transaction.execute({ amount: cost, kind: "debit", reason: `fragment:buy:${pick.id}` });
    if (!result || result.ok !== true) {
      throw new RepairError(RepairErrorCode.TRANSACTION_FAILED, "Transaction failed buying a fragment", { result });
    }

    const at = toISODate(clock ? await clock.getLocalDate() : null);
    state.fragments[pick.id] = { boughtAt: at, installedAt: null };
    await persist();

    return { ok: true, fragment: pick.id, name: pick.name, balance: result.balance };
  }

  /**
   * Install an owned, not-yet-installed fragment onto the fridge (free).
   * Notifies infrastructure best-effort and persists.
   * @param {string} id
   * @returns {Promise<{ ok: true, fragment: string, installed: number, total: number, complete: boolean }>}
   */
  async function install(id) {
    const f = byId.get(id);
    if (!f) {
      throw new RepairError(RepairErrorCode.UNKNOWN_FRAGMENT, `Unknown fragment: ${id}`, { id });
    }
    const rec = state.fragments[id];
    if (!rec) {
      throw new RepairError(RepairErrorCode.NOT_OWNED, `Fragment not owned: ${id}`, { id });
    }
    if (rec.installedAt) {
      throw new RepairError(RepairErrorCode.ALREADY_INSTALLED, `Already installed: ${id}`, { id });
    }

    rec.installedAt = toISODate(clock ? await clock.getLocalDate() : null);

    // Best-effort: the real cooling effect is infrastructure's (A) responsibility
    // and the interface is only Proposed, so a failure here must not fail install.
    if (infrastructure && typeof infrastructure.applyRepair === "function") {
      try {
        await infrastructure.applyRepair({ component: id });
      } catch {
        /* ignore until infrastructure.applyRepair is Agreed */
      }
    }

    await persist();
    return { ok: true, fragment: id, installed: installedCount(), total: catalog.length, complete: isComplete() };
  }

  return { init, list, get, getProgress, buy, install, isOwned, isInstalled, isComplete, snapshot, storageKey };
}
