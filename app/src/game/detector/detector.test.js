/**
 * Tests for the detector module, run against mocked A ports.
 * Run with `node --test src/game/detector/detector.test.js` from app/.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createDetectorModule, DetectorErrorCode } from "./detector.js";
import { createMockDeps, createMockFood, createMockStorage, createMockWalletWithTransactions, createMockClock } from "./mocks.js";

const ITEMS = [
  { id: "milk", name: "Milk", freshness: 0.5, spoilsOn: "2026-11-11" },
  { id: "eggs", name: "Eggs", freshness: 0.9, spoilsOn: "2026-11-20" },
  { id: "leftovers", name: "Leftovers", freshness: 0.1, spoilsOn: "2026-11-07" },
];

test("init defaults to level 1, no scan, and subscribes to food events", async () => {
  const deps = createMockDeps({ items: ITEMS });
  const d = createDetectorModule(deps);
  const state = await d.init();
  assert.equal(state.level, 1);
  assert.equal(d.getLevel(), 1);
  assert.equal(d.isStale(), true);
  assert.equal(deps.food._subscriberCount(), 1);
});

test("level-1 scan reports status only (no daysLeft / freshnessPct)", async () => {
  const deps = createMockDeps({ items: ITEMS });
  const d = createDetectorModule(deps);
  await d.init();
  const { readings } = await d.scan();

  assert.equal(d.isStale(), false);
  const byId = Object.fromEntries(readings.map((r) => [r.id, r]));
  assert.equal(byId.milk.status, "aging");
  assert.equal(byId.eggs.status, "fresh");
  assert.equal(byId.leftovers.status, "spoiled");
  assert.ok(readings.every((r) => !("daysLeft" in r) && !("freshnessPct" in r)));
});

test("a food change marks the last scan stale", async () => {
  const deps = createMockDeps({ items: ITEMS });
  const d = createDetectorModule(deps);
  await d.init();
  await d.scan();
  assert.equal(d.isStale(), false);
  deps.food._set([{ id: "milk", freshness: 0.4, spoilsOn: "2026-11-11" }], { type: "removed", id: "eggs" });
  assert.equal(d.isStale(), true);
});

test("upgrade debits wallet, raises level, and unlocks daysLeft", async () => {
  const deps = createMockDeps({ items: ITEMS, balance: 300 });
  const d = createDetectorModule(deps);
  await d.init();

  const up = await d.upgrade();
  assert.deepEqual(up, { ok: true, level: 2, balance: 250 });
  assert.equal(deps.wallet.getBalance(), 250);
  assert.equal(deps.ledger[0].reason, "detector:upgrade:2");

  const { readings } = await d.scan();
  const byId = Object.fromEntries(readings.map((r) => [r.id, r]));
  assert.equal(byId.milk.daysLeft, 2);
  assert.equal(byId.eggs.daysLeft, 11);
  assert.equal(byId.leftovers.daysLeft, -2);
  assert.ok(readings.every((r) => !("freshnessPct" in r)));
});

test("level 3 unlocks freshnessPct", async () => {
  const deps = createMockDeps({ items: ITEMS, balance: 300 });
  const d = createDetectorModule(deps);
  await d.init();
  await d.upgrade(); // -> 2 (50)
  await d.upgrade(); // -> 3 (150)
  assert.equal(d.getLevel(), 3);

  const { readings } = await d.scan();
  const milk = readings.find((r) => r.id === "milk");
  assert.equal(milk.freshnessPct, 50);
  assert.equal(milk.daysLeft, 2);
});

test("insufficient funds blocks the upgrade and changes nothing", async () => {
  const deps = createMockDeps({ items: ITEMS, balance: 10 });
  const d = createDetectorModule(deps);
  await d.init();
  await assert.rejects(() => d.upgrade(), (e) => {
    assert.equal(e.code, DetectorErrorCode.INSUFFICIENT_FUNDS);
    return true;
  });
  assert.equal(d.getLevel(), 1);
  assert.equal(deps.wallet.getBalance(), 10);
});

test("upgrading past the max level throws MAX_LEVEL", async () => {
  const deps = createMockDeps({ items: ITEMS, balance: 1000 });
  const d = createDetectorModule(deps);
  await d.init();
  await d.upgrade();
  await d.upgrade();
  await assert.rejects(() => d.upgrade(), (e) => {
    assert.equal(e.code, DetectorErrorCode.MAX_LEVEL);
    return true;
  });
});

test("upgrade without wallet/transaction deps is unavailable", async () => {
  const d = createDetectorModule({
    food: createMockFood(ITEMS),
    gameStorage: createMockStorage(),
    clock: createMockClock(),
  });
  await d.init();
  await assert.rejects(() => d.upgrade(), (e) => {
    assert.equal(e.code, DetectorErrorCode.UPGRADE_UNAVAILABLE);
    return true;
  });
});

test("a failed upgrade transaction keeps the old level", async () => {
  const money = createMockWalletWithTransactions(300);
  const d = createDetectorModule({
    food: createMockFood(ITEMS),
    gameStorage: createMockStorage(),
    clock: createMockClock(),
    wallet: money.wallet,
    transaction: { execute: () => ({ ok: false, balance: 300 }) },
  });
  await d.init();
  await assert.rejects(() => d.upgrade(), (e) => {
    assert.equal(e.code, DetectorErrorCode.TRANSACTION_FAILED);
    return true;
  });
  assert.equal(d.getLevel(), 1);
});

test("level and last scan persist and reload across instances", async () => {
  const storage = createMockStorage();
  const money = createMockWalletWithTransactions(300);
  const base = () => ({
    food: createMockFood(ITEMS),
    gameStorage: storage,
    clock: createMockClock("2026-11-09"),
    wallet: money.wallet,
    transaction: money.transaction,
  });

  const a = createDetectorModule(base());
  await a.init();
  await a.upgrade();
  await a.scan();

  const b = createDetectorModule(base());
  const state = await b.init();
  assert.equal(state.level, 2);
  assert.equal(b.getLastScan().readings.length, 3);
});
