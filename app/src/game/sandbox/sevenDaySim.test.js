/**
 * Phase 4B — from-0-GP seven-day V1 economy simulation.
 *
 * Drives ALL EIGHT game modules on ONE shared persistent sandbox backend (wallet /
 * storage / clock), with the V1 Economy Profile applied (legacy Collection / Story /
 * Letters GP zeroed) and startBalance 0, through a realistic 7-day play-through.
 * Every GP is earned or spent by a REAL module call against the REAL V1 rules — the
 * test never credits GP directly to "reach" a target and never skips a business rule.
 * The headline run is proven against the full wallet ledger, reason-by-reason.
 *
 * Standard ("normal player") scenario, from 0 GP:
 *   income  = 7 daily opens (+5x7 = 35) + 4 entry batches (+4x4 = 16)
 *           + 2 distinct consumes (+3x2 = 6)                    = +57
 *   mainline spend = 6 fragments (-5x6 = 30) + detector repair (-10)
 *           + Frostpeak voyage (-15); the 3 detector digs are FREE = -55
 *   final balance = 2
 *
 * Also checks (the nine verifications):
 *   1. the 3rd valid use day makes the detector ready and fires Fri's clue letter
 *   2. repairing the detector fires Fri's Frostpeak letter
 *   3. you cannot depart early (NOT_READY before the mainline is done,
 *      INSUFFICIENT_FUNDS when under the fare)
 *   4. legacy Collection / Story / Letters claims inject no GP
 *   5. a refresh / repeated event never double-grants GP
 *   6. the same foodTypeId can't earn a consume reward twice the same day
 *   7. depart follows the rules; a repeat depart at Frostpeak neither moves nor re-charges
 *   8. a mid-sim refresh still lets the run finish (the headline run reboots after day 4)
 *   9. paid digging + Unknown Sender are NOT part of the standard sim (the 3 mainline
 *      digs are free; the paid exploration dig is a separate, opt-in sink)
 *
 * No business module is modified; these are B's sandbox tools only. The V1 reward
 * values are never changed — the three player-profile plans at the bottom vary only
 * how often the player acts.
 *
 * Run with `node --test src/game/sandbox/sevenDaySim.test.js` from app/.
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
import { createFakeLocalStorage } from "./localStorageStorage.js";
import { V1_ECONOMY_PROFILE } from "./v1EconomyProfile.js";

// V1 first-loop voyage: home -> Frostpeak is the capstone AND the terminal planet for
// the first loop (Brinedeep is a future-loop planet, excluded from the V1 economy sim).
// Same scenario configuration the mainline / refresh-recovery tests use — not a rule change.
const V1_PLANETS = [
  { id: "home", name: "Home kitchen" },
  { id: "frostpeak", name: "Frostpeak" },
];

// A re-provides the fridge on every (re)boot — B never persists A's food. Dairy
// (milk/cheese/yogurt) is complete so the legacy collection-claim probe can run.
const FOOD_FIXTURE = [
  { id: "milk1", name: "Milk", kind: "milk", freshness: 0.8, spoilsOn: "2026-11-20" },
  { id: "cheese1", name: "Cheese", kind: "cheese", freshness: 0.6, spoilsOn: "2026-11-28" },
  { id: "yogurt1", name: "Yogurt", kind: "yogurt", freshness: 0.3, spoilsOn: "2026-11-18" },
];

let seq = 0;
const uniqNs = () => `v1-sim-${Date.now()}-${seq++}`;

/**
 * Boot the whole V1 game on a sandbox backend over `backend` under `namespace`:
 * startBalance 0 + the V1 Economy Profile on collection / story / letters. Calling
 * boot() again with the SAME backend + namespace is a browser refresh.
 */
function boot(backend, namespace) {
  const be = createSandboxBackend({ namespace, backend, startBalance: 0, startDate: "2026-11-09" });
  const food = createMockFood(FOOD_FIXTURE);
  const infrastructure = { applyRepair: async () => ({ ok: true }) };
  const base = () => ({ wallet: be.wallet, transaction: be.transaction, gameStorage: be.gameStorage, clock: be.clock });

  const repair = createRepairModule({ ...base(), infrastructure }, { random: createSequenceRandom([0]) });
  const detector = createDetectorModule({ ...base(), food });
  const voyage = createVoyageModule(
    { ...base() },
    { requirementsMet: () => repair.isComplete() && detector.isRepaired(), planets: V1_PLANETS },
  );
  const exploration = createExplorationModule({ ...base() });
  const collection = createCollectionModule({ ...base(), food }, V1_ECONOMY_PROFILE.collection);
  const story = createStoryModule({ ...base() }, V1_ECONOMY_PROFILE.story);
  const letters = createLettersModule({ ...base() }, V1_ECONOMY_PROFILE.letters);
  const income = createIncomeModule({ ...base() });
  return { be, food, wallet: be.wallet, transaction: be.transaction, repair, detector, voyage, exploration, collection, story, letters, income };
}

