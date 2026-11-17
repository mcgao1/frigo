/**
 * Phase 4A, Part 5 — refresh-recovery integration test.
 *
 * Wires ALL EIGHT game modules (repair, detector, voyage, exploration, collection,
 * story, letters, income) on the persistent sandbox backend and proves that a real
 * browser refresh — a brand-new backend + brand-new module instances over the SAME
 * localStorage — restores every piece of game state; that Sandbox Reset returns to a
 * defined clean start (with date-gated starter letters re-delivering by their rules);
 * that an unavailable localStorage is reported non-persistent instead of silently
 * faking recovery; and that advancing the day + reloading never re-grants the daily
 * login GP. This is the automated form of what was hand-verified in the playground.
 *
 * Run with `node --test src/game/sandbox/refresh-recovery.test.js` from app/.
 * No business module is modified; these are B's sandbox tools only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createRepairModule } from "../repair/repair.js";
import { createDetectorModule, DETECTOR_DIG_COUNT, DETECTOR_FLAGS } from "../detector/detector.js";
import { createVoyageModule } from "../voyage/voyage.js";
import { createExplorationModule } from "../exploration/exploration.js";
import { createCollectionModule } from "../collection/collection.js";
import { createStoryModule } from "../story/story.js";
import { createLettersModule } from "../letters/letters.js";
import { createIncomeModule } from "../income/income.js";
import { createSequenceRandom } from "../repair/mocks.js";
import { createMockFood } from "../detector/mocks.js";

import { createSandboxBackend } from "./sandboxBackend.js";
import { createFakeLocalStorage, createBlockedLocalStorage } from "./localStorageStorage.js";

const PLANETS = [
  { id: "home", name: "Home kitchen" },
  { id: "frostpeak", name: "Frostpeak" },
];
// A's domain (food) is NOT persisted by B — on a real refresh A re-provides the
// fridge, so each boot gets a fresh food mock with the same fixture.
const FOOD_FIXTURE = [
  { id: "milk1", name: "Milk", kind: "milk", freshness: 0.8, spoilsOn: "2026-11-14" },
  { id: "cheese1", name: "Cheese", kind: "cheese", freshness: 0.6, spoilsOn: "2026-11-21" },
  { id: "yogurt1", name: "Yogurt", kind: "yogurt", freshness: 0.3, spoilsOn: "2026-11-11" },
];

let seq = 0;
const uniqNs = () => `test-refresh-${Date.now()}-${seq++}`;

/**
 * Boot the whole game on a sandbox backend over `backend` (a Web Storage) under
 * `namespace`. Calling boot() again with the SAME backend + namespace is a browser
 * refresh: a fresh backend + fresh module instances re-hydrating from localStorage.
 */
function boot(backend, namespace, { startBalance = 0, startDate = "2026-11-09" } = {}) {
  const be = createSandboxBackend({ namespace, backend, startBalance, startDate });
  const food = createMockFood(FOOD_FIXTURE);
  const infrastructure = { applyRepair: async () => ({ ok: true }) };
  const base = () => ({ wallet: be.wallet, transaction: be.transaction, gameStorage: be.gameStorage, clock: be.clock });

  const repair = createRepairModule({ ...base(), infrastructure }, { random: createSequenceRandom([0]) });
  const detector = createDetectorModule({ ...base(), food });
  const voyage = createVoyageModule(
    { ...base() },
    { requirementsMet: () => repair.isComplete() && detector.isRepaired(), planets: PLANETS },
  );
  const exploration = createExplorationModule({ ...base() });
  const collection = createCollectionModule({ ...base(), food });
  const story = createStoryModule({ ...base() });
  const letters = createLettersModule({ ...base() });
  const income = createIncomeModule({ ...base() });
  return { be, food, wallet: be.wallet, transaction: be.transaction, repair, detector, voyage, exploration, collection, story, letters, income };
}

async function initAll(w) {
  for (const m of [w.repair, w.detector, w.voyage, w.exploration, w.collection, w.story, w.letters, w.income]) {
    await m.init();
  }
}
async function buildFridge(repair) {
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push((await repair.buy()).fragment);
  for (const id of ids) await repair.install(id);
}
async function recordUseDays(detector, dates) {
  for (const d of dates) await detector.recordUseDay(d);
}
async function digUp(detector) {
  for (let i = 0; i < DETECTOR_DIG_COUNT; i++) await detector.dig();
}
const USE_DAYS = ["2026-11-09", "2026-11-10", "2026-11-11"];

