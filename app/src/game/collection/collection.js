/**
 * Collection module (Developer B — game / progression).
 *
 * An album of collectible food kinds, grouped into sets. As food appears in the
 * fridge, its kind is recorded as discovered (pulled via food.getSnapshot, or
 * pushed via food "added" events). Completing a set lets the player claim a coin
 * reward. Discoveries and claimed sets are persisted.
 *
 * Game-side logic only. A's domains are reached strictly through the injected
 * ports in ./ports.js — collection never imports food / economy / infrastructure.
 *
 * @typedef {import("./ports.js").CollectionDeps} CollectionDeps
 */

export const DEFAULT_STORAGE_KEY = "game.collection";

/** Sets the catalog is grouped into, with their completion rewards. */
export const DEFAULT_SETS = [
  { id: "dairy", name: "Dairy", reward: 100 },
  { id: "greens", name: "Greens", reward: 50 },
];

/**
 * Master catalog of collectible kinds. A food item counts toward the collection
 * only if its kind appears here. Game-design data (movable to app/src/config/
 * later by agreement).
 */
export const DEFAULT_CATALOG = [
  { kind: "milk", name: "Milk", set: "dairy" },
  { kind: "cheese", name: "Cheese", set: "dairy" },
  { kind: "yogurt", name: "Yogurt", set: "dairy" },
  { kind: "lettuce", name: "Lettuce", set: "greens" },
  { kind: "spinach", name: "Spinach", set: "greens" },
];

export const CollectionErrorCode = Object.freeze({
  UNKNOWN_SET: "UNKNOWN_SET",
  SET_INCOMPLETE: "SET_INCOMPLETE",
  ALREADY_CLAIMED: "ALREADY_CLAIMED",
  CLAIM_UNAVAILABLE: "CLAIM_UNAVAILABLE",
  TRANSACTION_FAILED: "TRANSACTION_FAILED",
});

export class CollectionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CollectionError";
    this.code = code;
    this.details = details;
  }
}

