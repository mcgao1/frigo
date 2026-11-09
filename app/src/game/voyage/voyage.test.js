/**
 * Tests for the voyage module, run against mocked A ports.
 * Run with `node --test src/game/voyage/voyage.test.js` from app/.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createVoyageModule, VoyageErrorCode } from "./voyage.js";
import { createMockDeps, createMockClock, createMockStorage, createMockWalletWithTransactions } from "./mocks.js";

// reward min is used with the deterministic rng (always 0)
const COASTAL_MIN = 40;

test("init defaults to no active voyage and empty history", async () => {
  const v = createVoyageModule(createMockDeps());
  const state = await v.init();
  assert.equal(state.active, null);
  assert.deepEqual(state.history, []);
});

test("listRoutes marks affordability from balance", async () => {
  const v = createVoyageModule(createMockDeps());
  const routes = v.listRoutes(100);
  assert.equal(routes.find((r) => r.id === "coastal").affordable, true); // 30
  assert.equal(routes.find((r) => r.id === "arctic").affordable, false); // 200
});

test("launch debits cost, sets active voyage with a return date", async () => {
  const deps = createMockDeps({ balance: 300, today: "2026-11-09" });
  const v = createVoyageModule(deps, { rng: deps.rngMin });
  await v.init();

  const res = await v.launch("coastal");
  assert.equal(res.ok, true);
  assert.equal(res.balance, 270);
  assert.equal(deps.wallet.getBalance(), 270);
  assert.equal(deps.ledger[0].reason, "voyage:launch:coastal");

  const active = await v.getActive();
  assert.equal(active.routeId, "coastal");
  assert.equal(active.startedAt, "2026-11-09");
  assert.equal(active.returnsOn, "2026-11-10");
  assert.equal(active.returned, false);
  assert.equal(active.daysRemaining, 1);
});

test("cannot launch while a voyage is in progress", async () => {
  const deps = createMockDeps();
  const v = createVoyageModule(deps, { rng: deps.rngMin });
  await v.init();
  await v.launch("coastal");
  await assert.rejects(() => v.launch("deep_sea"), (e) => {
    assert.equal(e.code, VoyageErrorCode.VOYAGE_IN_PROGRESS);
    return true;
  });
});

test("unknown route throws", async () => {
  const v = createVoyageModule(createMockDeps());
  await v.init();
  await assert.rejects(() => v.launch("mars"), (e) => {
    assert.equal(e.code, VoyageErrorCode.UNKNOWN_ROUTE);
    return true;
  });
});

test("insufficient funds blocks launch and changes nothing", async () => {
  const deps = createMockDeps({ balance: 10 });
  const v = createVoyageModule(deps, { rng: deps.rngMin });
  await v.init();
  await assert.rejects(() => v.launch("coastal"), (e) => {
    assert.equal(e.code, VoyageErrorCode.INSUFFICIENT_FUNDS);
    return true;
  });
  assert.equal(deps.wallet.getBalance(), 10);
  assert.equal(await v.getActive(), null);
});

test("claiming before the voyage returns throws NOT_RETURNED", async () => {
  const deps = createMockDeps({ today: "2026-11-09" });
  const v = createVoyageModule(deps, { rng: deps.rngMin });
  await v.init();
  await v.launch("coastal"); // returns 2026-11-10
  await assert.rejects(() => v.claim(), (e) => {
    assert.equal(e.code, VoyageErrorCode.NOT_RETURNED);
    return true;
  });
});

test("claim after return credits reward and archives the voyage", async () => {
  const deps = createMockDeps({ balance: 300, today: "2026-11-09" });
  const v = createVoyageModule(deps, { rng: deps.rngMin });
  await v.init();
  await v.launch("coastal"); // cost 30 -> 270, returns 2026-11-10

  deps.clock._advanceDays(1); // now 2026-11-10
  assert.equal((await v.getActive()).returned, true);

  const res = await v.claim();
  assert.equal(res.reward, COASTAL_MIN);
  assert.equal(res.balance, 270 + COASTAL_MIN);
  assert.equal(deps.wallet.getBalance(), 310);

  assert.equal(await v.getActive(), null);
  const state = v.getState();
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].routeId, "coastal");
  assert.equal(state.history[0].claimedAt, "2026-11-10");
});

test("claiming with no active voyage throws", async () => {
  const v = createVoyageModule(createMockDeps());
  await v.init();
  await assert.rejects(() => v.claim(), (e) => {
    assert.equal(e.code, VoyageErrorCode.NO_ACTIVE_VOYAGE);
    return true;
  });
});

test("a failed launch transaction leaves no active voyage", async () => {
  const money = createMockWalletWithTransactions(300);
  const deps = {
    wallet: money.wallet,
    transaction: { execute: () => ({ ok: false, balance: 300 }) },
    gameStorage: createMockStorage(),
    clock: createMockClock(),
  };
  const v = createVoyageModule(deps, { rng: () => 0 });
  await v.init();
  await assert.rejects(() => v.launch("coastal"), (e) => {
    assert.equal(e.code, VoyageErrorCode.TRANSACTION_FAILED);
    return true;
  });
  assert.equal(await v.getActive(), null);
});

test("active voyage persists and reloads across instances", async () => {
  const storage = createMockStorage();
  const money = createMockWalletWithTransactions(300);
  const clock = createMockClock("2026-11-09");
  const base = () => ({ wallet: money.wallet, transaction: money.transaction, gameStorage: storage, clock });

  const a = createVoyageModule(base(), { rng: () => 0 });
  await a.init();
  await a.launch("deep_sea"); // 3 days -> 2026-11-12

  const b = createVoyageModule(base(), { rng: () => 0 });
  await b.init();
  const active = await b.getActive();
  assert.equal(active.routeId, "deep_sea");
  assert.equal(active.returnsOn, "2026-11-12");
});