// 1 — GP balance + ledger.
test("a refresh restores the GP balance and the full ledger", async () => {
  const storage = createFakeLocalStorage();
  const ns = uniqNs();

  const a = boot(storage, ns, { startBalance: 40 });
  await initAll(a);
  await a.transaction.execute({ amount: 10, kind: "credit", reason: "income:daily" });
  await a.transaction.execute({ amount: 5, kind: "debit", reason: "explore:dig" });
  assert.equal(a.be.wallet.getBalance(), 45);

  const b = boot(storage, ns, { startBalance: 40 });
  await initAll(b);
  assert.equal(b.be.wallet.getBalance(), 45);
  assert.deepEqual(b.be.money.getState().ledger.map((e) => [e.kind, e.reason, e.balance]), [
    ["credit", "income:daily", 50],
    ["debit", "explore:dig", 45],
  ]);
});

// 2 — the six fridge fragments (owned + installed).
test("a refresh restores the six fridge fragments (owned + installed)", async () => {
  const storage = createFakeLocalStorage();
  const ns = uniqNs();

  const a = boot(storage, ns, { startBalance: 100 });
  await initAll(a);
  await buildFridge(a.repair);
  assert.equal(a.repair.isComplete(), true);

  const b = boot(storage, ns, { startBalance: 100 });
  await initAll(b);
  assert.equal(b.repair.isComplete(), true);
  assert.equal(b.repair.getProgress().installed, 6);
  assert.equal(b.be.wallet.getBalance(), 100 - 30); // the 30 GP spend persisted too
});

// 3 — detector use-days, mid-dig progress, found, repaired.
test("a refresh restores detector use-days, dig progress, found and repaired", async () => {
  const storage = createFakeLocalStorage();
  const ns = uniqNs();

  const a = boot(storage, ns, { startBalance: 100 });
  await initAll(a);
  await recordUseDays(a.detector, USE_DAYS);
  await a.detector.dig();
  await a.detector.dig(); // 2 of 3 — not found yet
  assert.equal(a.detector.isFound(), false);

  const b = boot(storage, ns, { startBalance: 100 });
  await initAll(b);
  const p = b.detector.getProgress();
  assert.equal(p.useDays, 3);
  assert.equal(p.digs, 2); // mid-dig progress survived
  assert.equal(p.found, false);

  await b.detector.dig(); // 3rd dig -> found
  assert.equal(b.detector.isFound(), true);
  await b.detector.repair();
  assert.equal(b.detector.isRepaired(), true);

  const c = boot(storage, ns, { startBalance: 100 });
  await initAll(c);
  assert.equal(c.detector.isFound(), true);
  assert.equal(c.detector.isRepaired(), true);
});

// 4 — Fri letter delivery + read state.
test("a refresh restores Fri letter delivery and read state, and never re-delivers", async () => {
  const storage = createFakeLocalStorage();
  const ns = uniqNs();

  const a = boot(storage, ns, { startBalance: 100 });
  await initAll(a);
  await a.letters.trigger(DETECTOR_FLAGS.READY); // deliver fri-detector-clue
  await a.letters.open("fri-detector-clue"); // read it
  assert.equal(a.letters.isDelivered("fri-detector-clue"), true);

  const b = boot(storage, ns, { startBalance: 100 });
  await initAll(b);
  assert.equal(b.letters.isDelivered("fri-detector-clue"), true);
  assert.ok(b.letters.getState().read.includes("fri-detector-clue"));
  assert.deepEqual((await b.letters.trigger(DETECTOR_FLAGS.READY)).newlyDelivered, []); // no re-deliver
});

// 5 — voyage planet + departed state.
test("a refresh restores the voyage planet and departed state", async () => {
  const storage = createFakeLocalStorage();
  const ns = uniqNs();

  const a = boot(storage, ns, { startBalance: 55 });
  await initAll(a);
  await buildFridge(a.repair); // -30
  await recordUseDays(a.detector, USE_DAYS);
  await digUp(a.detector);
  await a.detector.repair(); // -10
  const dep = await a.voyage.depart(); // -15
  assert.equal(dep.planet.id, "frostpeak");
  assert.equal(a.be.wallet.getBalance(), 0);

  const b = boot(storage, ns, { startBalance: 55 });
  await initAll(b);
  const st = b.voyage.getState();
  assert.equal(st.planet.id, "frostpeak");
  assert.equal(st.planetIndex, 1);
  assert.equal(st.arrivals.length, 1);
  assert.equal(b.be.wallet.getBalance(), 0);
});

