/**
 * Tests for the detector module (mainline acquisition flow), run against mocked
 * A ports. Run with `node --test src/game/detector/detector.test.js` from app/.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createDetectorModule, DetectorErrorCode, DETECTOR_REPAIR_COST, DETECTOR_DIG_COUNT, DETECTOR_FLAGS } from "./detector.js";
import { createMockDeps, createMockFood, createMockStorage, createMockWalletWithTransactions, createMockClock } from "./mocks.js";

const ITEMS = [
  { id: "milk", name: "Milk", freshness: 0.5, spoilsOn: "2026-11-11" },
  { id: "eggs", name: "Eggs", freshness: 0.9, spoilsOn: "2026-11-20" },
  { id: "leftovers", name: "Leftovers", freshness: 0.1, spoilsOn: "2026-11-07" },
];

/** Perform the full set of valid digs that guarantees the find. Returns the
 * finding dig's result. */
async function digUp(d) {
  let r;
  for (let i = 0; i < DETECTOR_DIG_COUNT; i++) r = await d.dig();
  return r;
}

/** Dig up + repair the detector so scan() is available. */
async function acquire(d, deps) {
  await d.recordUseDay("2026-11-09");
  await d.recordUseDay("2026-11-10");
  await d.recordUseDay("2026-11-11");
  await digUp(d);
  await d.repair();
}

test("init starts un-acquired (no use days, not found, not repaired) and subscribes to food", async () => {
  const deps = createMockDeps({ items: ITEMS });
  const d = createDetectorModule(deps);
  const p = await d.init();
  assert.equal(p.useDays, 0);
  assert.equal(p.found, false);
  assert.equal(p.repaired, false);
  assert.equal(p.digReady, false);
  assert.equal(deps.food._subscriberCount(), 1);
});

test("recordUseDay counts distinct dates only, and justReady fires once at the threshold", async () => {
  const d = createDetectorModule(createMockDeps({ items: ITEMS }));
  await d.init();

  let r = await d.recordUseDay("2026-11-09");
  assert.equal(r.useDays, 1);
  assert.equal(r.justReady, false);

  r = await d.recordUseDay("2026-11-09"); // same day again → no double count
  assert.equal(r.useDays, 1);
  assert.equal(r.justReady, false);

  r = await d.recordUseDay("2026-11-10");
  assert.equal(r.useDays, 2);
  assert.equal(r.justReady, false);

  r = await d.recordUseDay("2026-11-11"); // 3rd distinct day → ready
  assert.equal(r.useDays, 3);
  assert.equal(r.digReady, true);
  assert.equal(r.justReady, true);

  r = await d.recordUseDay("2026-11-12"); // already ready → not "just" ready again
  assert.equal(r.justReady, false);
});

test("the three valid use days need not be consecutive; day 1 and day 2 never unlock", async () => {
  const d = createDetectorModule(createMockDeps({ items: ITEMS }));
  await d.init();

  let r = await d.recordUseDay("2026-11-09"); // day 1 — a Monday, say
  assert.equal(r.useDays, 1);
  assert.equal(r.digReady, false);            // first day cannot unlock

  r = await d.recordUseDay("2026-11-13");     // day 2 — four days later (a gap)
  assert.equal(r.useDays, 2);
  assert.equal(r.digReady, false);            // second day cannot unlock either

  r = await d.recordUseDay("2026-11-20");     // day 3 — a week after that (another gap)
  assert.equal(r.useDays, 3);
  assert.equal(r.digReady, true);             // 3 DISTINCT use days, non-consecutive -> unlocked
  assert.equal(r.justReady, true);
  assert.equal(r.flag, DETECTOR_FLAGS.READY); // the "come dig it up" letter fires here
});

