/**
 * Story module (Developer B — game / progression).
 *
 * The story is a set of chapters, each gated by progress flags that the rest of
 * the game raises as the player acts (e.g. "repair:any", "voyage:complete",
 * "collection:dairy"). When a chapter's required flags are all set it unlocks:
 * its narrative beats become readable and, if it carries a reward, coins are
 * credited (best-effort — the story never breaks if the economy call fails).
 * Flags, unlocked chapters and granted rewards are persisted.
 *
 * Game-side logic only. A's domains are reached strictly through the injected
 * ports in ./ports.js — story never imports food / economy / infrastructure.
 * Progress flags are plain internal calls, not A interfaces.
 *
 * @typedef {import("./ports.js").StoryDeps} StoryDeps
 */

export const DEFAULT_STORAGE_KEY = "game.story";

/**
 * Default chapters, in display order. `requires` lists flags that must all be
 * set for the chapter to unlock; `reward` is coins credited on unlock; `beats`
 * are the narrative lines revealed once unlocked. Game-design data (movable to
 * app/src/config/ later by agreement).
 */
export const DEFAULT_CHAPTERS = [
  {
    id: "ch1",
    title: "A cold awakening",
    requires: [],
    reward: 0,
    beats: ["The fridge hums to life in an empty kitchen.", "Something is not quite right inside."],
  },
  {
    id: "ch2",
    title: "First repairs",
    requires: ["repair:any"],
    reward: 20,
    beats: ["A rattle settles. The cold feels a little more honest now."],
  },
  {
    id: "ch3",
    title: "Set sail",
    requires: ["voyage:complete"],
    reward: 50,
    beats: ["The fridge returns from its first voyage, humming a sea shanty."],
  },
  {
    id: "ch4",
    title: "The full pantry",
    requires: ["collection:dairy", "collection:greens"],
    reward: 100,
    beats: ["Shelves full, labels proud. The kitchen feels like home."],
  },
];

export const StoryErrorCode = Object.freeze({
  UNKNOWN_CHAPTER: "UNKNOWN_CHAPTER",
  CHAPTER_LOCKED: "CHAPTER_LOCKED",
});

export class StoryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "StoryError";
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
 * @param {StoryDeps} deps
 * @param {{ chapters?: typeof DEFAULT_CHAPTERS, storageKey?: string }} [options]
 */
export function createStoryModule(deps, options = {}) {
  const { gameStorage, clock, transaction } = deps ?? {};
  if (!gameStorage || typeof gameStorage.load !== "function" || typeof gameStorage.save !== "function") {
    throw new TypeError("story: deps.gameStorage.load/save are required");
  }

  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const chapters = (options.chapters ?? DEFAULT_CHAPTERS).map((c) => ({ ...c, requires: [...c.requires], beats: [...c.beats] }));
  const chapterById = new Map(chapters.map((c) => [c.id, c]));

  /** @type {{ flags: string[], unlocked: Record<string, { at: string | null, reward: number }> }} */
  let state = { flags: [], unlocked: {} };

  async function persist() {
    await gameStorage.save({ key: storageKey, flags: state.flags, unlocked: state.unlocked });
  }

  function isUnlocked(chapterId) {
    return Boolean(state.unlocked[chapterId]);
  }

  function requirementsMet(chapter) {
    return chapter.requires.every((f) => state.flags.includes(f));
  }

  /** Unlock any chapters whose requirements are now met. Returns their ids. */
  async function evaluate() {
    const at = toISODate(clock ? await clock.getLocalDate() : null);
    const newly = [];
    for (const chapter of chapters) {
      if (isUnlocked(chapter.id) || !requirementsMet(chapter)) continue;

      let granted = 0;
      if (chapter.reward > 0 && transaction && typeof transaction.execute === "function") {
        try {
          const result = await transaction.execute({ amount: chapter.reward, kind: "credit", reason: `story:reward:${chapter.id}` });
          if (result && result.ok === true) granted = chapter.reward;
        } catch {
          /* best-effort: never block story progress on an economy failure */
        }
      }
      state.unlocked[chapter.id] = { at, reward: granted };
      newly.push(chapter.id);
    }
    return newly;
  }

  async function init() {
    const loaded = await gameStorage.load(storageKey);
    if (loaded && typeof loaded === "object") {
      state = {
        flags: Array.isArray(loaded.flags) ? [...loaded.flags] : [],
        unlocked: loaded.unlocked && typeof loaded.unlocked === "object" ? { ...loaded.unlocked } : {},
      };
    } else {
      state = { flags: [], unlocked: {} };
    }
    const newly = await evaluate(); // ch1 (no requirements) unlocks on first run
    await persist();
    return { newlyUnlocked: newly, ...getProgress() };
  }

  /** Raise a progress flag and unlock any chapters it completes. */
  async function trigger(flag) {
    if (!state.flags.includes(flag)) state.flags.push(flag);
    const newly = await evaluate();
    await persist();
    return { newlyUnlocked: newly.map((id) => ({ id, reward: state.unlocked[id].reward })) };
  }

  function listChapters() {
    return chapters.map((c) => ({
      id: c.id,
      title: c.title,
      requires: [...c.requires],
      reward: c.reward,
      unlocked: isUnlocked(c.id),
      unlockedAt: state.unlocked[c.id]?.at ?? null,
    }));
  }

  /** The latest (highest display-order) unlocked chapter, or null. */
  function current() {
    let latest = null;
    for (const c of chapters) {
      if (isUnlocked(c.id)) latest = { id: c.id, title: c.title };
    }
    return latest;
  }

  /** Narrative beats for an unlocked chapter. */
  function getBeats(chapterId) {
    const chapter = chapterById.get(chapterId);
    if (!chapter) {
      throw new StoryError(StoryErrorCode.UNKNOWN_CHAPTER, `Unknown chapter: ${chapterId}`, { chapterId });
    }
    if (!isUnlocked(chapterId)) {
      throw new StoryError(StoryErrorCode.CHAPTER_LOCKED, `Chapter is locked: ${chapterId}`, { chapterId, requires: chapter.requires });
    }
    return [...chapter.beats];
  }

  function getProgress() {
    return {
      flags: [...state.flags],
      unlocked: Object.keys(state.unlocked),
      current: current(),
    };
  }

  return { init, trigger, listChapters, getBeats, current, isUnlocked, getProgress, storageKey };
}