function toISODate(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

function kindOf(item) {
  return item?.kind ?? item?.name ?? item?.id ?? null;
}

/**
 * @param {CollectionDeps} deps
 * @param {{ catalog?: typeof DEFAULT_CATALOG, sets?: typeof DEFAULT_SETS, storageKey?: string }} [options]
 */
export function createCollectionModule(deps, options = {}) {
  const { food, gameStorage, clock, transaction } = deps ?? {};
  if (!food || typeof food.getSnapshot !== "function") {
    throw new TypeError("collection: deps.food.getSnapshot is required");
  }
  if (!gameStorage || typeof gameStorage.load !== "function" || typeof gameStorage.save !== "function") {
    throw new TypeError("collection: deps.gameStorage.load/save are required");
  }

  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const catalog = (options.catalog ?? DEFAULT_CATALOG).map((c) => ({ ...c }));
  const sets = (options.sets ?? DEFAULT_SETS).map((s) => ({ ...s }));
  const catalogByKind = new Map(catalog.map((c) => [c.kind, c]));
  const setsById = new Map(sets.map((s) => [s.id, s]));

  /** @type {{ discovered: Record<string, { at: string | null }>, claimedSets: string[] }} */
  let state = { discovered: {}, claimedSets: [] };
  let cachedDate = null;
  let unsubscribe = null;

  async function persist() {
    await gameStorage.save({ key: storageKey, discovered: state.discovered, claimedSets: state.claimedSets });
  }

  async function refreshDate() {
    cachedDate = toISODate(clock ? await clock.getLocalDate() : null);
    return cachedDate;
  }

  /** Record a kind if it is collectible and not already discovered. */
  function recordKind(kind) {
    if (!catalogByKind.has(kind) || state.discovered[kind]) return false;
    state.discovered[kind] = { at: cachedDate };
    return true;
  }

  async function init() {
    const loaded = await gameStorage.load(storageKey);
    if (loaded && typeof loaded === "object") {
      state = {
        discovered: loaded.discovered && typeof loaded.discovered === "object" ? { ...loaded.discovered } : {},
        claimedSets: Array.isArray(loaded.claimedSets) ? [...loaded.claimedSets] : [],
      };
    } else {
      state = { discovered: {}, claimedSets: [] };
    }
    await refreshDate();

    if (typeof food.subscribeEvents === "function" && !unsubscribe) {
      unsubscribe = food.subscribeEvents((event) => {
        if (event && event.type === "added" && event.item) {
          if (recordKind(kindOf(event.item))) persist();
        }
      });
    }
    return getProgress();
  }

  /** Pull the current food snapshot and record any new collectible kinds. */
  async function sync() {
    await refreshDate();
    const snapshot = (await food.getSnapshot()) ?? {};
    const items = Array.isArray(snapshot.items) ? snapshot.items : [];
    const newlyDiscovered = [];
    for (const item of items) {
      if (recordKind(kindOf(item))) newlyDiscovered.push(kindOf(item));
    }
    if (newlyDiscovered.length > 0) await persist();
    return { newlyDiscovered };
  }

  function isDiscovered(kind) {
    return Boolean(state.discovered[kind]);
  }

  function listCatalog() {
    return catalog.map((c) => ({
      kind: c.kind,
      name: c.name,
      set: c.set,
      discovered: isDiscovered(c.kind),
      discoveredAt: state.discovered[c.kind]?.at ?? null,
    }));
  }

  function setProgress(setId) {
    const set = setsById.get(setId);
    if (!set) return null;
    const entries = catalog.filter((c) => c.set === setId);
    const found = entries.filter((c) => isDiscovered(c.kind)).length;
    return {
      id: set.id,
      name: set.name,
      reward: set.reward,
      total: entries.length,
      found,
      complete: entries.length > 0 && found === entries.length,
      claimed: state.claimedSets.includes(setId),
    };
  }

  function getSets() {
    return sets.map((s) => setProgress(s.id));
  }

  function getProgress() {
    const total = catalog.length;
    const found = catalog.filter((c) => isDiscovered(c.kind)).length;
    return {
      total,
      found,
      sets: getSets(),
      discovered: { ...state.discovered },
      claimedSets: [...state.claimedSets],
    };
  }

  /** Claim the reward for a completed, unclaimed set. */
  async function claimSet(setId) {
    const progress = setProgress(setId);
    if (!progress) {
      throw new CollectionError(CollectionErrorCode.UNKNOWN_SET, `Unknown set: ${setId}`, { setId });
    }
    if (!progress.complete) {
      throw new CollectionError(CollectionErrorCode.SET_INCOMPLETE, `Set not complete: ${setId}`, {
        setId, found: progress.found, total: progress.total,
      });
    }
    if (progress.claimed) {
      throw new CollectionError(CollectionErrorCode.ALREADY_CLAIMED, `Set already claimed: ${setId}`, { setId });
    }
    // A non-positive reward (e.g. a V1-profile set with reward 0) must NOT touch
    // the wallet at all — no 0-GP transaction, no ledger line — while still
    // completing the claim (claimed state + persistence). Positive rewards are
    // unchanged: they still require a transaction and credit through it.
    let balance;
    if (progress.reward > 0) {
      if (!transaction || typeof transaction.execute !== "function") {
        throw new CollectionError(CollectionErrorCode.CLAIM_UNAVAILABLE, "Claiming needs deps.transaction", { setId });
      }
      const result = await transaction.execute({ amount: progress.reward, kind: "credit", reason: `collection:set:${setId}` });
      if (!result || result.ok !== true) {
        throw new CollectionError(CollectionErrorCode.TRANSACTION_FAILED, `Reward credit failed for ${setId}`, { setId, result });
      }
      balance = result.balance;
    }

    state.claimedSets.push(setId);
    await persist();
    return { ok: true, setId, reward: progress.reward, balance };
  }

  function dispose() {
    if (typeof unsubscribe === "function") unsubscribe();
    unsubscribe = null;
  }

  return { init, sync, isDiscovered, listCatalog, getSets, getProgress, claimSet, dispose, storageKey };
}