test("dig is gated on the use-day threshold and is free", async () => {
  const deps = createMockDeps({ items: ITEMS, balance: 300 });
  const d = createDetectorModule(deps);
  await d.init();

  await assert.rejects(() => d.dig(), (e) => {
    assert.equal(e.code, DetectorErrorCode.NOT_READY_TO_DIG); // no use days yet
    return true;
  });

  await d.recordUseDay("2026-11-09");
  await d.recordUseDay("2026-11-10"); // only 2 use days -> still not ready
  await assert.rejects(() => d.dig(), (e) => {
    assert.equal(e.code, DetectorErrorCode.NOT_READY_TO_DIG);
    return true;
  });

  await d.recordUseDay("2026-11-11"); // 3rd use day -> diggable
  await digUp(d);
  assert.equal(d.isFound(), true);
  assert.equal(deps.wallet.getBalance(), 300); // digging never costs anything
  assert.equal(deps.ledger.length, 0);          // and never touches the wallet
});

test("the buried detector is NOT found on the 1st/2nd dig and IS guaranteed on the 3rd", async () => {
  const deps = createMockDeps({ items: ITEMS, balance: 300 });
  const d = createDetectorModule(deps);
  await d.init();
  await d.recordUseDay("2026-11-09");
  await d.recordUseDay("2026-11-10");
  await d.recordUseDay("2026-11-11"); // ready to dig

  const r1 = await d.dig();
  assert.equal(r1.found, false);
  assert.equal(r1.digs, 1);
  assert.equal(r1.justFound, false);
  assert.equal(d.isFound(), false);

  const r2 = await d.dig();
  assert.equal(r2.found, false);
  assert.equal(r2.digs, 2);
  assert.equal(d.isFound(), false);

  const r3 = await d.dig("2026-11-12"); // the 3rd valid dig -> guaranteed find
  assert.equal(r3.found, true);
  assert.equal(r3.digs, DETECTOR_DIG_COUNT);
  assert.equal(r3.foundAt, "2026-11-12");
  assert.equal(r3.justFound, true);
  assert.equal(r3.flag, DETECTOR_FLAGS.FOUND); // one-shot signal for the Fri letter
  assert.equal(d.isFound(), true);
  assert.equal(d.getProgress().phase, "found");
  assert.equal(deps.wallet.getBalance(), 300); // all three digs were free
});

test("a dig after the detector is found produces no extra result", async () => {
  const deps = createMockDeps({ items: ITEMS, balance: 300 });
  const d = createDetectorModule(deps);
  await d.init();
  await d.recordUseDay("2026-11-09");
  await d.recordUseDay("2026-11-10");
  await d.recordUseDay("2026-11-11");
  const found = await digUp(d);
  assert.equal(found.found, true);
  const digsAtFind = d.getDigs();

  // a 4th dig can neither re-find nor advance anything
  await assert.rejects(() => d.dig(), (e) => {
    assert.equal(e.code, DetectorErrorCode.ALREADY_FOUND);
    return true;
  });
  assert.equal(d.getDigs(), digsAtFind);          // dig count unchanged
  assert.equal(d.isFound(), true);                // still exactly one find
  assert.equal(d.getProgress().phase, "found");   // state unchanged
  assert.equal(deps.wallet.getBalance(), 300);    // still free, still nothing spent
});

test("repair before digging throws NOT_FOUND", async () => {
  const d = createDetectorModule(createMockDeps({ items: ITEMS, balance: 300 }));
  await d.init();
  await assert.rejects(() => d.repair(), (e) => {
    assert.equal(e.code, DetectorErrorCode.NOT_FOUND);
    return true;
  });
});

test("repair debits the flat cost, marks repaired, and can't be repeated", async () => {
  const deps = createMockDeps({ items: ITEMS, balance: 300 });
  const d = createDetectorModule(deps);
  await d.init();
  await d.recordUseDay("2026-11-09");
  await d.recordUseDay("2026-11-10");
  await d.recordUseDay("2026-11-11");
  await digUp(d);

  const res = await d.repair();
  assert.equal(res.ok, true);
  assert.equal(res.balance, 300 - DETECTOR_REPAIR_COST);
  assert.equal(res.justRepaired, true);               // one-shot signal...
  assert.equal(res.flag, DETECTOR_FLAGS.REPAIRED);    // ...for the Fri letter wiring
  assert.equal(deps.wallet.getBalance(), 300 - DETECTOR_REPAIR_COST);
  assert.equal(deps.ledger[0].reason, "detector:repair");
  assert.equal(d.isRepaired(), true);

  await assert.rejects(() => d.repair(), (e) => {
    assert.equal(e.code, DetectorErrorCode.ALREADY_REPAIRED);
    return true;
  });
});