async function initAll(w) {
  for (const m of [w.repair, w.detector, w.voyage, w.exploration, w.collection, w.story, w.letters, w.income]) await m.init();
}

const bal = (w) => w.be.wallet.getBalance();
const ledger = (w) => w.be.money.getState().ledger.map((e) => ({ amount: e.amount, kind: e.kind, reason: e.reason }));

/** Buy n fragments (random -> first unowned each time) and install them. -5 GP per buy. */
async function buyInstall(w, n) {
  const ids = [];
  for (let i = 0; i < n; i++) ids.push((await w.repair.buy()).fragment);
  for (const id of ids) await w.repair.install(id);
}

/** Record n distinct valid use days from the current clock date (advances the clock between them). */
async function recordUseDaysN(w, n) {
  for (let i = 0; i < n; i++) {
    await w.detector.recordUseDay();
    if (i < n - 1) w.be.clock._advanceDays(1);
  }
}

// ===========================================================================
// 1 — the headline standard 7-day run (verifications 1, 2, 3-partial, 8, 9 woven in)
// ===========================================================================
test("standard V1 7-day sim: 0 GP -> +57 income / -55 mainline -> balance 2, with a mid-sim refresh", async () => {
  const storage = createFakeLocalStorage();
  const ns = uniqNs();
  let w = boot(storage, ns);
  await initAll(w);
  assert.equal(bal(w), 0); // starts from 0 GP — nothing seeded

  const DATES = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
  const daily = []; // [{day, date, balance}] — the reported per-day table

  // ---- Day 1 (11-09): open, use-day 1, 3 entries, eat milk, build 3 fragments ----
  assert.equal(w.be.clock.getLocalDate(), DATES[0]);
  assert.equal((await w.income.openDay()).credited, true); // +5 -> 5
  assert.equal((await w.detector.recordUseDay()).justReady, false); // day 1 of 3
  for (let i = 0; i < 3; i++) assert.equal((await w.income.recordEntry(`d1-entry-${i}`)).credited, true); // +12 -> 17
  assert.equal((await w.income.recordConsume("d1-milk", "milk")).credited, true); // +3 -> 20
  assert.equal(bal(w), 20);
  await assert.rejects(() => w.voyage.depart(), (e) => e.code === "NOT_READY"); // #3: nothing built yet
  await buyInstall(w, 3); // -15 -> 5
  assert.equal(bal(w), 5);
  daily.push({ day: 1, date: DATES[0], balance: bal(w) });

  // ---- Day 2 (11-10): open, use-day 2, the 4th entry, eat cheese, build the last 3 (fridge complete) ----
  w.be.clock._advanceDays(1);
  assert.equal((await w.income.openDay()).credited, true); // +5 -> 10
  assert.equal((await w.detector.recordUseDay()).justReady, false); // day 2 of 3
  await w.letters.refresh(); // date-gated welcome (due 11-10) arrives — giftless under V1
  assert.equal((await w.income.recordEntry("d2-entry-0")).credited, true); // +4 -> 14 (4 entries total)
  assert.equal((await w.income.recordConsume("d2-cheese", "cheese")).credited, true); // +3 -> 17 (2 consumes total)
  await buyInstall(w, 3); // -15 -> 2
  assert.equal(w.repair.isComplete(), true);
  assert.equal(bal(w), 2);
  await assert.rejects(() => w.voyage.depart(), (e) => e.code === "NOT_READY"); // #3: detector not repaired yet
  daily.push({ day: 2, date: DATES[1], balance: bal(w) });

  // ---- Day 3 (11-11): open, use-day 3 -> detector READY -> Fri clue letter; dig x3 (free) -> found ----
  w.be.clock._advanceDays(1);
  assert.equal((await w.income.openDay()).credited, true); // +5 -> 7
  assert.equal((await w.detector.recordUseDay()).justReady, true); // #1a: 3rd valid use day
  const clue = await w.letters.trigger(DETECTOR_FLAGS.READY);
  assert.ok(clue.newlyDelivered.includes("fri-detector-clue")); // #1b: Fri's detector-clue letter fires
  const digBefore = bal(w);
  for (let i = 0; i < DETECTOR_DIG_COUNT; i++) {
    const r = await w.detector.dig();
    assert.equal(r.found, i === DETECTOR_DIG_COUNT - 1); // found ONLY on the 3rd dig
  }
  assert.equal(w.detector.isFound(), true);
  assert.equal(bal(w), digBefore); // #9a: the 3 mainline digs cost nothing
  assert.equal(bal(w), 7);
  daily.push({ day: 3, date: DATES[2], balance: bal(w) });

  // ---- Day 4 (11-12): open, repair detector (-10) -> Fri Frostpeak letter; still too poor to depart ----
  w.be.clock._advanceDays(1);
  assert.equal((await w.income.openDay()).credited, true); // +5 -> 12
  await w.detector.recordUseDay();
  const rep = await w.detector.repair(); // -10 -> 2
  assert.equal(rep.justRepaired, true);
  const frost = await w.letters.trigger(DETECTOR_FLAGS.REPAIRED);
  assert.ok(frost.newlyDelivered.includes("fri-frostpeak-clue")); // #2: Frostpeak letter after repair
  assert.equal(bal(w), 2);
  await assert.rejects(() => w.voyage.depart(), (e) => e.code === "INSUFFICIENT_FUNDS"); // #3: ready but 2 < 15
  daily.push({ day: 4, date: DATES[3], balance: bal(w) });

  // ===== MID-SIM REFRESH (#8): reboot the whole game from storage, continue on fresh instances =====
  w = boot(storage, ns);
  await initAll(w);
  assert.equal(bal(w), 2);
  assert.equal(w.be.clock.getLocalDate(), DATES[3]);
  assert.equal(w.repair.isComplete(), true);
  assert.equal(w.detector.isRepaired(), true);
  assert.equal(w.letters.isDelivered("fri-detector-clue"), true);
  assert.equal(w.letters.isDelivered("fri-frostpeak-clue"), true);
  assert.equal(w.income.getSnapshot().earned, 42); // 20 daily(d1-4) + 16 entry + 6 consume

  // ---- Day 5 (11-13): open only ----
  w.be.clock._advanceDays(1);
  assert.equal((await w.income.openDay()).credited, true); // +5 -> 7
  await w.detector.recordUseDay();
  assert.equal(bal(w), 7);
  daily.push({ day: 5, date: DATES[4], balance: bal(w) });

  // ---- Day 6 (11-14): open only ----
  w.be.clock._advanceDays(1);
  assert.equal((await w.income.openDay()).credited, true); // +5 -> 12
  await w.detector.recordUseDay();
  assert.equal(bal(w), 12);
  daily.push({ day: 6, date: DATES[5], balance: bal(w) });

  // ---- Day 7 (11-15): open, depart Frostpeak (-15) -> balance 2 ----
  w.be.clock._advanceDays(1);
  assert.equal((await w.income.openDay()).credited, true); // +5 -> 17
  await w.detector.recordUseDay();
  const dep = await w.voyage.depart(); // -15 -> 2
  assert.equal(dep.planet.id, "frostpeak");
  assert.equal(bal(w), 2);
  daily.push({ day: 7, date: DATES[6], balance: bal(w) });

  // ===== TOTALS =====
  assert.equal(w.income.getEarned(), 57); // income total exactly 57 (35 daily + 16 entry + 6 consume)
  assert.equal(bal(w), 2); // final balance 2

  // ===== EXACT LEDGER (anti-faking): every GP is a real module credit/debit =====
  const L = ledger(w);
  const credits = L.filter((e) => e.kind === "credit");
  const debits = L.filter((e) => e.kind === "debit");
  const sum = (a) => a.reduce((s, e) => s + e.amount, 0);
  assert.equal(sum(credits), 57);
  assert.equal(sum(debits), 55);
  // credit breakdown — only the three confirmed V1 income reasons
  assert.equal(credits.filter((e) => e.reason === "income:daily").length, 7);
  assert.equal(credits.filter((e) => e.reason === "income:entry").length, 4);
  assert.equal(credits.filter((e) => e.reason === "income:consume:milk").length, 1);
  assert.equal(credits.filter((e) => e.reason === "income:consume:cheese").length, 1);
  // NO legacy or exploration credit ever reached the wallet (#4, #9)
  assert.equal(credits.filter((e) => /^(collection:|story:|letters:|explore:)/.test(e.reason)).length, 0);
  // debit breakdown — 6 fragment buys, 1 repair, 1 voyage; NO paid dig (#9)
  assert.equal(debits.filter((e) => e.reason.startsWith("fragment:buy:")).length, 6);
  assert.equal(debits.filter((e) => e.reason === "detector:repair").length, 1);
  assert.equal(debits.filter((e) => e.reason === "voyage:depart:frostpeak").length, 1);
  assert.equal(debits.filter((e) => e.reason === "explore:dig").length, 0);

  // the reported per-day balance table
  assert.deepEqual(daily.map((d) => d.balance), [5, 2, 7, 2, 7, 12, 2]);
});

