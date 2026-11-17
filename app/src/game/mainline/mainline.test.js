/**
 * First-planet MAINLINE integration tests (Phase 3B).
 *
 * These are cross-module tests, not unit tests: Repair + Detector + Voyage are
 * wired onto ONE shared wallet / storage / clock (the way the app wires them)
 * and driven through the whole first loop — build the fridge, acquire + repair
 * the detector, then depart to Frostpeak. They assert the locked mainline rules,
 * the shared-wallet GP ledger, and that the detector's free "hidden dig" is fully
 * independent of the paid Exploration dig.
 *
 * Run with `node --test src/game/mainline/mainline.test.js` from app/ (also part
 * of the full-suite sweep over every src/game module test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createRepairModule, FRAGMENT_COST, RepairErrorCode } from "../repair/repair.js";
import {
  createDetectorModule, DETECTOR_REPAIR_COST, DETECTOR_DIG_COUNT, DETECTOR_FLAGS, DetectorErrorCode,
} from "../detector/detector.js";
import { createVoyageModule, VOYAGE_COST, VoyageErrorCode } from "../voyage/voyage.js";
import { createExplorationModule } from "../exploration/exploration.js";
import { createLettersModule } from "../letters/letters.js";
import { createStoryModule } from "../story/story.js";
import { createMockWalletWithTransactions, createMockStorage, createSequenceRandom } from "../repair/mocks.js";
import { createMockFood } from "../detector/mocks.js";

const PLANETS_FIRST_HOP = [
  { id: "home", name: "Home kitchen" },
  { id: "frostpeak", name: "Frostpeak" },
];

/**
 * One shared fake backend for every module — a single wallet (with one ledger),
 * one storage, one clock. `wire()` builds a fresh set of module instances bound
 * to that same backend, so calling it again simulates a reload / re-init.
 */
function makeWorld({ balance = 100, planets = PLANETS_FIRST_HOP, random } = {}) {
  const money = createMockWalletWithTransactions(balance); // ONE wallet + ONE ledger (rule 13)
  const storage = createMockStorage();                     // ONE storage for all modules
  let date = "2026-11-09";
  const clock = { getLocalDate: () => date, _set: (d) => { date = d; } };
  const food = createMockFood([]);
  const base = () => ({ wallet: money.wallet, transaction: money.transaction, gameStorage: storage, clock });

  function wire() {
    const repair = createRepairModule({ ...base() }, { random: random ?? createSequenceRandom([0]) });
    const detector = createDetectorModule({ ...base(), food });
    const voyage = createVoyageModule(
      { ...base() },
      { requirementsMet: () => repair.isComplete() && detector.isRepaired(), planets },
    );
    // Exploration shares the SAME wallet, purely so we can prove the detector
    // never routes a dig through it (rule 14). It is never called in the mainline.
    const exploration = createExplorationModule({ ...base() });
    const letters = createLettersModule({ ...base() });
    const story = createStoryModule({ ...base() });
    return { repair, detector, voyage, exploration, letters, story };
  }

  return { money, storage, clock, food, base, wire };
}

const USE_DAYS = ["2026-11-09", "2026-11-10", "2026-11-11"];

async function initAll(m) {
  await m.repair.init();
  await m.detector.init();
  await m.voyage.init();
  if (m.exploration) await m.exploration.init();
  if (m.letters) await m.letters.init();
  if (m.story) await m.story.init();
}
async function buildFridge(repair) {
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push((await repair.buy()).fragment);
  for (const id of ids) await repair.install(id);
  return ids;
}
async function recordUseDays(detector, dates = USE_DAYS) {
  let p;
  for (const d of dates) p = await detector.recordUseDay(d);
  return p;
}
async function digUpDetector(detector) {
  let r;
  for (let i = 0; i < DETECTOR_DIG_COUNT; i++) r = await detector.dig();
  return r;
}
async function acquireDetector(detector) {
  await recordUseDays(detector);
  await digUpDetector(detector);
  await detector.repair();
}
async function rejectsWith(fn, code) {
  await assert.rejects(fn, (e) => { assert.equal(e.code, code); return true; });
}
const debitsOf = (money) => money.ledger.filter((l) => l.kind === "debit");
const totalDebited = (money) => debitsOf(money).reduce((s, l) => s + l.amount, 0);

