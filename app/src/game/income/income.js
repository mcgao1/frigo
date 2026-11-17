/**
 * Income module (Developer B — game / progression).
 *
 * The GreenPoints (GP) earning rules. GP only ever increases — there is no
 * penalty and nothing here can take GP away. The app calls these handlers when
 * the player does a measurable fridge-management action; income applies the
 * caps / dedup and credits GP through the transaction port:
 *
 *   • openDay()            +DAILY_OPEN GP, once per distinct local day.
 *   • recordEntry(batchId) +ENTRY GP per logged batch, up to ENTRY_CAP per day.
 *                          batchId is REQUIRED (a stable id from A). Each batchId
 *                          is resolved at most once EVER: it either earns once,
 *                          or — if it arrives after the day's cap — is burned as
 *                          `cap_exceeded` and can never earn, across days,
 *                          reloads, or re-delivered "added" events.
 *   • recordConsume(cat)   +CONSUME GP per category consumed, each category once
 *                          per day, up to CONSUME_CAP categories per day.
 *
 * Hitting a cap is normal, not an error: the handler simply returns
 * `{ credited: false }` and no GP is given (no penalty). Per-day counters reset
 * when the local day changes. The counters + lifetime earned are persisted.
 *
 * Income does NOT read food or subscribe to events — the app routes the relevant
 * food events to these methods (same orchestration pattern the playground/app
 * uses elsewhere). Game-side logic only; A is reached only via ./ports.js.
 *
 * @typedef {import("./ports.js").IncomeDeps} IncomeDeps
 */

export const DEFAULT_STORAGE_KEY = "game.income";

/** GP for the first app-open of a day. */
export const DAILY_OPEN_GP = 5;
/** GP per logged batch, and how many logged batches earn per day. */
export const ENTRY_GP = 4;
export const ENTRY_CAP = 3;
/** GP per category consumed, and how many categories earn per day. */
export const CONSUME_GP = 3;
export const CONSUME_CAP = 3;

export const IncomeErrorCode = Object.freeze({
  TRANSACTION_FAILED: "TRANSACTION_FAILED",
  MISSING_BATCH_ID: "MISSING_BATCH_ID",
});

export class IncomeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "IncomeError";
    this.code = code;
    this.details = details;
  }
}

