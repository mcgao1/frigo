/**
 * Letters module (Developer B — game / progression).
 *
 * A mailbox of letters. Each letter is delivered when its conditions are met: a
 * delivery date (reached against the clock) and/or progress flags raised by the
 * rest of the game. Delivered letters can be read, and some carry a coin gift the
 * player claims once. Read/claimed state and delivery are persisted.
 *
 * Game-side logic only. A's domains are reached strictly through the injected
 * ports in ./ports.js — letters never imports food / economy / infrastructure.
 * Delivery flags are internal game calls, not A interfaces.
 *
 * @typedef {import("./ports.js").LettersDeps} LettersDeps
 */

export const DEFAULT_STORAGE_KEY = "game.letters";

/**
 * Default letters. Delivery conditions: `deliverOn` (ISO date — delivered once
 * today >= it) and/or `requires` (flags that must all be set). A letter with
 * neither is delivered immediately. `gift` is coins claimable once. Game-design
 * data (movable to app/src/config/ later by agreement).
 */
export const DEFAULT_LETTERS = [
  {
    id: "welcome",
    from: "The Landlord",
    subject: "Welcome to the kitchen",
    deliverOn: "2026-11-10",
    gift: 0,
    body: ["Dear tenant,", "The fridge is yours now. Do keep it running.", "— The Landlord"],
  },
  {
    id: "grandma",
    from: "Grandma",
    subject: "A little something",
    deliverOn: "2026-11-12",
    gift: 50,
    body: ["Sweetheart,", "Buy yourself something fresh. Enclosed is a little help.", "Love, Grandma"],
  },
  {
    id: "guild",
    from: "Voyager's Guild",
    subject: "Well sailed",
    requires: ["voyage:complete"],
    gift: 30,
    body: ["Captain,", "Word of your first voyage reached us. A small token of respect.", "— The Guild"],
  },
];

export const LettersErrorCode = Object.freeze({
  UNKNOWN_LETTER: "UNKNOWN_LETTER",
  NOT_DELIVERED: "NOT_DELIVERED",
  NO_GIFT: "NO_GIFT",
  ALREADY_CLAIMED: "ALREADY_CLAIMED",
  CLAIM_UNAVAILABLE: "CLAIM_UNAVAILABLE",
  TRANSACTION_FAILED: "TRANSACTION_FAILED",
});

export class LettersError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "LettersError";
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
 * @param {LettersDeps} deps
 * @param {{ letters?: typeof DEFAULT_LETTERS, storageKey?: string }} [options]
 */