test("repair with insufficient funds throws and changes nothing", async () => {
  const deps = createMockDeps({ items: ITEMS, balance: DETECTOR_REPAIR_COST - 1 });
  const d = createDetectorModule(deps);
  await d.init();
  await d.recordUseDay("2026-11-09");
  await d.recordUseDay("2026-11-10");
  await d.recordUseDay("2026-11-11");
  await digUp(d);

  await assert.rejects(() => d.repair(), (e) => {
    assert.equal(e.code, DetectorErrorCode.INSUFFICIENT_FUNDS);
    return true;
  });
  assert.equal(d.isRepaired(), false);
  assert.equal(deps.wallet.getBalance(), DETECTOR_REPAIR_COST - 1);
});

test("repair without wallet/transaction deps is unavailable", async () => {
  const d = createDetectorModule({
    food: createMockFood(ITEMS),
    gameStorage: createMockStorage(),
    clock: createMockClock(),
  });
  await d.init();
  await d.recordUseDay("2026-11-09");
  await d.recordUseDay("2026-11-10");
  await d.recordUseDay("2026-11-11");
  await digUp(d);
  await assert.rejects(() => d.repair(), (e) => {
    assert.equal(e.code, DetectorErrorCode.REPAIR_UNAVAILABLE);
    return true;
  });
});

test("a failed repair transaction keeps the detector unrepaired", async () => {
  const money = createMockWalletWithTransactions(300);
  const d = createDetectorModule({
    food: createMockFood(ITEMS),
    gameStorage: createMockStorage(),
    clock: createMockClock(),
    wallet: money.wallet,
    transaction: { execute: () => ({ ok: false, balance: 300 }) },
  });
  await d.init();
  await d.recordUseDay("2026-11-09");
  await d.recordUseDay("2026-11-10");
  await d.recordUseDay("2026-11-11");
  await digUp(d);
  await assert.rejects(() => d.repair(), (e) => {
    assert.equal(e.code, DetectorErrorCode.TRANSACTION_FAILED);
    return true;
  });
  assert.equal(d.isRepaired(), false);
});

test("a failed repair is recoverable: nothing charged, and a retry succeeds exactly once", async () => {
  let calls = 0;
  let bal = 300;
  const transaction = {
    execute: ({ amount, kind }) => {
      calls += 1;
      if (calls === 1) return { ok: false, balance: bal }; // first attempt fails
      bal += kind === "debit" ? -amount : amount;
      return { ok: true, balance: bal };
    },
  };
  const d = createDetectorModule({
    food: createMockFood(ITEMS),
    gameStorage: createMockStorage(),
    clock: createMockClock("2026-11-11"),
    wallet: { getBalance: () => bal },
    transaction,
  });
  await d.init();
  await d.recordUseDay("2026-11-09");
  await d.recordUseDay("2026-11-10");
  await d.recordUseDay("2026-11-11");
  await digUp(d);

  await assert.rejects(() => d.repair(), (e) => {
    assert.equal(e.code, DetectorErrorCode.TRANSACTION_FAILED);
    return true;
  });
  assert.equal(d.isRepaired(), false); // not marked after the failure
  assert.equal(bal, 300);              // and not charged

  const r = await d.repair();          // retry succeeds
  assert.equal(r.ok, true);
  assert.equal(d.isRepaired(), true);
  assert.equal(bal, 300 - DETECTOR_REPAIR_COST); // charged exactly once

  await assert.rejects(() => d.repair(), (e) => {
    assert.equal(e.code, DetectorErrorCode.ALREADY_REPAIRED); // no second charge
    return true;
  });
  assert.equal(bal, 300 - DETECTOR_REPAIR_COST);
});