// 6 — the simulated date.
test("the simulated date is consistent after a refresh", async () => {
  const storage = createFakeLocalStorage();
  const ns = uniqNs();

  const a = boot(storage, ns);
  await initAll(a);
  a.be.clock._advanceDays(5); // -> 2026-11-14
  assert.equal(a.be.clock.getLocalDate(), "2026-11-14");

  const b = boot(storage, ns);
  await initAll(b);
  assert.equal(b.be.clock.getLocalDate(), "2026-11-14"); // resumes the same day
});

// 7 — collection / exploration / story all recover too (the remaining three modules).
test("a refresh restores collection discoveries, exploration digs and story flags", async () => {
  const storage = createFakeLocalStorage();
  const ns = uniqNs();

  const a = boot(storage, ns, { startBalance: 20 });
  await initAll(a);
  await a.collection.sync(); // discover the fridge fixture kinds
  await a.exploration.dig(); // -5, one dig
  await a.story.trigger("repair:any"); // raise a story flag
  const discovered = a.collection.listCatalog().filter((c) => c.discovered).length;
  assert.ok(discovered >= 3);

  const b = boot(storage, ns, { startBalance: 20 });
  await initAll(b);
  assert.equal(b.collection.listCatalog().filter((c) => c.discovered).length, discovered);
  assert.equal(b.exploration.getSnapshot().digs, 1);
  assert.ok(b.story.getProgress().flags.includes("repair:any"));
});

// 8 — Reset clears everything to the defined initial state (wallet + sim time + modules).
test("Reset clears game state, wallet and sim time to the defined initial state", async () => {
  const storage = createFakeLocalStorage();
  const ns = uniqNs();

  const w = boot(storage, ns, { startBalance: 0 });
  await initAll(w);
  await w.income.openDay(); // +5
  await w.transaction.execute({ amount: 50, kind: "credit" });
  await buildFridge(w.repair); // -30
  await recordUseDays(w.detector, ["2026-11-09", "2026-11-10"]);
  w.be.clock._advanceDays(3);
  assert.ok(w.be.wallet.getBalance() > 0);

  w.be.reset(); // in place: wallet -> 0, clock -> startDate, namespace wiped
  assert.equal(w.be.wallet.getBalance(), 0);
  assert.equal(w.be.clock.getLocalDate(), "2026-11-09");

  // a refresh after reset re-hydrates every module to its clean initial state
  const after = boot(storage, ns, { startBalance: 0 });
  await initAll(after);
  assert.equal(after.be.wallet.getBalance(), 0);
  assert.equal(after.be.clock.getLocalDate(), "2026-11-09");
  assert.equal(after.income.getSnapshot().earned, 0);
  assert.equal(after.detector.getProgress().useDays, 0);
  assert.equal(after.repair.isComplete(), false);
  assert.equal(after.letters.listInbox().length, 0); // nothing due at 2026-11-09
});

// 9 — after Reset, date-gated starter letters re-deliver by the default rules.
test("after Reset, date-gated starter letters re-deliver per the default date rules", async () => {
  const storage = createFakeLocalStorage();
  const ns = uniqNs();

  // start on a day when welcome (11-10) + grandma (11-12) are due, so they deliver
  const a = boot(storage, ns, { startBalance: 0, startDate: "2026-11-12" });
  await initAll(a);
  assert.equal(a.letters.isDelivered("welcome"), true);
  assert.equal(a.letters.isDelivered("grandma"), true);
  await a.letters.open("welcome");

  a.be.reset(); // wipes delivered + read; clock back to 2026-11-12

  const b = boot(storage, ns, { startBalance: 0, startDate: "2026-11-12" });
  await initAll(b);
  assert.equal(b.letters.isDelivered("welcome"), true); // date rule re-applies
  assert.equal(b.letters.isDelivered("grandma"), true);
  assert.equal(b.letters.getState().read.includes("welcome"), false); // read state was wiped
});

// 10 — localStorage unavailable: explicitly non-persistent, no false recovery.
test("when localStorage is unavailable, state is non-persistent and a refresh recovers nothing", async () => {
  const backend = createBlockedLocalStorage();
  const ns = uniqNs();

  const a = boot(backend, ns, { startBalance: 0 });
  assert.equal(a.be.isPersistent, false); // honestly reported
  await initAll(a);
  await a.income.openDay(); // +5
  await a.transaction.execute({ amount: 50, kind: "credit" });
  await a.repair.buy(); // owns one fragment
  assert.ok(a.be.wallet.getBalance() > 0);
  assert.equal(a.repair.getProgress().owned, 1);

  const b = boot(backend, ns, { startBalance: 0 });
  assert.equal(b.be.isPersistent, false);
  await initAll(b);
  assert.equal(b.be.wallet.getBalance(), 0); // explicitly lost — not a silent "recovered"
  assert.equal(b.repair.getProgress().owned, 0);
  assert.equal(b.income.getSnapshot().earned, 0);
});