export function createLettersModule(deps, options = {}) {
  const { clock, gameStorage, transaction } = deps ?? {};
  if (!clock || typeof clock.getLocalDate !== "function") {
    throw new TypeError("letters: deps.clock.getLocalDate is required");
  }
  if (!gameStorage || typeof gameStorage.load !== "function" || typeof gameStorage.save !== "function") {
    throw new TypeError("letters: deps.gameStorage.load/save are required");
  }

  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const letters = (options.letters ?? DEFAULT_LETTERS).map((l) => ({
    ...l,
    requires: [...(l.requires ?? [])],
    body: [...l.body],
    gift: l.gift ?? 0,
  }));
  const byId = new Map(letters.map((l) => [l.id, l]));

  /** @type {{ flags: string[], delivered: Record<string, string>, read: string[], claimed: string[] }} */
  let state = { flags: [], delivered: {}, read: [], claimed: [] };

  async function persist() {
    await gameStorage.save({ key: storageKey, flags: state.flags, delivered: state.delivered, read: state.read, claimed: state.claimed });
  }

  async function today() {
    return toISODate(await clock.getLocalDate());
  }

  function isDelivered(id) {
    return Boolean(state.delivered[id]);
  }

  function conditionsMet(letter, todayISO) {
    const dateOk = !letter.deliverOn || (todayISO != null && todayISO >= letter.deliverOn);
    const flagsOk = letter.requires.every((f) => state.flags.includes(f));
    return dateOk && flagsOk;
  }

  /** Deliver any letters whose conditions are now met. Returns their ids. */
  async function evaluate() {
    const todayISO = await today();
    const newly = [];
    for (const letter of letters) {
      if (isDelivered(letter.id)) continue;
      if (conditionsMet(letter, todayISO)) {
        state.delivered[letter.id] = todayISO;
        newly.push(letter.id);
      }
    }
    return newly;
  }

  async function init() {
    const loaded = await gameStorage.load(storageKey);
    if (loaded && typeof loaded === "object") {
      state = {
        flags: Array.isArray(loaded.flags) ? [...loaded.flags] : [],
        delivered: loaded.delivered && typeof loaded.delivered === "object" ? { ...loaded.delivered } : {},
        read: Array.isArray(loaded.read) ? [...loaded.read] : [],
        claimed: Array.isArray(loaded.claimed) ? [...loaded.claimed] : [],
      };
    } else {
      state = { flags: [], delivered: {}, read: [], claimed: [] };
    }
    const newly = await evaluate();
    await persist();
    return { newlyDelivered: newly, inbox: listInbox() };
  }

  /** Re-check deliveries (e.g. after a day passes). */
  async function refresh() {
    const newly = await evaluate();
    if (newly.length > 0) await persist();
    return { newlyDelivered: newly };
  }

  /** Raise a delivery flag and deliver any letters it completes. */
  async function trigger(flag) {
    if (!state.flags.includes(flag)) state.flags.push(flag);
    const newly = await evaluate();
    await persist();
    return { newlyDelivered: newly };
  }

  function listInbox() {
    return letters
      .filter((l) => isDelivered(l.id))
      .map((l) => ({
        id: l.id,
        from: l.from,
        subject: l.subject,
        deliveredAt: state.delivered[l.id],
        read: state.read.includes(l.id),
        hasGift: l.gift > 0,
        claimed: state.claimed.includes(l.id),
      }));
  }

  function unreadCount() {
    return letters.filter((l) => isDelivered(l.id) && !state.read.includes(l.id)).length;
  }

  function requireDelivered(id) {
    const letter = byId.get(id);
    if (!letter) {
      throw new LettersError(LettersErrorCode.UNKNOWN_LETTER, `Unknown letter: ${id}`, { id });
    }
    if (!isDelivered(id)) {
      throw new LettersError(LettersErrorCode.NOT_DELIVERED, `Letter not delivered: ${id}`, { id });
    }
    return letter;
  }

  /** Read a delivered letter (marks it read) and return its contents. */
  async function open(id) {
    const letter = requireDelivered(id);
    if (!state.read.includes(id)) {
      state.read.push(id);
      await persist();
    }
    return {
      id: letter.id,
      from: letter.from,
      subject: letter.subject,
      body: [...letter.body],
      gift: letter.gift,
      claimed: state.claimed.includes(id),
    };
  }

  /** Claim a delivered letter's coin gift (once). */
  async function claimGift(id) {
    const letter = requireDelivered(id);
    if (letter.gift <= 0) {
      throw new LettersError(LettersErrorCode.NO_GIFT, `Letter has no gift: ${id}`, { id });
    }
    if (state.claimed.includes(id)) {
      throw new LettersError(LettersErrorCode.ALREADY_CLAIMED, `Gift already claimed: ${id}`, { id });
    }
    if (!transaction || typeof transaction.execute !== "function") {
      throw new LettersError(LettersErrorCode.CLAIM_UNAVAILABLE, "Claiming needs deps.transaction", { id });
    }

    const result = await transaction.execute({ amount: letter.gift, kind: "credit", reason: `letters:gift:${id}` });
    if (!result || result.ok !== true) {
      throw new LettersError(LettersErrorCode.TRANSACTION_FAILED, `Gift credit failed for ${id}`, { id, result });
    }

    state.claimed.push(id);
    await persist();
    return { ok: true, id, gift: letter.gift, balance: result.balance };
  }

  function getState() {
    return {
      flags: [...state.flags],
      delivered: { ...state.delivered },
      read: [...state.read],
      claimed: [...state.claimed],
    };
  }

  return { init, refresh, trigger, listInbox, unreadCount, open, claimGift, isDelivered, getState, storageKey };
}
