/**
 * Tests for the exploration module, run against mocked A ports.
 * Run with `node --test src/game/exploration/exploration.test.js` from app/.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createExplorationModule, ExplorationErrorCode } from "./exploration.js";
import { createMockDeps, createMockClock, createMockStorage, createMockWalletWithTransactions } from "./mocks.js";

test("init starts the free area unlocked and energy at max", async () => {
  const deps = createMockDeps();
  const ex = createExplorationModule(deps);
  const state = await ex.init();
  assert.equal(ex.isUnlocked("pantry"), true);
  assert.equal(ex.isUnlocked("cellar"), false);
  assert.equal(state.energy.value, 3);
});

test("listAreas reports lock state and unlock affordability", async () => {
  const ex = createExplorationModule(createMockDeps());
  await ex.init();
  const areas = ex.listAreas(150);
  const byId = Object.fromEntries(areas.map((a) => [a.id, a]));
  assert.equal(byId.pantry.unlocked, true);
  assert.equal(byId.cellar.affordableToUnlock, true); // 100
  assert.equal(byId.attic.affordableToUnlock, false); // 250
});

test("unlock debits coins and opens the area", async () => {
  const deps = createMockDeps({ balance: 300 });
  const ex = createExplorationModule(deps);
  await ex.init();
  const res = await ex.unlock("cellar");
  assert.deepEqual(res, { ok: true, areaId: "cellar", balance: 200 });
  assert.equal(ex.isUnlocked("cellar"), true);
  assert.equal(deps.ledger[0].reason, "exploration:unlock:cellar");
});

test("unlocking an already-open area throws", async () => {
  const ex = createExplorationModule(createMockDeps());
  await ex.init();
  await assert.rejects(() => ex.unlock("pantry"), (e) => {
    assert.equal(e.code, ExplorationErrorCode.ALREADY_UNLOCKED);
    return true;
  });
});

test("unlock with insufficient funds throws and changes nothing", async () => {
  const deps = createMockDeps({ balance: 50 });
  const ex = createExplorationModule(deps);
  await ex.init();
  await assert.rejects(() => ex.unlock("cellar"), (e) => {
    assert.equal(e.code, ExplorationErrorCode.INSUFFICIENT_FUNDS);
    return true;
  });
  assert.equal(ex.isUnlocked("cellar"), false);
  assert.equal(deps.wallet.getBalance(), 50);
});

test("exploring a locked area throws AREA_LOCKED", async () => {
  const ex = createExplorationModule(createMockDeps());
  await ex.init();
  await assert.rejects(() => ex.explore("cellar"), (e) => {
    assert.equal(e.code, ExplorationErrorCode.AREA_LOCKED);
    return true;
  });
});

test("explore spends energy, credits the find, and records the site", async () => {
  const deps = createMockDeps({ balance: 300 });
  const ex = createExplorationModule(deps);
  await ex.init();

  const r1 = await ex.explore("pantry");
  assert.equal(r1.site.id, "pantry-1");
  assert.equal(r1.site.coins, 30);
  assert.equal(r1.energy, 2);
  assert.equal(r1.balance, 330);
  assert.equal(deps.wallet.getBalance(), 330);

  const r2 = await ex.explore("pantry");
  assert.equal(r2.site.id, "pantry-2"); // next undiscovered site
  assert.equal(r2.energy, 1);
});

test("an exhausted area throws AREA_EXHAUSTED without spending energy", async () => {
  const ex = createExplorationModule(createMockDeps());
  await ex.init();
  await ex.explore("pantry");
  await ex.explore("pantry");
  const before = (await ex.getEnergy()).value;
  await assert.rejects(() => ex.explore("pantry"), (e) => {
    assert.equal(e.code, ExplorationErrorCode.AREA_EXHAUSTED);
    return true;
  });
  assert.equal((await ex.getEnergy()).value, before);
});

test("running out of energy throws NO_ENERGY; it refills the next day", async () => {
  const deps = createMockDeps({ balance: 300 });
  const ex = createExplorationModule(deps, { maxEnergy: 1 });
  await ex.init();

  await ex.explore("pantry"); // energy 1 -> 0
  await assert.rejects(() => ex.explore("pantry"), (e) => {
    assert.equal(e.code, ExplorationErrorCode.NO_ENERGY);
    return true;
  });

  deps.clock._advanceDays(1); // new local date -> energy refills
  assert.equal((await ex.getEnergy()).value, 1);
  const r = await ex.explore("pantry");
  assert.equal(r.site.id, "pantry-2");
});

test("unknown area throws", async () => {
  const ex = createExplorationModule(createMockDeps());
  await ex.init();
  await assert.rejects(() => ex.explore("basement"), (e) => {
    assert.equal(e.code, ExplorationErrorCode.UNKNOWN_AREA);
    return true;
  });
});

test("a failed unlock transaction leaves the area locked", async () => {
  const money = createMockWalletWithTransactions(300);
  const ex = createExplorationModule({
    wallet: money.wallet,
    transaction: { execute: () => ({ ok: false, balance: 300 }) },
    gameStorage: createMockStorage(),
    clock: createMockClock(),
  });
  await ex.init();
  await assert.rejects(() => ex.unlock("cellar"), (e) => {
    assert.equal(e.code, ExplorationErrorCode.TRANSACTION_FAILED);
    return true;
  });
  assert.equal(ex.isUnlocked("cellar"), false);
});

test("unlocked areas and discovered sites persist across instances", async () => {
  const storage = createMockStorage();
  const money = createMockWalletWithTransactions(300);
  const clock = createMockClock("2026-11-09");
  const base = () => ({ wallet: money.wallet, transaction: money.transaction, gameStorage: storage, clock });

  const a = createExplorationModule(base());
  await a.init();
  await a.unlock("cellar");
  await a.explore("cellar");

  const b = createExplorationModule(base());
  await b.init();
  assert.equal(b.isUnlocked("cellar"), true);
  assert.deepEqual(b.getState().discovered, ["cellar-1"]);
});
