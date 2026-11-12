/**
 * Tests for the fridge-build (repair) module, run against the in-memory mocks of
 * A's ports. Node's built-in test runner (no extra deps):
 *   run with `node --test src/game/repair/` from app/.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createRepairModule, RepairErrorCode, DEFAULT_FRAGMENTS, FRAGMENT_COST } from "./repair.js";
import {
  createMockDeps,
  createMockStorage,
  createMockWalletWithTransactions,
  createMockClock,
  createMockInfrastructure,
  createSequenceRandom,
} from "./mocks.js";

const TOTAL = DEFAULT_FRAGMENTS.length; // 6

test("list reports every fragment with the same cost, none owned/installed", () => {
  const repair = createRepairModule(createMockDeps());
  const items = repair.list(0);
  assert.equal(items.length, TOTAL);
  assert.ok(items.every((i) => i.cost === FRAGMENT_COST));
  assert.ok(items.every((i) => i.owned === false && i.installed === false));
});

test("affordability reflects the balance passed to list", () => {
  const repair = createRepairModule(createMockDeps());
  assert.ok(repair.list(FRAGMENT_COST).every((i) => i.affordable === true));
  assert.ok(repair.list(FRAGMENT_COST - 1).every((i) => i.affordable === false));
});

test("buy debits cost, marks owned (not installed), persists, picks an unowned one", async () => {
  const deps = createMockDeps({ balance: 30 });
  const repair = createRepairModule(deps, { random: createSequenceRandom([0]) });
  await repair.init();

  const res = await repair.buy();
  assert.equal(res.ok, true);
  assert.equal(res.fragment, DEFAULT_FRAGMENTS[0].id); // random=0 → first unowned
  assert.equal(res.balance, 30 - FRAGMENT_COST);
  assert.equal(deps.wallet.getBalance(), 30 - FRAGMENT_COST);
  assert.equal(repair.isOwned(res.fragment), true);
  assert.equal(repair.isInstalled(res.fragment), false);
  assert.equal(deps.ledger[0].reason, `fragment:buy:${res.fragment}`);
  assert.equal(repair.get(res.fragment).boughtAt, "2026-11-06");
});

test("buying never repeats a fragment and empties the pool after TOTAL buys", async () => {
  const deps = createMockDeps({ balance: 100 });
  const repair = createRepairModule(deps, { random: createSequenceRandom([0]) });
  await repair.init();

  const got = [];
  for (let i = 0; i < TOTAL; i++) got.push((await repair.buy()).fragment);
  assert.equal(new Set(got).size, TOTAL); // all distinct
  assert.equal(repair.getProgress().owned, TOTAL);
  assert.equal(deps.wallet.getBalance(), 100 - TOTAL * FRAGMENT_COST);

  await assert.rejects(() => repair.buy(), (e) => {
    assert.equal(e.code, RepairErrorCode.ALL_OWNED);
    return true;
  });
});

test("insufficient funds throws and changes nothing", async () => {
  const deps = createMockDeps({ balance: FRAGMENT_COST - 1 });
  const repair = createRepairModule(deps);
  await repair.init();

  await assert.rejects(() => repair.buy(), (e) => {
    assert.equal(e.code, RepairErrorCode.INSUFFICIENT_FUNDS);
    return true;
  });
  assert.equal(deps.wallet.getBalance(), FRAGMENT_COST - 1);
  assert.equal(repair.getProgress().owned, 0);
});

test("a failed transaction leaves nothing owned", async () => {
  const money = createMockWalletWithTransactions(30);
  const deps = {
    wallet: money.wallet,
    transaction: { execute: () => ({ ok: false, balance: 30 }) },
    gameStorage: createMockStorage(),
    clock: createMockClock(),
    infrastructure: createMockInfrastructure(),
  };
  const repair = createRepairModule(deps);
  await repair.init();

  await assert.rejects(() => repair.buy(), (e) => {
    assert.equal(e.code, RepairErrorCode.TRANSACTION_FAILED);
    return true;
  });
  assert.equal(repair.getProgress().owned, 0);
});

test("install requires ownership, is free, notifies infra, and completes at TOTAL", async () => {
  const deps = createMockDeps({ balance: 100 });
  const repair = createRepairModule(deps, { random: createSequenceRandom([0]) });
  await repair.init();

  // install before buying → NOT_OWNED
  await assert.rejects(() => repair.install(DEFAULT_FRAGMENTS[0].id), (e) => {
    assert.equal(e.code, RepairErrorCode.NOT_OWNED);
    return true;
  });

  const ids = [];
  for (let i = 0; i < TOTAL; i++) ids.push((await repair.buy()).fragment);
  const balanceAfterBuys = deps.wallet.getBalance();

  for (let i = 0; i < TOTAL; i++) {
    const r = await repair.install(ids[i]);
    assert.equal(r.installed, i + 1);
    assert.equal(r.complete, i + 1 === TOTAL);
  }
  assert.equal(deps.wallet.getBalance(), balanceAfterBuys); // install is free
  assert.equal(repair.isComplete(), true);
  assert.equal(deps.infrastructure.calls.length, TOTAL);
});

test("install twice throws ALREADY_INSTALLED; unknown fragment throws", async () => {
  const deps = createMockDeps({ balance: 100 });
  const repair = createRepairModule(deps, { random: createSequenceRandom([0]) });
  await repair.init();

  const id = (await repair.buy()).fragment;
  await repair.install(id);

  await assert.rejects(() => repair.install(id), (e) => {
    assert.equal(e.code, RepairErrorCode.ALREADY_INSTALLED);
    return true;
  });
  await assert.rejects(() => repair.install("nope"), (e) => {
    assert.equal(e.code, RepairErrorCode.UNKNOWN_FRAGMENT);
    return true;
  });
});

test("progress persists and reloads across instances", async () => {
  const storage = createMockStorage();
  const money = createMockWalletWithTransactions(100);
  const base = () => ({
    wallet: money.wallet,
    transaction: money.transaction,
    gameStorage: storage,
    clock: createMockClock(),
    infrastructure: createMockInfrastructure(),
  });

  const a = createRepairModule(base(), { random: createSequenceRandom([0]) });
  await a.init();
  const id = (await a.buy()).fragment;
  await a.install(id);

  const b = createRepairModule(base());
  await b.init();
  assert.equal(b.isOwned(id), true);
  assert.equal(b.isInstalled(id), true);
  assert.equal(b.getProgress().installed, 1);
});

test("infrastructure failure does not fail install (best-effort)", async () => {
  const deps = createMockDeps({ balance: 100 });
  deps.infrastructure = {
    applyRepair: () => {
      throw new Error("infra down");
    },
    calls: [],
  };
  const repair = createRepairModule(deps, { random: createSequenceRandom([0]) });
  await repair.init();

  const id = (await repair.buy()).fragment;
  const r = await repair.install(id);
  assert.equal(r.ok, true);
  assert.equal(repair.isInstalled(id), true);
});