function toISODate(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/** Normalize a category key so dedup is stable ("Dairy" === "dairy "). */
function normCategory(value) {
  const s = String(value ?? "").trim().toLowerCase();
  return s || "uncategorized";
}

/**
 * Load the persisted entry-batch ledger into `{ batchId: "rewarded" |
 * "cap_exceeded" }`, tolerating the older array-of-rewarded-ids format.
 */
function normalizeEntryBatches(value) {
  const out = {};
  if (Array.isArray(value)) {
    for (const id of value) out[String(id)] = "rewarded";
  } else if (value && typeof value === "object") {
    for (const [id, status] of Object.entries(value)) {
      out[String(id)] = status === "cap_exceeded" ? "cap_exceeded" : "rewarded";
    }
  }
  return out;
}

/**
 * @param {IncomeDeps} deps
 * @param {{ storageKey?: string, rates?: Partial<{dailyOpen:number,entry:number,
 *           entryCap:number,consume:number,consumeCap:number}> }} [options]
 */
export function createIncomeModule(deps, options = {}) {
  const { transaction, gameStorage, clock } = deps ?? {};
  if (!transaction || typeof transaction.execute !== "function") {
    throw new TypeError("income: deps.transaction.execute is required");
  }
  if (!gameStorage || typeof gameStorage.load !== "function" || typeof gameStorage.save !== "function") {
    throw new TypeError("income: deps.gameStorage.load/save are required");
  }
  if (!clock || typeof clock.getLocalDate !== "function") {
    throw new TypeError("income: deps.clock.getLocalDate is required");
  }

  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const rates = {
    dailyOpen: options.rates?.dailyOpen ?? DAILY_OPEN_GP,
    entry: options.rates?.entry ?? ENTRY_GP,
    entryCap: options.rates?.entryCap ?? ENTRY_CAP,
    consume: options.rates?.consume ?? CONSUME_GP,
    consumeCap: options.rates?.consumeCap ?? CONSUME_CAP,
  };

  /**
   * @type {{ lastOpenDate: string|null, day: string|null, entries: number,
   *          entryBatches: Record<string, "rewarded"|"cap_exceeded">,
   *          categories: string[], earned: number }}
   * `entryBatches` is the lifetime ledger of resolved entry batchIds: "rewarded"
   * (earned its single +entry) or "cap_exceeded" (arrived past the daily cap and
   * burned). Either status blocks any future reward — across days, reloads, or
   * re-delivered "added" events. Persisted.
   */
  let state = { lastOpenDate: null, day: null, entries: 0, entryBatches: {}, categories: [], earned: 0 };

  async function persist() {
    await gameStorage.save({ key: storageKey, ...state });
  }

  async function today() {
    return toISODate(await clock.getLocalDate());
  }

  async function init() {
    const loaded = await gameStorage.load(storageKey);
    if (loaded && typeof loaded === "object") {
      state = {
        lastOpenDate: loaded.lastOpenDate ?? null,
        day: loaded.day ?? null,
        entries: Number.isFinite(loaded.entries) ? loaded.entries : 0,
        entryBatches: normalizeEntryBatches(loaded.entryBatches),
        categories: Array.isArray(loaded.categories) ? [...loaded.categories] : [],
        earned: Number.isFinite(loaded.earned) ? loaded.earned : 0,
      };
    } else {
      state = { lastOpenDate: null, day: null, entries: 0, entryBatches: {}, categories: [], earned: 0 };
    }
    return getSnapshot();
  }

  /** Reset the per-day counters when the local day rolls over. */
  function rollDay(todayISO) {
    if (todayISO && todayISO !== state.day) {
      state.day = todayISO;
      state.entries = 0;
      state.categories = [];
    }
  }

  /** Credit GP and track lifetime earned. Throws only on a transaction failure. */
  async function credit(amount, reason) {
    const result = await transaction.execute({ amount, kind: "credit", reason });
    if (!result || result.ok !== true) {
      throw new IncomeError(IncomeErrorCode.TRANSACTION_FAILED, `Credit failed: ${reason}`, { amount, reason, result });
    }
    state.earned += amount;
    return result;
  }

  /** First app-open of the day: +dailyOpen GP, once per distinct local day. */
  async function openDay() {
    const todayISO = await today();
    rollDay(todayISO);
    if (state.lastOpenDate === todayISO) {
      await persist();
      return { credited: false, reason: "ALREADY_OPENED_TODAY", amount: 0 };
    }
    const result = await credit(rates.dailyOpen, "income:daily");
    state.lastOpenDate = todayISO;
    await persist();
    return { credited: true, amount: rates.dailyOpen, balance: result.balance };
  }

  /**
   * A valid new batch was logged into the fridge: +entry GP, up to entryCap per
   * day, and each `batchId` is resolved at most once EVER.
   *
   * `batchId` is REQUIRED and must be a stable id supplied by A — there is no
   * auto-generated fallback (a missing id throws MISSING_BATCH_ID). A test tool /
   * sandbox must mint its own unique ids.
   *
   * Resolution is terminal and persisted: a batch becomes "rewarded" (earned its
   * single +entry) or, if it arrives after the day's cap is full, "cap_exceeded"
   * (burned — never earns, even re-delivered on a later day). Either way a
   * re-delivery (same day, next day, after a reload, or a duplicate event) never
   * earns again. Catching an edit / delete-and-re-log depends on A reusing the
   * batch's stable id — see the Proposed `food.batchAdded` / `batchId` interface.
   * @param {string} batchId
   */
  async function recordEntry(batchId) {
    if (batchId == null || String(batchId).trim() === "") {
      throw new IncomeError(IncomeErrorCode.MISSING_BATCH_ID, "recordEntry requires a stable batchId", { batchId });
    }
    const id = String(batchId);
    const todayISO = await today();
    rollDay(todayISO);

    // Already resolved? Never pays again, and does not consume a daily slot,
    // whatever day it is re-delivered on.
    const prior = state.entryBatches[id];
    if (prior === "rewarded") {
      await persist();
      return { credited: false, reason: "DUPLICATE_BATCH", amount: 0, batchId: id, status: prior, entriesToday: state.entries, cap: rates.entryCap };
    }
    if (prior === "cap_exceeded") {
      await persist();
      return { credited: false, reason: "CAP_EXCEEDED", amount: 0, batchId: id, status: prior, entriesToday: state.entries, cap: rates.entryCap };
    }

    // First time we see this batch, but the day's cap is already full: burn it
    // permanently so it can never be back-paid on a later day.
    if (state.entries >= rates.entryCap) {
      state.entryBatches[id] = "cap_exceeded";
      await persist();
      return { credited: false, reason: "CAP_EXCEEDED", amount: 0, batchId: id, status: "cap_exceeded", entriesToday: state.entries, cap: rates.entryCap };
    }

    // credit() throws on a wallet failure BEFORE we record anything, so a failed
    // reward leaves the batch unresolved and retryable (no double-charge, no burn).
    const result = await credit(rates.entry, "income:entry");
    state.entries += 1;
    state.entryBatches[id] = "rewarded";
    await persist();
    return { credited: true, amount: rates.entry, balance: result.balance, batchId: id, status: "rewarded", entriesToday: state.entries, cap: rates.entryCap };
  }

  /**
   * A category was consumed from the fridge: +consume GP, each category once per
   * day, up to consumeCap categories per day.
   * @param {string} category
   */
  async function recordConsume(category) {
    const cat = normCategory(category);
    const todayISO = await today();
    rollDay(todayISO);
    if (state.categories.includes(cat)) {
      await persist();
      return { credited: false, reason: "CATEGORY_DONE", amount: 0, category: cat };
    }
    if (state.categories.length >= rates.consumeCap) {
      await persist();
      return { credited: false, reason: "DAILY_CAP", amount: 0, category: cat, cap: rates.consumeCap };
    }
    const result = await credit(rates.consume, `income:consume:${cat}`);
    state.categories.push(cat);
    await persist();
    return { credited: true, amount: rates.consume, balance: result.balance, category: cat, categoriesToday: [...state.categories], cap: rates.consumeCap };
  }

  /** Sync view of today's earning state (the app renders from this). */
  function getSnapshot() {
    return {
      lastOpenDate: state.lastOpenDate,
      day: state.day,
      entries: state.entries,
      entryBatchCount: Object.keys(state.entryBatches).length,
      categories: [...state.categories],
      earned: state.earned,
      rates: { ...rates },
    };
  }

  /** Lifetime GP earned through income. */
  function getEarned() {
    return state.earned;
  }

  /** This batch's lifetime entry status: "rewarded" | "cap_exceeded" | null. */
  function entryBatchStatus(batchId) {
    return state.entryBatches[String(batchId)] ?? null;
  }
  /** Has this batchId already been resolved (rewarded or cap_exceeded)? */
  function hasEntryBatch(batchId) {
    return entryBatchStatus(batchId) !== null;
  }

  return { init, openDay, recordEntry, recordConsume, getSnapshot, getEarned, hasEntryBatch, entryBatchStatus, storageKey };
}
