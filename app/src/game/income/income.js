/**
 * Income module (Developer B — game / progression).
 *
 * The GreenPoints (GP) earning rules. GP only ever increases — there is no
 * penalty and nothing here can take GP away. The app calls these handlers when
 * the player does a measurable fridge-management action; income applies the
 * caps / dedup and credits GP through the transaction port:
 *
 *   • openDay()            +DAILY_OPEN GP, once per distinct local day.
 *   • recordEntry()        +ENTRY GP per logged batch, up to ENTRY_CAP per day.
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

  /** @type {{ lastOpenDate: string|null, day: string|null, entries: number, categories: string[], earned: number }} */
  let state = { lastOpenDate: null, day: null, entries: 0, categories: [], earned: 0 };

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
        categories: Array.isArray(loaded.categories) ? [...loaded.categories] : [],
        earned: Number.isFinite(loaded.earned) ? loaded.earned : 0,
      };
    } else {
      state = { lastOpenDate: null, day: null, entries: 0, categories: [], earned: 0 };
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

  /** A batch was logged into the fridge: +entry GP, up to entryCap per day. */
  async function recordEntry() {
    const todayISO = await today();
    rollDay(todayISO);
    if (state.entries >= rates.entryCap) {
      await persist();
      return { credited: false, reason: "DAILY_CAP", amount: 0, entriesToday: state.entries, cap: rates.entryCap };
    }
    const result = await credit(rates.entry, "income:entry");
    state.entries += 1;
    await persist();
    return { credited: true, amount: rates.entry, balance: result.balance, entriesToday: state.entries, cap: rates.entryCap };
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
      categories: [...state.categories],
      earned: state.earned,
      rates: { ...rates },
    };
  }

  /** Lifetime GP earned through income. */
  function getEarned() {
    return state.earned;
  }

  return { init, openDay, recordEntry, recordConsume, getSnapshot, getEarned, storageKey };
}