// ===========================================================================
// 2 — #3: you cannot depart early
// ===========================================================================
test("voyage can't depart early: NOT_READY before the mainline is done, INSUFFICIENT_FUNDS under the fare", async () => {
  const w = boot(createFakeLocalStorage(), uniqNs());
  await initAll(w);

  // nothing built -> NOT_READY
  await assert.rejects(() => w.voyage.depart(), (e) => e.code === "NOT_READY");

  // build the full mainline but end under the 15 GP fare (seed exactly enough to build)
  await w.transaction.execute({ amount: 40, kind: "credit", reason: "income:daily" });
  await buyInstall(w, 6); // -30 -> 10
  await recordUseDaysN(w, 3); // detector ready
  for (let i = 0; i < DETECTOR_DIG_COUNT; i++) await w.detector.dig(); // found (free)
  await w.detector.repair(); // -10 -> 0
  assert.equal(w.repair.isComplete() && w.detector.isRepaired(), true);
  assert.ok(bal(w) < 15);

  // requirements met, but under the fare -> INSUFFICIENT_FUNDS (not NOT_READY)
  await assert.rejects(() => w.voyage.depart(), (e) => e.code === "INSUFFICIENT_FUNDS");
});

// ===========================================================================
// 3 — #4: legacy Collection / Story / Letters inject no GP under the V1 profile
// ===========================================================================
test("legacy Collection / Story / Letters claims inject no GP under the V1 profile", async () => {
  const w = boot(createFakeLocalStorage(), uniqNs());
  await initAll(w);
  await w.income.openDay(); // a real +5 so earned/balance are non-zero to begin with
  const earnedBefore = w.income.getEarned();
  const balBefore = bal(w);

  // Collection: dairy is complete from the fixture -> claim returns reward 0 and writes NO ledger line
  await w.collection.sync();
  const dairy = w.collection.getSets().find((s) => s.id === "dairy");
  assert.equal(dairy.complete, true);
  assert.equal(dairy.reward, 0); // zeroed by the profile
  assert.equal((await w.collection.claimSet("dairy")).reward, 0);

  // Story: V1 chapters are reward 0 -> raising unlock flags credits nothing (story skips reward<=0)
  await w.story.trigger("repair:any");
  await w.story.trigger("fridge:complete");

  // Letters: a delivered legacy gift letter throws NO_GIFT (gift zeroed) -> no GP path
  w.be.clock._set("2026-11-12"); // grandma is due 11-12
  await w.letters.refresh();
  assert.equal(w.letters.isDelivered("grandma"), true);
  await assert.rejects(() => w.letters.claimGift("grandma"), (e) => e.code === "NO_GIFT");

  // nothing legacy reached the wallet
  assert.equal(bal(w), balBefore);
  assert.equal(w.income.getEarned(), earnedBefore);
  assert.deepEqual(ledger(w).filter((e) => /^(collection:|story:|letters:)/.test(e.reason)), []);
});

