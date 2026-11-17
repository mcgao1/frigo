/**
 * Tests for the collection module, run against mocked A ports.
 * Run with `node --test src/game/collection/collection.test.js` from app/.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createCollectionModule, CollectionErrorCode } from "./collection.js";
import { createMockDeps, createMockFood, createMockStorage, createMockClock } from "./mocks.js";

const DAIRY_ITEMS = [
  { id: "a", kind: "milk" },
  { id: "b", kind: "cheese" },
  { id: "c", kind: "yogurt" },
];

test("init with nothing discovered", async () => {
  const c = createCollectionModule(createMockDeps());
  const progress = await c.init();
  assert.equal(progress.found, 0);
  assert.equal(progress.total, 5);
});

test("sync records collectible kinds and ignores non-catalog items", async () => {
  const deps = createMockDeps({ items: [{ id: "a", kind: "milk" }, { id: "b", kind: "cheese" }, { id: "x", kind: "pizza" }] });
  const c = createCollectionModule(deps);
  await c.init();

  const { newlyDiscovered } = await c.sync();
  assert.deepEqual(newlyDiscovered.sort(), ["cheese", "milk"]);
  assert.equal(c.isDiscovered("milk"), true);
  assert.equal(c.isDiscovered("pizza"), false); // not in catalog
});

test("sync is idempotent (no duplicate discovery)", async () => {
  const deps = createMockDeps({ items: DAIRY_ITEMS });
  const c = createCollectionModule(deps);
  await c.init();
  await c.sync();
  const second = await c.sync();
  assert.deepEqual(second.newlyDiscovered, []);
});

test("discovery is timestamped with the clock date", async () => {
  const deps = createMockDeps({ items: [{ id: "a", kind: "milk" }], today: "2026-11-10" });
  const c = createCollectionModule(deps);
  await c.init();
  await c.sync();
  const milk = c.listCatalog().find((e) => e.kind === "milk");
  assert.equal(milk.discoveredAt, "2026-11-10");
});

test("an 'added' food event auto-records the kind", async () => {
  const deps = createMockDeps({ items: [] });
  const c = createCollectionModule(deps);
  await c.init();
  assert.equal(c.isDiscovered("yogurt"), false);
  deps.food._emit({ type: "added", id: "n1", item: { kind: "yogurt", name: "Yogurt" } });
  assert.equal(c.isDiscovered("yogurt"), true);
});

test("getSets reports per-set completion", async () => {
  const deps = createMockDeps({ items: [{ id: "a", kind: "milk" }, { id: "b", kind: "cheese" }] });
  const c = createCollectionModule(deps);
  await c.init();
  await c.sync();
  const dairy = c.getSets().find((s) => s.id === "dairy");
  assert.equal(dairy.total, 3);
  assert.equal(dairy.found, 2);
  assert.equal(dairy.complete, false);
});

test("claiming an incomplete set throws", async () => {
  const deps = createMockDeps({ items: [{ id: "a", kind: "milk" }] });
  const c = createCollectionModule(deps);
  await c.init();
  await c.sync();
  await assert.rejects(() => c.claimSet("dairy"), (e) => {
    assert.equal(e.code, CollectionErrorCode.SET_INCOMPLETE);
    return true;
  });
});

test("claiming a completed set credits the reward once", async () => {
  const deps = createMockDeps({ items: DAIRY_ITEMS, balance: 300 });
  const c = createCollectionModule(deps);
  await c.init();
  await c.sync();

  const res = await c.claimSet("dairy");
  assert.equal(res.reward, 100);
  assert.equal(res.balance, 400);
  assert.equal(deps.wallet.getBalance(), 400);
  assert.equal(deps.ledger[0].reason, "collection:set:dairy");

  await assert.rejects(() => c.claimSet("dairy"), (e) => {
    assert.equal(e.code, CollectionErrorCode.ALREADY_CLAIMED);
    return true;
  });
  assert.equal(deps.wallet.getBalance(), 400); // not double-credited
});

test("claiming an unknown set throws", async () => {
  const c = createCollectionModule(createMockDeps());
  await c.init();
  await assert.rejects(() => c.claimSet("nope"), (e) => {
    assert.equal(e.code, CollectionErrorCode.UNKNOWN_SET);
    return true;
  });
});

test("claiming without a transaction dep is unavailable", async () => {
  const c = createCollectionModule({
    food: createMockFood(DAIRY_ITEMS),
    gameStorage: createMockStorage(),
    clock: createMockClock(),
  });
  await c.init();
  await c.sync();
  await assert.rejects(() => c.claimSet("dairy"), (e) => {
    assert.equal(e.code, CollectionErrorCode.CLAIM_UNAVAILABLE);
    return true;
  });
});

test("a reward-0 set claim completes without any wallet transaction or ledger line", async () => {
  const deps = createMockDeps({ items: DAIRY_ITEMS, balance: 50 });
  const c = createCollectionModule(deps, { sets: [{ id: "dairy", name: "Dairy", reward: 0 }] });
  await c.init();
  await c.sync();

  const res = await c.claimSet("dairy");
  assert.equal(res.reward, 0);
  assert.equal(deps.wallet.getBalance(), 50); // balance untouched
  assert.equal(deps.ledger.length, 0); // NO 0-amount collection:set ledger entry
  assert.ok(c.getProgress().claimedSets.includes("dairy")); // claim still completed
  await assert.rejects(() => c.claimSet("dairy"), (e) => {
    assert.equal(e.code, CollectionErrorCode.ALREADY_CLAIMED); // and is one-shot
    return true;
  });
});

test("a reward-0 set can be claimed even without a transaction dep", async () => {
  const c = createCollectionModule(
    { food: createMockFood(DAIRY_ITEMS), gameStorage: createMockStorage(), clock: createMockClock() },
    { sets: [{ id: "dairy", name: "Dairy", reward: 0 }] },
  );
  await c.init();
  await c.sync();
  const res = await c.claimSet("dairy"); // no transaction dep, reward 0 -> still fine
  assert.equal(res.reward, 0);
  assert.ok(c.getProgress().claimedSets.includes("dairy"));
});

test("a reward-0 claim persists claimed state across a reload", async () => {
  const storage = createMockStorage();
  const sets = [{ id: "dairy", name: "Dairy", reward: 0 }];
  const a = createCollectionModule({ ...createMockDeps({ items: DAIRY_ITEMS }), gameStorage: storage }, { sets });
  await a.init();
  await a.sync();
  await a.claimSet("dairy");

  const b = createCollectionModule({ ...createMockDeps({ items: [] }), gameStorage: storage }, { sets });
  const progress = await b.init();
  assert.deepEqual(progress.claimedSets, ["dairy"]); // claimed state survived
});

test("discoveries and claimed sets persist across instances", async () => {
  const sharedStorage = createMockStorage();
  const deps1 = { ...createMockDeps({ items: DAIRY_ITEMS }), gameStorage: sharedStorage };

  const a = createCollectionModule(deps1);
  await a.init();
  await a.sync();
  await a.claimSet("dairy");

  const deps2 = { ...createMockDeps({ items: [] }), gameStorage: sharedStorage };
  const b = createCollectionModule(deps2);
  const progress = await b.init();
  assert.equal(b.isDiscovered("milk"), true);
  assert.deepEqual(progress.claimedSets, ["dairy"]);
});
