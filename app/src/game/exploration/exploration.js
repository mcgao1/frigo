/**
 * Exploration module (Developer B — game / progression).
 *
 * A single dig site next to the fridge. Each dig costs a flat DIG_COST GP and
 * rolls a weighted loot table: mostly junk / storage tips / recipes, with an
 * occasional small GP refund. Recipes and tips are collectibles (each kept once);
 * junk and GP are not. The loot table is GP-negative on average, so digging is a
 * side-activity SINK, not a GP farm. Totals + the collected recipes/tips persist.
 *
 * This is deliberately separate from the detector's one-off "free dig" that
 * uncovers the detector — that is a mainline step; this is the optional,
 * paid, repeatable dig.
 *
 * Game-side logic only. A's domains are reached strictly through the injected
 * ports in ./ports.js — exploration never imports food / economy / infrastructure.
 *
 * @typedef {import("./ports.js").ExplorationDeps} ExplorationDeps
 */

export const DEFAULT_STORAGE_KEY = "game.exploration";

/** Flat GP cost of one dig. */
export const DIG_COST = 5;

/** Collectible recipes the dig can turn up. Game-design data. */
export const DEFAULT_RECIPES = [
  { id: "fried-rice", name: "Leftover fried rice" },
  { id: "scrap-stock", name: "Veg-scrap stock" },
  { id: "banana-bread", name: "Overripe-banana bread" },
  { id: "greens-soup", name: "Wilting-greens soup" },
  { id: "frittata", name: "Odds-and-ends frittata" },
];

/** Collectible storage tips the dig can turn up. Game-design data. */
export const DEFAULT_TIPS = [
  { id: "herbs-water", name: "Stand herbs stem-down in water" },
  { id: "freeze-bread", name: "Freeze bread before it stales" },
  { id: "onion-potato", name: "Keep onions away from potatoes" },
  { id: "fifo", name: "First in, first eaten — shelve by date" },
  { id: "breathe", name: "Loosen bags so greens can breathe" },
];

/** Flavor junk (not collected — just a miss). Game-design data. */
export const DEFAULT_JUNK = [
  { id: "cap", name: "a rusty bottle cap" },
  { id: "sock", name: "a single odd sock" },
  { id: "bone", name: "an old fish bone" },
  { id: "clip", name: "a bent paperclip" },
  { id: "magnet", name: "a cracked fridge magnet" },
];

/**
 * Weighted loot table. Weights are relative; `gp` entries also carry an inclusive
 * refund range. Average GP back ≈ 0.20 × 5.5 ≈ 1.1 per 5 GP dig (a net sink).
 */
export const DEFAULT_LOOT = [
  { type: "junk", weight: 30 },
  { type: "tip", weight: 28 },
  { type: "recipe", weight: 22 },
  { type: "gp", weight: 20, gp: { min: 3, max: 8 } },
];