// ===========================================================================
// 4 — #5: a refresh / repeated event never double-grants GP
// ===========================================================================
test("refresh / repeated events never double-grant GP", async () => {
  const storage = createFakeLocalStorage();
  const ns = uniqNs();
  let w = boot(storage, ns);
  await initAll(w);

  assert.equal((await w.income.openDay()).credited, true); // +5
  assert.equal((await w.income.openDay()).credited, false); // same day -> no re-grant
  assert.equal(bal(w), 5);

  // reload on the SAME day -> opening again still earns nothing
  w = boot(storage, ns);
  await initAll(w);
  assert.equal((await w.income.openDay()).credited, false);
  assert.equal(bal(w), 5);

  // re-triggering a mainline flag never re-delivers (and the letter is giftless anyway)
  await recordUseDaysN(w, 3);
  assert.ok((await w.letters.trigger(DETECTOR_FLAGS.READY)).newlyDelivered.includes("fri-detector-clue"));
  assert.deepEqual((await w.letters.trigger(DETECTOR_FLAGS.READY)).newlyDelivered, []);
  assert.equal(bal(w), 5);
});

// ===========================================================================
// 5 — #6: the same foodTypeId can't earn a consume reward twice the same day
// ===========================================================================
test("the same foodTypeId can't earn a consume reward twice on the same day", async () => {
  const w = boot(createFakeLocalStorage(), uniqNs());
  await initAll(w);

  assert.equal((await w.income.recordConsume("b1", "milk")).credited, true); // +3 -> 3
  const again = await w.income.recordConsume("b2", "milk"); // different batch, same type, same day
  assert.equal(again.credited, false);
  assert.equal(again.reason, "TYPE_DONE");
  assert.equal(bal(w), 3);

  // a NEW day re-earns the same type (via a new batch)
  w.be.clock._advanceDays(1);
  assert.equal((await w.income.recordConsume("b3", "milk")).credited, true); // +3 -> 6
  assert.equal(bal(w), 6);
});