test("scanning before repair throws NOT_REPAIRED", async () => {
  const d = createDetectorModule(createMockDeps({ items: ITEMS, balance: 300 }));
  await d.init();
  await assert.rejects(() => d.scan(), (e) => {
    assert.equal(e.code, DetectorErrorCode.NOT_REPAIRED);
    return true;
  });
});

test("a repaired detector scans status + daysLeft (single tier, no freshnessPct)", async () => {
  const deps = createMockDeps({ items: ITEMS, balance: 300, today: "2026-11-09" });
  const d = createDetectorModule(deps);
  await d.init();
  await acquire(d, deps);

  const { readings } = await d.scan();
  assert.equal(d.isStale(), false);
  const byId = Object.fromEntries(readings.map((r) => [r.id, r]));
  assert.equal(byId.milk.status, "aging");
  assert.equal(byId.milk.daysLeft, 2);
  assert.equal(byId.eggs.status, "fresh");
  assert.equal(byId.eggs.daysLeft, 11);
  assert.equal(byId.leftovers.status, "spoiled");
  assert.equal(byId.leftovers.daysLeft, -2);
  assert.ok(readings.every((r) => !("freshnessPct" in r)));
});

test("a food change marks the last scan stale", async () => {
  const deps = createMockDeps({ items: ITEMS, balance: 300 });
  const d = createDetectorModule(deps);
  await d.init();
  await acquire(d, deps);
  await d.scan();
  assert.equal(d.isStale(), false);
  deps.food._set([{ id: "milk", freshness: 0.4, spoilsOn: "2026-11-11" }], { type: "removed", id: "eggs" });
  assert.equal(d.isStale(), true);
});

test("acquisition state and last scan persist and reload across instances", async () => {
  const storage = createMockStorage();
  const money = createMockWalletWithTransactions(300);
  const base = () => ({
    food: createMockFood(ITEMS),
    gameStorage: storage,
    clock: createMockClock("2026-11-11"),
    wallet: money.wallet,
    transaction: money.transaction,
  });

  const a = createDetectorModule(base());
  await a.init();
  await a.recordUseDay("2026-11-09");
  await a.recordUseDay("2026-11-10");
  await a.recordUseDay("2026-11-11");
  await digUp(a);
  await a.repair();
  await a.scan();

  const b = createDetectorModule(base());
  const p = await b.init();
  assert.equal(p.useDays, 3);
  assert.equal(p.found, true);
  assert.equal(p.repaired, true);
  assert.equal(b.getLastScan().readings.length, 3);
});

test("dig progress persists mid-way: a reload resumes it and never resets", async () => {
  const storage = createMockStorage();
  const money = createMockWalletWithTransactions(300);
  const base = () => ({
    food: createMockFood(ITEMS),
    gameStorage: storage,
    clock: createMockClock("2026-11-11"),
    wallet: money.wallet,
    transaction: money.transaction,
  });

  const a = createDetectorModule(base());
  await a.init();
  await a.recordUseDay("2026-11-09");
  await a.recordUseDay("2026-11-10");
  await a.recordUseDay("2026-11-11");
  await a.dig();                 // 1st dig
  await a.dig();                 // 2nd dig — still not found (2 of 3)
  assert.equal(a.isFound(), false);

  // reload into a fresh instance: use days AND partial dig progress must survive
  const b = createDetectorModule(base());
  const p = await b.init();
  assert.equal(p.useDays, 3);
  assert.equal(p.digs, 2);       // the two digs were NOT reset by the reload
  assert.equal(p.found, false);
  assert.equal(p.digReady, true);

  const r = await b.dig("2026-11-11"); // the 3rd dig, after the reload, still finds
  assert.equal(r.found, true);
  assert.equal(b.isFound(), true);
  assert.equal(b.getDigs(), DETECTOR_DIG_COUNT); // 2 (persisted) + 1 = 3, not restarted
});
