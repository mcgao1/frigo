/**
 * createControllableClock — an advanceable clock with the SAME interface as the
 * voyage mock (getLocalDate / _set / _advanceDays), plus persistence: the current
 * simulated date is stored through an injected GameStorage, so after a refresh
 * the sandbox resumes on the same day instead of silently rewinding. Sandbox
 * tooling only — not A's real clock.
 *
 * getLocalDate() returns an ISO "YYYY-MM-DD" string (synchronous), exactly like
 * the module mocks, so business modules awaiting it behave identically.
 */

export const CLOCK_KEY = "game.clock";
export const DEFAULT_START_DATE = "2026-11-09";

function addDays(iso, n) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
}

/**
 * @param {{ storage: { load: Function, save: Function }, key?: string, startDate?: string }} opts
 */
export function createControllableClock({
  storage,
  key = CLOCK_KEY,
  startDate = DEFAULT_START_DATE,
} = {}) {
  if (!storage || typeof storage.load !== "function" || typeof storage.save !== "function") {
    throw new TypeError("controllableClock: a storage with load/save is required");
  }

  let current = startDate;

  function persist() {
    storage.save({ key, date: current });
  }

  const loaded = storage.load(key);
  if (loaded && typeof loaded === "object" && typeof loaded.date === "string") {
    current = loaded.date;
  } else {
    persist(); // establish the doc so a reload before any change is consistent
  }

  function getLocalDate() {
    return current;
  }

  function _set(d) {
    current = String(d);
    persist();
    return current;
  }

  function _advanceDays(n) {
    current = addDays(current, n);
    persist();
    return current;
  }

  /** In-place reset to the start date (used by Sandbox Reset). */
  function _reset() {
    current = startDate;
    persist();
    return current;
  }

  function getState() {
    return { date: current };
  }

  return { getLocalDate, _set, _advanceDays, _reset, getState, startDate, key };
}
