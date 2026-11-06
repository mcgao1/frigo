/**
 * Tests for the repair module, run against the in-memory mocks of A's ports.
 * Uses Node's built-in test runner (no extra deps, no shared test-runner choice
 * forced on A): run with `node --test src/game/repair/` from app/.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createRepairModule, RepairErrorCode } from "./repair.js";
import {
  createMockDeps,
  createMockStorage,
  createMockWalletWithTransactions,
  createMockClock,
  createMockInfrastructure,
} from "./mocks.js";

test("list reports every component with cost and status", () => {
  const repair = createRepairModule(createMockDeps());
  const items = repair.list(0);
  assert.equal(items.length, 4);
  assert.ok(items.every((i) => i.repaired === false));
  assert.ok(items.find((i) => i.id === "compressor").cost === 120);
});

test("affordability reflects the balance passed to list", () => {
  const repair = createRepairModule(createMockDeps());
  const items = repair.list(50);
  assert.equal(items.find((i) => i.id === "door_seal").affordable, true); // 20
  assert.equal(items.find((i) => i.id === "compressor").affordable, false); // 120
});

test("repair debits wallet, marks repaired, notifies infra, persists", async () => {
  const deps = createMockDeps({ balance: 200 });
  const repair = createRepairModule(deps);
  await repair.init();

  const res = await repair.repair("thermostat");

  assert.deepEqual(res, { ok: true, component: "thermostat", balance: 155 });
  assert.equal(deps.wallet.getBalance(), 155);
  assert.equal(repair.isRepaired("thermostat"), true);
  assert.deepEqual(deps.infrastructure.calls, [{ component: "thermostat" }]);
  assert.equal(deps.ledger[0].reason, "repair:thermostat");
  assert.equal(repair.get("thermostat").repairedAt, "2026-11-06");
});

test("insufficient funds throws and changes nothing", async () => {
  const deps = createMockDeps({ balance: 10 });
  const repair = createRepairModule(deps);
  await repair.init();

  await assert.rejects(() => repair.repair("compressor"), (e) => {
    assert.equal(e.code, RepairErrorCode.INSUFFICIENT_FUNDS);
    return true;
  });
  assert.equal(deps.wallet.getBalance(), 10);
  assert.equal(repair.isRepaired("compressor"), false);
  assert.equal(deps.infrastructure.calls.length, 0);
});

test("unknown component throws", async () => {
  const repair = createRepairModule(createMockDeps());
  await assert.rejects(() => repair.repair("nope"), (e) => {
    assert.equal(e.code, RepairErrorCode.UNKNOWN_COMPONENT);
    return true;
  });
});

test("repairing twice throws ALREADY_REPAIRED and does not double-charge", async () => {
  const deps = createMockDeps({ balance: 200 });
  const repair = createRepairModule(deps);
  await repair.init();

  await repair.repair("light");
  const afterFirst = deps.wallet.getBalance();

  await assert.rejects(() => repair.repair("light"), (e) => {
    assert.equal(e.code, RepairErrorCode.ALREADY_REPAIRED);
    return true;
  });
  assert.equal(deps.wallet.getBalance(), afterFirst);
});

test("a failed transaction leaves the component unrepaired", async () => {
  const money = createMockWalletWithTransactions(200);
  const deps = {
    wallet: money.wallet,
    transaction: { execute: () => ({ ok: false, balance: 200 }) },
    gameStorage: createMockStorage(),
    clock: createMockClock(),
    infrastructure: createMockInfrastructure(),
  };
  const repair = createRepairModule(deps);
  await repair.init();

  await assert.rejects(() => repair.repair("door_seal"), (e) => {
    assert.equal(e.code, RepairErrorCode.TRANSACTION_FAILED);
    return true;
  });
  assert.equal(repair.isRepaired("door_seal"), false);
});

test("progress persists and reloads across instances", async () => {
  const storage = createMockStorage();
  const money = createMockWalletWithTransactions(200);
  const base = () => ({
    wallet: money.wallet,
    transaction: money.transaction,
    gameStorage: storage,
    clock: createMockClock(),
    infrastructure: createMockInfrastructure(),
  });

  const a = createRepairModule(base());
  await a.init();
  await a.repair("door_seal");

  const b = createRepairModule(base());
  await b.init();
  assert.equal(b.isRepaired("door_seal"), true);
});

test("infrastructure failure does not fail the repair (best-effort)", async () => {
  const deps = createMockDeps({ balance: 200 });
  deps.infrastructure = {
    applyRepair: () => {
      throw new Error("infra down");
    },
    calls: [],
  };
  const repair = createRepairModule(deps);
  await repair.init();

  const res = await repair.repair("light");
  assert.equal(res.ok, true);
  assert.equal(repair.isRepaired("light"), true);
});
