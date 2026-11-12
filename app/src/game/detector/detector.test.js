/**
 * Tests for the detector module (mainline acquisition flow), run against mocked
 * A ports. Run with `node --test src/game/detector/detector.test.js` from app/.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createDetectorModule, DetectorErrorCode, DETECTOR_REPAIR_COST } from "./detector.js";
import { createMockDeps, createMockFood, createMockStorage, createMockWalletWithTransactions, createMockClock } from "./mocks.js";

const ITEMS = [
  { id: "milk", name: "Milk", freshness: 0.5, spoilsOn: "2026-11-11" },
  { id: "eggs", name: "Eggs", freshness: 0.9, spoilsOn: "2026-11-20" },
  { id: "leftovers", name: "Leftovers", freshness: 0.1, spoilsOn: "2026-11-07" },
];

/** Dig up + repair the detector so scan() is available. */
async function acquire(d, deps) {
  await d.recordUseDay("2026-11-09");
  await d.recordUseDay("2026-11-10");
  await d.recordUseDay("2026-11-11");
  await d.dig();
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

test("dig is gated on the use-day threshold, is free, and can't be repeated", async () => {
  const deps = createMockDeps({ items: ITEMS, balance: 300 });
  const d = createDetectorModule(deps);
  await d.init();

  await assert.rejects(() => d.dig(), (e) => {
    assert.equal(e.code, DetectorErrorCode.NOT_READY_TO_DIG);
    return true;
  });

  await d.recordUseDay("2026-11-09");
  await d.recordUseDay("2026-11-10");
  await d.recordUseDay("2026-11-11");

  const res = await d.dig("2026-11-11");
  assert.equal(res.ok, true);
  assert.equal(res.foundAt, "2026-11-11");
  assert.equal(d.isFound(), true);
  assert.equal(deps.wallet.getBalance(), 300); // digging is free

  await assert.rejects(() => d.dig(), (e) => {
    assert.equal(e.code, DetectorErrorCode.ALREADY_FOUND);
    return true;
  });
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
  await d.dig();

  const res = await d.repair();
  assert.equal(res.ok, true);
  assert.equal(res.balance, 300 - DETECTOR_REPAIR_COST);
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
  await d.dig();

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
  await d.dig();
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
  await d.dig();
  await assert.rejects(() => d.repair(), (e) => {
    assert.equal(e.code, DetectorErrorCode.TRANSACTION_FAILED);
    return true;
  });
  assert.equal(d.isRepaired(), false);
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
  await a.dig();
  await a.repair();
  await a.scan();

  const b = createDetectorModule(base());
  const p = await b.init();
  assert.equal(p.useDays, 3);
  assert.equal(p.found, true);
  assert.equal(p.repaired, true);
  assert.equal(b.getLastScan().readings.length, 3);
});