// 1 + 2 + 3: six unique fragments cost 30 GP, install is free and not repeatable.
test("fridge: six unique fragments cost 30 GP; install is free and cannot double-charge", async () => {
  const w = makeWorld({ balance: 100 });
  const m = w.wire();
  await initAll(m);

  const bought = [];
  for (let i = 0; i < 6; i++) bought.push((await m.repair.buy()).fragment);
  assert.equal(new Set(bought).size, 6);                       // all distinct — no fragment drawn twice
  assert.equal(w.money.getBalance(), 100 - 6 * FRAGMENT_COST); // exactly 30 GP spent
  await rejectsWith(() => m.repair.buy(), RepairErrorCode.ALL_OWNED); // no 7th purchase

  const afterBuys = w.money.getBalance();
  for (const id of bought) await m.repair.install(id);
  assert.equal(w.money.getBalance(), afterBuys);               // installing cost nothing
  assert.equal(m.repair.isComplete(), true);

  await rejectsWith(() => m.repair.install(bought[0]), RepairErrorCode.ALREADY_INSTALLED); // no re-install
  assert.equal(w.money.getBalance(), afterBuys);              // still no extra charge / reward
  assert.equal(totalDebited(w.money), 30);
});

// 3 + 4: day 1 and day 2 cannot enter the hidden exploration; the 3rd use day does + raises detector:ready.
test("detector hidden exploration is locked on day 1/2 and unlocks on the 3rd use day (detector:ready)", async () => {
  const w = makeWorld({ balance: 100 });
  const m = w.wire();
  await initAll(m);

  let p = await m.detector.recordUseDay("2026-11-09");
  assert.equal(p.digReady, false);
  await rejectsWith(() => m.detector.dig(), DetectorErrorCode.NOT_READY_TO_DIG); // can't explore on day 1

  p = await m.detector.recordUseDay("2026-11-10");
  assert.equal(p.digReady, false);
  await rejectsWith(() => m.detector.dig(), DetectorErrorCode.NOT_READY_TO_DIG); // nor day 2

  p = await m.detector.recordUseDay("2026-11-11");
  assert.equal(p.digReady, true);                 // 3rd distinct use day -> hidden exploration open
  assert.equal(p.justReady, true);
  assert.equal(p.flag, DETECTOR_FLAGS.READY);     // the Fri clue-letter signal fires once, here
});

// 5 + 14: the three hidden digs are free, only the 3rd finds, and NOTHING hits the wallet / Exploration.
test("hidden digs are free and deterministic; zero wallet + zero Exploration transactions", async () => {
  const w = makeWorld({ balance: 100 });
  const m = w.wire();
  await initAll(m);
  await recordUseDays(m.detector);

  const ledgerBefore = w.money.ledger.length;
  const r1 = await m.detector.dig();
  const r2 = await m.detector.dig();
  const r3 = await m.detector.dig();
  assert.equal(r1.found, false);
  assert.equal(r2.found, false);
  assert.equal(r3.found, true);                   // guaranteed on the 3rd, never earlier
  assert.equal(m.detector.getDigs(), DETECTOR_DIG_COUNT);

  assert.equal(w.money.ledger.length, ledgerBefore); // the 3 digs moved NO money (no 5 GP dig cost)
  assert.equal(w.money.ledger.filter((l) => String(l.reason).startsWith("explore:")).length, 0); // never Exploration
});

// Evidence that Detector and the paid Exploration are fully separate systems on the same wallet.
test("Detector is independent of Exploration: a real paid dig is a different, separate transaction", async () => {
  const w = makeWorld({ balance: 100 });
  const m = w.wire();
  await initAll(m);
  await acquireDetector(m.detector); // 3 free digs + repair -> detector flow produced only detector:repair debit

  const detectorReasons = w.money.ledger.map((l) => l.reason);
  assert.ok(detectorReasons.every((r) => !String(r).startsWith("explore:"))); // detector never used Exploration
  assert.equal(detectorReasons.filter((r) => r === "detector:repair").length, 1);

  // the paid Exploration dig, by contrast, DOES debit 5 GP with its own reason — a distinct system
  const before = w.money.getBalance();
  await m.exploration.dig();
  assert.equal(before - w.money.getBalance(), 5);
  assert.equal(w.money.ledger.filter((l) => l.reason === "explore:dig").length, 1);
});