export const ExplorationErrorCode = Object.freeze({
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  TRANSACTION_FAILED: "TRANSACTION_FAILED",
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
 * @param {{ storageKey?: string, cost?: number, recipes?: typeof DEFAULT_RECIPES,
 *           tips?: typeof DEFAULT_TIPS, junk?: typeof DEFAULT_JUNK,
 *           loot?: typeof DEFAULT_LOOT, random?: () => number }} [options]
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

  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const cost = options.cost ?? DIG_COST;
  const random = typeof options.random === "function" ? options.random : Math.random;
  const recipes = (options.recipes ?? DEFAULT_RECIPES).map((r) => ({ ...r }));
  const tips = (options.tips ?? DEFAULT_TIPS).map((t) => ({ ...t }));
  const junk = (options.junk ?? DEFAULT_JUNK).map((j) => ({ ...j }));
  const loot = (options.loot ?? DEFAULT_LOOT).map((l) => ({ ...l }));

  /** @type {{ digs:number, recipes:string[], tips:string[], junk:number, gpReturned:number, lastFind:object|null }} */
  let state = { digs: 0, recipes: [], tips: [], junk: 0, gpReturned: 0, lastFind: null };

  async function persist() {
    await gameStorage.save({ key: storageKey, ...state });
  }

  async function init() {
    const loaded = await gameStorage.load(storageKey);
    if (loaded && typeof loaded === "object") {
      state = {
        digs: Number.isFinite(loaded.digs) ? loaded.digs : 0,
        recipes: Array.isArray(loaded.recipes) ? [...loaded.recipes] : [],
        tips: Array.isArray(loaded.tips) ? [...loaded.tips] : [],
        junk: Number.isFinite(loaded.junk) ? loaded.junk : 0,
        gpReturned: Number.isFinite(loaded.gpReturned) ? loaded.gpReturned : 0,
        lastFind: loaded.lastFind ?? null,
      };
    } else {
      state = { digs: 0, recipes: [], tips: [], junk: 0, gpReturned: 0, lastFind: null };
    }
    return getSnapshot();
  }

  /** Roll the loot table. Consumes exactly two random() draws per dig. */
  function rollLoot() {
    const total = loot.reduce((s, e) => s + e.weight, 0);
    let x = random() * total;
    let bucket = loot[loot.length - 1];
    for (const e of loot) {
      if ((x -= e.weight) < 0) { bucket = e; break; }
    }
    if (bucket.type === "gp") {
      const { min, max } = bucket.gp ?? { min: 0, max: 0 };
      const amount = min + Math.floor(random() * (max - min + 1));
      return { type: "gp", gp: amount };
    }
    const pool = bucket.type === "recipe" ? recipes : bucket.type === "tip" ? tips : junk;
    const have = bucket.type === "recipe" ? state.recipes : bucket.type === "tip" ? state.tips : [];
    const fresh = pool.filter((p) => !have.includes(p.id));
    const choices = fresh.length ? fresh : pool;
    const pick = choices[Math.floor(random() * choices.length)] ?? choices[0];
    return { type: bucket.type, id: pick.id, name: pick.name };
  }

  /** Pay the fare and dig once, returning the loot found. */
  async function dig() {
    const balance = await wallet.getBalance();
    if (balance < cost) {
      throw new ExplorationError(ExplorationErrorCode.INSUFFICIENT_FUNDS, `Need ${cost}, have ${balance}`, { cost, balance });
    }
    const debit = await transaction.execute({ amount: cost, kind: "debit", reason: "explore:dig" });
    if (!debit || debit.ok !== true) {
      throw new ExplorationError(ExplorationErrorCode.TRANSACTION_FAILED, "Dig transaction failed", { result: debit });
    }

    const at = clock ? toISODate(await clock.getLocalDate()) : null;
    const rolled = rollLoot();
    state.digs += 1;

    let loot_, balanceAfter = debit.balance;
    if (rolled.type === "gp") {
      const credit = await transaction.execute({ amount: rolled.gp, kind: "credit", reason: "explore:loot:gp" });
      const credited = Boolean(credit && credit.ok === true);
      if (credited) { state.gpReturned += rolled.gp; balanceAfter = credit.balance; }
      loot_ = { type: "gp", gp: rolled.gp, credited };
    } else if (rolled.type === "recipe") {
      const isNew = !state.recipes.includes(rolled.id);
      if (isNew) state.recipes.push(rolled.id);
      loot_ = { type: "recipe", id: rolled.id, name: rolled.name, isNew };
    } else if (rolled.type === "tip") {
      const isNew = !state.tips.includes(rolled.id);
      if (isNew) state.tips.push(rolled.id);
      loot_ = { type: "tip", id: rolled.id, name: rolled.name, isNew };
    } else {
      state.junk += 1;
      loot_ = { type: "junk", id: rolled.id, name: rolled.name };
    }

    state.lastFind = { ...loot_, at };
    await persist();
    return { ok: true, cost, loot: loot_, digs: state.digs, balance: balanceAfter };
  }

  function getSnapshot() {
    return {
      digs: state.digs,
      cost,
      recipes: [...state.recipes],
      tips: [...state.tips],
      junk: state.junk,
      gpReturned: state.gpReturned,
      lastFind: state.lastFind ? { ...state.lastFind } : null,
      totals: { recipes: recipes.length, tips: tips.length },
    };
  }

  function listRecipes() {
    return recipes.map((r) => ({ id: r.id, name: r.name, found: state.recipes.includes(r.id) }));
  }
  function listTips() {
    return tips.map((t) => ({ id: t.id, name: t.name, found: state.tips.includes(t.id) }));
  }

  return { init, dig, getSnapshot, listRecipes, listTips, cost, storageKey };
}
