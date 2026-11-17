/**
 * V1 Economy Profile (Phase 4B prerequisite) — sandbox / sim config only.
 *
 * A set of construction-time config OVERRIDES that neutralize legacy, pre-V1 GP
 * rewards so a from-0-GP economy test reflects ONLY the confirmed Income rules
 * (daily +5 / entry +4 / consume +3) plus the mainline spends. It changes NOTHING
 * in the business modules: it is derived FROM their exported DEFAULT_* data with
 * the reward / gift fields zeroed, and is passed to createXModule(deps, { ... }).
 * The modules, their DEFAULT_* data and their rules are untouched.
 *
 * Legacy GP isolated:
 *   • Collection set rewards   — Dairy 100, Greens 50   -> 0
 *   • Story chapter rewards    — ch2 20, ch3 50, ch4 100 -> 0 (story skips the
 *     credit entirely when reward <= 0, so no ledger entry)
 *   • Letters gifts            — grandma 50, guild 30    -> 0 (claimGift throws
 *     NO_GIFT for gift <= 0, so a claim can never inject GP)
 *
 * The two finalized Fri detector-mainline letters (fri-detector-clue,
 * fri-frostpeak-clue) are kept verbatim — already gift 0 — so their trigger and
 * read behavior is byte-for-byte unaffected.
 *
 * NOTE: a reward-0 collection claim writes NO wallet transaction and NO ledger
 * line — collection.claimSet skips transaction.execute when reward <= 0 (fixed
 * 2026-11-17 with the user's approval). A V1 run's ledger therefore carries only
 * real income + mainline entries.
 */
import { DEFAULT_SETS } from "../collection/collection.js";
import { DEFAULT_CHAPTERS } from "../story/story.js";
import { DEFAULT_LETTERS } from "../letters/letters.js";

/** The separate sandbox namespace for V1 economy runs — never the 300-GP dev save ("playground"). */
export const V1_NAMESPACE = "v1";

/** Letter ids that are confirmed V1 mainline content and must stay verbatim. */
export const V1_MAINLINE_LETTER_IDS = Object.freeze(["fri-detector-clue", "fri-frostpeak-clue"]);

/** Collection sets with completion rewards zeroed (ids / names / catalog untouched). */
export const V1_COLLECTION_SETS = DEFAULT_SETS.map((s) => ({ ...s, reward: 0 }));

/** Story chapters with unlock rewards zeroed (requires / beats / titles untouched). */
export const V1_STORY_CHAPTERS = DEFAULT_CHAPTERS.map((c) => ({
  ...c,
  requires: [...c.requires],
  beats: [...c.beats],
  reward: 0,
}));

/**
 * Letters with every NON-Fri-mainline gift zeroed. Fri's two letters are kept
 * exactly (already gift 0); legacy senders still deliver and can be read, but
 * carry no GP, so no claim can inject legacy GP into the V1 wallet.
 */
export const V1_LETTERS = DEFAULT_LETTERS.map((l) => ({
  ...l,
  requires: [...(l.requires ?? [])],
  body: [...l.body],
  gift: V1_MAINLINE_LETTER_IDS.includes(l.id) ? (l.gift ?? 0) : 0,
}));

/**
 * The full profile. Spread each piece into the matching createXModule options:
 *   createCollectionModule(deps, V1_ECONOMY_PROFILE.collection)
 *   createStoryModule(deps,      V1_ECONOMY_PROFILE.story)
 *   createLettersModule(deps,    V1_ECONOMY_PROFILE.letters)
 * Income keeps its DEFAULT rates — they ARE the confirmed V1 income rules.
 */
export const V1_ECONOMY_PROFILE = Object.freeze({
  namespace: V1_NAMESPACE,
  collection: Object.freeze({ sets: V1_COLLECTION_SETS }),
  story: Object.freeze({ chapters: V1_STORY_CHAPTERS }),
  letters: Object.freeze({ letters: V1_LETTERS }),
});