// 6: detector repair costs exactly 10 GP, once.
test("detector repair debits exactly 10 GP and cannot double-charge", async () => {
  const w = makeWorld({ balance: 100 });
  const m = w.wire();
  await initAll(m);
  await recordUseDays(m.detector);
  await digUpDetector(m.detector);

  const before = w.money.getBalance();
  const rep = await m.detector.repair();
  assert.equal(before - w.money.getBalance(), DETECTOR_REPAIR_COST); // -10
  assert.equal(rep.flag, DETECTOR_FLAGS.REPAIRED);
  await rejectsWith(() => m.detector.repair(), DetectorErrorCode.ALREADY_REPAIRED);
  assert.equal(before - w.money.getBalance(), DETECTOR_REPAIR_COST); // still only one 10 GP charge
});

// 7: no departure until the FULL mainline (fridge built AND detector repaired) is met.
test("voyage is blocked until the whole mainline is complete", async () => {
  const w = makeWorld({ balance: 100 });
  const m = w.wire();
  await initAll(m);

  await rejectsWith(() => m.voyage.depart(), VoyageErrorCode.NOT_READY);      // nothing done
  await buildFridge(m.repair);
  assert.equal(m.repair.isComplete(), true);
  await rejectsWith(() => m.voyage.depart(), VoyageErrorCode.NOT_READY);      // fridge only, detector still broken
  assert.equal(await m.voyage.isReady(), false);

  await acquireDetector(m.detector);
  assert.equal(await m.voyage.isReady(), true);                               // now both prerequisites met
});

// 8: even when prerequisites are met, a balance below the fare blocks departure (and charges nothing).
test("voyage is blocked when GP < 15 even with all prerequisites met", async () => {
  const w = makeWorld({ balance: 54 }); // 30 (fridge) + 10 (detector) leaves 14 < 15
  const m = w.wire();
  await initAll(m);
  await buildFridge(m.repair);
  await acquireDetector(m.detector);
  assert.equal(w.money.getBalance(), 14);
  assert.equal(await m.voyage.isReady(), true);                                 // prerequisites OK...

  await rejectsWith(() => m.voyage.depart(), VoyageErrorCode.INSUFFICIENT_FUNDS); // ...but can't afford the fare
  assert.equal(w.money.getBalance(), 14);                                        // unchanged — no partial charge
  assert.equal(m.voyage.getState().planetIndex, 0);                             // still at home
});

// 9 + 10 + full GP ledger: 55 GP mainline, arrive at Frostpeak, no repeat depart / no double charge.
test("full mainline spends exactly 55 GP on ONE wallet, arrives at Frostpeak, and cannot re-depart", async () => {
  const w = makeWorld({ balance: 55 }); // exactly the mainline budget
  const m = w.wire();
  await initAll(m);

  await buildFridge(m.repair);       // -30
  await acquireDetector(m.detector); // -10
  assert.equal(w.money.getBalance(), VOYAGE_COST); // 15 left = exactly the fare

  const dep = await m.voyage.depart();             // -15
  assert.equal(dep.planet.id, "frostpeak");
  assert.equal(dep.planetIndex, 1);
  assert.equal(w.money.getBalance(), 0);
  assert.equal(m.voyage.getState().planet.id, "frostpeak");

  // repeat depart: Frostpeak is the hop's terminal planet -> no next planet, and no second charge
  await rejectsWith(() => m.voyage.depart(), VoyageErrorCode.NO_NEXT_PLANET);
  assert.equal(w.money.getBalance(), 0);
  assert.equal(m.voyage.getState().arrivals.length, 1); // arrived exactly once

  // the whole 55 GP flowed through ONE shared ledger: 6 fragment buys + 1 detector repair + 1 voyage fare
  assert.equal(totalDebited(w.money), 55);
  const reasons = debitsOf(w.money).map((l) => l.reason);
  assert.equal(reasons.filter((r) => String(r).startsWith("fragment:buy:")).length, 6);
  assert.equal(reasons.filter((r) => r === "detector:repair").length, 1);
  assert.equal(reasons.filter((r) => r === "voyage:depart:frostpeak").length, 1);
  assert.equal(reasons.length, 8); // nothing else touched the wallet (no exploration / income / etc.)
});

