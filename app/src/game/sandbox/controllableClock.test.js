/**
 * Phase 4A, Part 3 — tests for the controllable + persistent clock.
 * Run with `node --test src/game/sandbox/controllableClock.test.js` from app/.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createControllableClock } from "./controllableClock.js";
import {
  createLocalStorageGameStorage,
  createFakeLocalStorage,
  createBlockedLocalStorage,
} from "./localStorageStorage.js";
import { createMockClock } from "../voyage/mocks.js";

let seq = 0;
const uniq = (p) => `${p}-${Date.now()}-${seq++}`;
const storageOn = (backend, namespace) => createLocalStorageGameStorage({ namespace, backend });

test("starts at the start date; getLocalDate returns an ISO string", () => {
  const c = createControllableClock({
    storage: storageOn(createFakeLocalStorage(), uniq("c")),
    startDate: "2026-11-17",
  });
  assert.equal(c.getLocalDate(), "2026-11-17");
  assert.match(c.getLocalDate(), /^\d{4}-\d{2}-\d{2}$/);
});

test("_set changes the date and returns it", () => {
  const c = createControllableClock({
    storage: storageOn(createFakeLocalStorage(), uniq("c")),
    startDate: "2026-11-17",
  });
  assert.equal(c._set("2026-12-01"), "2026-12-01");
  assert.equal(c.getLocalDate(), "2026-12-01");
});

test("_advanceDays moves forward by whole days, matching the voyage mock formula", () => {
  const start = "2026-11-28"; // crosses a month boundary
  const c = createControllableClock({
    storage: storageOn(createFakeLocalStorage(), uniq("c")),
    startDate: start,
  });
  const ref = createMockClock(start);
  for (const n of [1, 3, 5]) {
    assert.equal(c._advanceDays(n), ref._advanceDays(n));
  }
});

test("the current date persists across a simulated reload", () => {
  const backend = createFakeLocalStorage();
  const ns = uniq("c");

  const before = createControllableClock({ storage: storageOn(backend, ns), startDate: "2026-11-09" });
  before._advanceDays(6); // -> 2026-11-15
  assert.equal(before.getLocalDate(), "2026-11-15");

  const after = createControllableClock({ storage: storageOn(backend, ns), startDate: "2026-11-09" });
  assert.equal(after.getLocalDate(), "2026-11-15"); // resumes same day, not back to start
});

test("advancing then reloading never silently rewinds the day", () => {
  const backend = createFakeLocalStorage();
  const ns = uniq("c");

  const d1 = createControllableClock({ storage: storageOn(backend, ns), startDate: "2026-11-09" });
  d1._set("2026-11-20");

  const d2 = createControllableClock({ storage: storageOn(backend, ns), startDate: "2026-11-09" });
  assert.ok(d2.getLocalDate() >= "2026-11-20"); // the later day is preserved
});

test("_reset returns to the start date and persists", () => {
  const backend = createFakeLocalStorage();
  const ns = uniq("c");

  const c = createControllableClock({ storage: storageOn(backend, ns), startDate: "2026-11-09" });
  c._advanceDays(10);
  c._reset();
  assert.equal(c.getLocalDate(), "2026-11-09");

  const after = createControllableClock({ storage: storageOn(backend, ns), startDate: "2026-11-09" });
  assert.equal(after.getLocalDate(), "2026-11-09"); // reset was persisted
});

test("with a blocked storage it still advances in-session but resets to start on reload", () => {
  const backend = createBlockedLocalStorage();
  const ns = uniq("c");

  const before = createControllableClock({ storage: storageOn(backend, ns), startDate: "2026-11-09" });
  before._advanceDays(3);
  assert.equal(before.getLocalDate(), "2026-11-12"); // usable this session

  const after = createControllableClock({ storage: storageOn(backend, ns), startDate: "2026-11-09" });
  assert.equal(after.getLocalDate(), "2026-11-09"); // honest non-persistence, no false recovery
});

test("a storage without load/save is rejected", () => {
  assert.throws(() => createControllableClock({ storage: {} }), TypeError);
  assert.throws(() => createControllableClock({}), TypeError);
});