// 11 — advancing the day + reloading never re-grants the daily-login GP.
test("advancing the day and reloading never re-grants the daily-login GP", async () => {
  const storage = createFakeLocalStorage();
  const ns = uniqNs();

  const a = boot(storage, ns, { startBalance: 0 });
  await initAll(a);
  assert.equal((await a.income.openDay()).credited, true);
  assert.equal(a.be.wallet.getBalance(), 5);

  // refresh on the SAME day -> opening again earns nothing
  const b = boot(storage, ns, { startBalance: 0 });
  await initAll(b);
  assert.equal((await b.income.openDay()).credited, false);
  assert.equal(b.be.wallet.getBalance(), 5);

  // advance one day -> one new daily open earns
  b.be.clock._advanceDays(1);
  assert.equal((await b.income.openDay()).credited, true);
  assert.equal(b.be.wallet.getBalance(), 10);

  // refresh on day 2 -> still no re-grant, and the day is preserved
  const c = boot(storage, ns, { startBalance: 0 });
  await initAll(c);
  assert.equal(c.be.clock.getLocalDate(), b.be.clock.getLocalDate());
  assert.equal((await c.income.openDay()).credited, false);
  assert.equal(c.be.wallet.getBalance(), 10);
  assert.equal(c.income.getSnapshot().earned, 10);
});

// 12 — two sandbox namespaces on one storage stay isolated across refresh.
test("two sandbox namespaces on one storage stay isolated across refresh", async () => {
  const storage = createFakeLocalStorage();
  const nsA = uniqNs();
  const nsB = uniqNs();

  const a1 = boot(storage, nsA, { startBalance: 0 });
  const b1 = boot(storage, nsB, { startBalance: 0 });
  await initAll(a1);
  await initAll(b1);
  await a1.transaction.execute({ amount: 100, kind: "credit" });
  a1.be.clock._advanceDays(4);
  await b1.transaction.execute({ amount: 7, kind: "credit" });

  const a2 = boot(storage, nsA, { startBalance: 0 });
  const b2 = boot(storage, nsB, { startBalance: 0 });
  await initAll(a2);
  await initAll(b2);
  assert.equal(a2.be.wallet.getBalance(), 100);
  assert.equal(a2.be.clock.getLocalDate(), "2026-11-13");
  assert.equal(b2.be.wallet.getBalance(), 7);
  assert.equal(b2.be.clock.getLocalDate(), "2026-11-09"); // untouched by A
});

// 13 — the first-loop mainline survives a mid-run refresh and completes on the reloaded game.
test("the first-loop mainline survives a mid-run refresh and still finishes at Frostpeak", async () => {
  const storage = createFakeLocalStorage();
  const ns = uniqNs();

  let w = boot(storage, ns, { startBalance: 55 });
  await initAll(w);
  await buildFridge(w.repair); // -30 -> 25
  await recordUseDays(w.detector, USE_DAYS);
  await w.detector.dig(); // 1 of 3

  // refresh mid-run
  w = boot(storage, ns, { startBalance: 55 });
  await initAll(w);
  assert.equal(w.repair.isComplete(), true);
  assert.equal(w.detector.getProgress().digs, 1);
  assert.equal(w.be.wallet.getBalance(), 25);

  // finish on the reloaded game
  await w.detector.dig();
  await w.detector.dig(); // found on the 3rd
  assert.equal(w.detector.isFound(), true);
  const rep = await w.detector.repair(); // -10 -> 15
  if (rep.justRepaired) await w.letters.trigger(DETECTOR_FLAGS.REPAIRED);
  const dep = await w.voyage.depart(); // -15 -> 0
  assert.equal(dep.planet.id, "frostpeak");
  assert.equal(w.be.wallet.getBalance(), 0);

  // one more refresh: arrival + Fri's Frostpeak letter persisted
  const f = boot(storage, ns, { startBalance: 55 });
  await initAll(f);
  assert.equal(f.voyage.getState().planet.id, "frostpeak");
  assert.equal(f.letters.isDelivered("fri-frostpeak-clue"), true);
});