// 11: a reload restores fridge install, detector dig progress, GP balance, and voyage state.
test("re-initialization restores fridge, detector progress, GP balance, and voyage state", async () => {
  const w = makeWorld({ balance: 55 });
  let m = w.wire();
  await initAll(m);

  await buildFridge(m.repair);                 // -30 -> 25, 6 installed
  await recordUseDays(m.detector);             // 3 use days -> ready
  await m.detector.dig();
  await m.detector.dig();                       // mid-dig: 2 of 3, not yet found
  assert.equal(m.detector.isFound(), false);

  // ---- reload: brand-new module instances on the SAME storage + SAME wallet ----
  m = w.wire();
  await m.repair.init();
  const dp = await m.detector.init();
  const vp = await m.voyage.init();
  assert.equal(m.repair.isComplete(), true);   // all 6 fragments restored as installed
  assert.equal(dp.useDays, 3);
  assert.equal(dp.digs, 2);                    // partial dig progress survived (not reset)
  assert.equal(dp.found, false);
  assert.equal(w.money.getBalance(), 55 - 30); // the shared wallet balance is intact
  assert.equal(vp.planet.id, "home");

  // continue the mainline on the reloaded instances
  const found = await m.detector.dig();        // 3rd dig -> find
  assert.equal(found.found, true);
  await m.detector.repair();                   // -10 -> 15
  const dep = await m.voyage.depart();         // -15 -> 0
  assert.equal(dep.planet.id, "frostpeak");
  assert.equal(w.money.getBalance(), 0);

  // ---- reload again: voyage arrival persisted ----
  const v2 = w.wire().voyage;
  const vs = await v2.init();
  assert.equal(vs.planetIndex, 1);
  assert.equal(vs.planet.id, "frostpeak");
});

// 12: the mainline flags fire once each at the right moment and never double-fire downstream.
test("detector:ready/found/repaired and voyage:complete propagate once and do not double-fire", async () => {
  const w = makeWorld({ balance: 55 });
  const m = w.wire();
  await initAll(m);
  await buildFridge(m.repair);

  // detector:ready — one-shot on the 3rd use day only
  let r = await m.detector.recordUseDay("2026-11-09"); assert.equal(r.justReady, false);
  r = await m.detector.recordUseDay("2026-11-10");     assert.equal(r.justReady, false);
  r = await m.detector.recordUseDay("2026-11-11");     assert.equal(r.justReady, true);
  if (r.justReady) { await m.letters.trigger(DETECTOR_FLAGS.READY); await m.story.trigger(DETECTOR_FLAGS.READY); }
  r = await m.detector.recordUseDay("2026-11-12");     assert.equal(r.justReady, false); // never again

  // detector:found — one-shot on the finding dig only
  const d1 = await m.detector.dig(); assert.equal(d1.justFound, false);
  const d2 = await m.detector.dig(); assert.equal(d2.justFound, false);
  const d3 = await m.detector.dig(); assert.equal(d3.justFound, true);
  await m.letters.trigger(DETECTOR_FLAGS.FOUND); await m.story.trigger(DETECTOR_FLAGS.FOUND);

  // detector:repaired — one-shot on repair
  const rep = await m.detector.repair(); assert.equal(rep.justRepaired, true);
  await m.letters.trigger(DETECTOR_FLAGS.REPAIRED); await m.story.trigger(DETECTOR_FLAGS.REPAIRED);

  // voyage:complete — raised by the app after a successful depart
  await m.voyage.depart();
  await m.letters.trigger("voyage:complete"); await m.story.trigger("voyage:complete");
  // triggering a flag twice must not store it twice (letters/story dedup) -> no double-fire
  await m.letters.trigger("voyage:complete"); await m.story.trigger("voyage:complete");

  const lf = m.letters.getState().flags;
  const sf = m.story.getProgress().flags;
  for (const flag of [DETECTOR_FLAGS.READY, DETECTOR_FLAGS.FOUND, DETECTOR_FLAGS.REPAIRED, "voyage:complete"]) {
    assert.equal(lf.filter((x) => x === flag).length, 1, `letters flag once: ${flag}`);
    assert.equal(sf.filter((x) => x === flag).length, 1, `story flag once: ${flag}`);
  }
  // story chapter ch3 ("Set sail") really does unlock from voyage:complete (an existing consumer)
  assert.equal(m.story.isUnlocked("ch3"), true);
});