// ===========================================================================
// 6 — #7: depart follows the rules; a repeat depart at Frostpeak neither moves nor re-charges
// ===========================================================================
test("a repeat depart at the terminal planet neither moves on nor re-charges the fare", async () => {
  const w = boot(createFakeLocalStorage(), uniqNs());
  await initAll(w);
  await w.transaction.execute({ amount: 55, kind: "credit", reason: "income:daily" });
  await buyInstall(w, 6); // -30 -> 25
  await recordUseDaysN(w, 3);
  for (let i = 0; i < DETECTOR_DIG_COUNT; i++) await w.detector.dig();
  await w.detector.repair(); // -10 -> 15

  const dep = await w.voyage.depart(); // -15 -> 0
  assert.equal(dep.planet.id, "frostpeak");
  assert.equal(bal(w), 0);

  // Frostpeak is terminal in the V1 loop -> a repeat depart throws and does NOT re-charge
  await assert.rejects(() => w.voyage.depart(), (e) => e.code === "NO_NEXT_PLANET");
  assert.equal(bal(w), 0);
  assert.equal(w.voyage.getState().arrivals.length, 1); // exactly one arrival recorded
});

// ===========================================================================
// 7 — #9: paid digging is a SEPARATE opt-in sink; the 3 mainline digs are free
// ===========================================================================
test("the 3 mainline detector digs are free; the paid exploration dig is a separate -5 sink", async () => {
  const w = boot(createFakeLocalStorage(), uniqNs());
  await initAll(w);

  await recordUseDaysN(w, 3); // detector ready
  const before = bal(w);
  const beforeLen = ledger(w).length;
  for (let i = 0; i < DETECTOR_DIG_COUNT; i++) await w.detector.dig(); // the 3 mainline digs
  assert.equal(w.detector.isFound(), true);
  assert.equal(bal(w), before); // 0 wallet change across all three
  assert.equal(ledger(w).length, beforeLen); // and 0 wallet transactions

  // the OPTIONAL digging layer (exploration.dig) charges -5 — it is never called by the
  // standard sim, confirming the two digs are distinct systems.
  await w.transaction.execute({ amount: 5, kind: "credit", reason: "income:daily" });
  await w.exploration.dig();
  assert.ok(ledger(w).some((e) => e.reason === "explore:dig"));
});

/* ===========================================================================
 * PROPOSED follow-up: light / normal / active player economy plans (7-10 days)
 * ---------------------------------------------------------------------------
 * Proposals only — NOT run here, and they change NO GP reward value. Only how
 * often the player acts varies. Per-day earning is hard-capped by the existing
 * rules at  5 (daily) + 4x3 (entry cap) + 3x3 (consume cap) = 26 GP/day.
 *
 *  • LIGHT (7 days): opens ~4/7 days, ~2 entry batches total, ~1 consume total.
 *      income ~= 4*5 + 2*4 + 1*3 = 31 GP/week. Can part-build the fridge but NOT
 *      finish the 55 GP mainline in one week. Verifies: balance never goes
 *      negative, the mainline stays gated (NOT_READY), caps/dedup hold, no legacy GP.
 *
 *  • NORMAL (7 days): exactly the headline run above — opens all 7, 4 entries,
 *      2 consumes => +57, completes the first loop, ends at 2 GP.
 *
 *  • ACTIVE (10 days): opens all 10, hits the entry cap (3/day) on ~4 days and the
 *      consume cap (3/day) on ~3 days. income ~= 10*5 + 12*4 + 9*3 = 125 GP; spends
 *      the one-time 55 mainline and is left with a large surplus. Verifies: the
 *      caps clamp (never > 3 entry / 3 consume per day however many are attempted),
 *      daily earning never exceeds 26, and — as a DESIGN finding for the user —
 *      that after the first loop there is currently no GP sink for the surplus
 *      (only the one-time mainline + the optional -5 paid dig).
 * =========================================================================== */