// Review guard (Part 5): a day's repeated app-opens never double-count a use day.
test("multiple app-opens on the same local day count as ONE use day", async () => {
  const w = makeWorld({ balance: 100 });
  const m = w.wire();
  await initAll(m);

  await m.detector.recordUseDay("2026-11-09");
  await m.detector.recordUseDay("2026-11-09"); // opened again, same day
  await m.detector.recordUseDay("2026-11-09");
  assert.equal(m.detector.getUseDays(), 1);

  await m.detector.recordUseDay("2026-11-10");
  await m.detector.recordUseDay("2026-11-09"); // a stale / replayed earlier date
  assert.equal(m.detector.getUseDays(), 2);    // neither the repeat nor the stale date inflated the tally
});

// Review guard (Part 5): KNOWN idempotency gap — each free-dig CALL advances digCount.
// A double-delivered dig event would double-count toward the 3; logged as a Pending risk, not fixed here.
test("KNOWN GAP: repeated free-dig calls each advance digCount (no idempotency key yet)", async () => {
  const w = makeWorld({ balance: 100 });
  const m = w.wire();
  await initAll(m);
  await recordUseDays(m.detector);

  await m.detector.dig();
  await m.detector.dig();
  assert.equal(m.detector.getDigs(), 2); // two calls = two digs; a ret/double-delivered dig would also count
});

// Phase 3C: Fri's clue letters deliver at their milestones during the real mainline,
// stay unread, carry no GP, and never gate dig / repair / depart.
test("Fri's clue letters deliver at milestones, unread + giftless, without blocking the mainline", async () => {
  const w = makeWorld({ balance: 55 });
  const m = w.wire();
  await initAll(m);
  await buildFridge(m.repair);

  // 3rd use day -> detector:ready -> Fri's clue letter (the app raises the flag on justReady)
  let p;
  for (const d of USE_DAYS) {
    p = await m.detector.recordUseDay(d);
    if (p.justReady) await m.letters.trigger(DETECTOR_FLAGS.READY);
  }
  assert.equal(m.letters.isDelivered("fri-detector-clue"), true);
  assert.equal(m.letters.isDelivered("fri-frostpeak-clue"), false); // not until repair

  // three free digs find the detector WITHOUT anyone opening the letter (unread must not block)
  const found = await digUpDetector(m.detector);
  assert.equal(found.found, true);
  assert.equal(m.letters.getState().read.includes("fri-detector-clue"), false); // still unread

  // repair -> detector:repaired -> Fri's Frostpeak letter
  const rep = await m.detector.repair();
  if (rep.justRepaired) await m.letters.trigger(DETECTOR_FLAGS.REPAIRED);
  assert.equal(m.letters.isDelivered("fri-frostpeak-clue"), true);

  // departure still works with BOTH letters unread
  const dep = await m.voyage.depart();
  assert.equal(dep.planet.id, "frostpeak");

  // the mainline letters added NO GP: the 55 GP ledger is unchanged, with no letters:* entries
  assert.equal(totalDebited(w.money), 55);
  assert.equal(w.money.ledger.filter((l) => String(l.reason).startsWith("letters:")).length, 0);
  const inbox = m.letters.listInbox();
  for (const id of ["fri-detector-clue", "fri-frostpeak-clue"]) {
    assert.equal(inbox.find((x) => x.id === id).hasGift, false); // giftless in the inbox
  }
});
