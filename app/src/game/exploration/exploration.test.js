/**
 * Tests for the exploration module (single paid dig site + loot table), run
 * against mocked A ports. Run with
 *   node --test src/game/exploration/exploration.test.js
 * from app/.
 *
 * Loot buckets by random()*100 over DEFAULT_LOOT weights:
 *   junk [0,30) · tip [30,58) · recipe [58,80) · gp [80,100).
 * Each dig consumes exactly two random() draws: (bucket, then pick-or-amount).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createExplorationModule, ExplorationErrorCode, DIG_COST, DEFAULT_RECIPES } from "./exploration.js";
import { createMockDeps, createMockWalletWithTransactions, createMockStorage, createMockClock, createSequenceRandom } from "./mocks.js";

const JUNK = [0.0, 0];     // bucket junk, pick first
const TIP = [0.40, 0];     // bucket tip, pick first
const RECIPE = [0.65, 0];  // bucket recipe, pick first
const GP_MIN = [0.90, 0];  // bucket gp, amount = min

test("init starts with nothing dug", async () => {
  const ex = createExplorationModule(createMockDeps());
  const s = await ex.init();
  assert.equal(s.digs, 0);
  assert.deepEqual(s.recipes, []);
  assert.deepEqual(s.tips, []);
  assert.equal(s.junk, 0);
  assert.equal(s.gpReturned, 0);
  assert.equal(s.cost, DIG_COST);
});

test("a dig debits the flat cost and returns a recipe loot", async () => {
  const deps = createMockDeps({ balance: 300 });
  const ex = createExplorationModule(deps, { random: createSequenceRandom(RECIPE) });
  await ex.init();

  const r = await ex.dig();
  assert.equal(r.cost, DIG_COST);
  assert.equal(r.loot.type, "recipe");
  assert.equal(r.loot.id, DEFAULT_RECIPES[0].id);
  assert.equal(r.loot.isNew, true);
  assert.equal(r.digs, 1);
  assert.equal(r.balance, 300 - DIG_COST);
  assert.equal(deps.wallet.getBalance(), 300 - DIG_COST);
  assert.equal(deps.ledger[0].reason, "explore:dig");
  assert.deepEqual(ex.getSnapshot().recipes, [DEFAULT_RECIPES[0].id]);
});

test("a GP loot debits the fare then credits the refund (net sink)", async () => {
  const deps = createMockDeps({ balance: 300 });
  const ex = createExplorationModule(deps, { random: createSequenceRandom(GP_MIN) });
  await ex.init();

  const r = await ex.dig();
  assert.equal(r.loot.type, "gp");
  assert.equal(r.loot.gp, 3);          // min of 3..8
  assert.equal(r.loot.credited, true);
  assert.equal(r.balance, 300 - DIG_COST + 3); // -5 then +3 = 298
  assert.equal(deps.wallet.getBalance(), 298);
  assert.equal(ex.getSnapshot().gpReturned, 3);
  assert.deepEqual(deps.ledger.map((l) => l.reason), ["explore:dig", "explore:loot:gp"]);
});

test("a tip loot is collected, a junk loot is just a miss", async () => {
  const deps = createMockDeps();
  const exTip = createExplorationModule(deps, { random: createSequenceRandom(TIP) });
  await exTip.init();
  const t = await exTip.dig();
  assert.equal(t.loot.type, "tip");
  assert.equal(t.loot.isNew, true);
  assert.deepEqual(exTip.getSnapshot().tips.length, 1);

  const deps2 = createMockDeps();
  const exJunk = createExplorationModule(deps2, { random: createSequenceRandom(JUNK) });
  await exJunk.init();
  const j = await exJunk.dig();
  assert.equal(j.loot.type, "junk");
  assert.equal(exJunk.getSnapshot().junk, 1);
  assert.deepEqual(exJunk.getSnapshot().recipes, []);
});

test("collectibles don't repeat: a second recipe dig yields a different recipe", async () => {
  const deps = createMockDeps({ balance: 300 });
  const ex = createExplorationModule(deps, { random: createSequenceRandom(RECIPE) });
  await ex.init();

  const a = await ex.dig();
  const b = await ex.dig();
  assert.notEqual(a.loot.id, b.loot.id); // fresh pool excludes the first
  assert.equal(b.loot.isNew, true);
  assert.equal(ex.getSnapshot().recipes.length, 2);
});

test("insufficient funds blocks the dig and changes nothing", async () => {
  const deps = createMockDeps({ balance: DIG_COST - 1 });
  const ex = createExplorationModule(deps, { random: createSequenceRandom(RECIPE) });
  await ex.init();

  await assert.rejects(() => ex.dig(), (e) => {
    assert.equal(e.code, ExplorationErrorCode.INSUFFICIENT_FUNDS);
    return true;
  });
  assert.equal(ex.getSnapshot().digs, 0);
  assert.equal(deps.wallet.getBalance(), DIG_COST - 1);
});

test("a failed dig transaction yields no loot", async () => {
  const money = createMockWalletWithTransactions(300);
  const ex = createExplorationModule({
    wallet: money.wallet,
    transaction: { execute: () => ({ ok: false, balance: 300 }) },
    gameStorage: createMockStorage(),
    clock: createMockClock(),
  }, { random: createSequenceRandom(RECIPE) });
  await ex.init();

  await assert.rejects(() => ex.dig(), (e) => {
    assert.equal(e.code, ExplorationErrorCode.TRANSACTION_FAILED);
    return true;
  });
  assert.equal(ex.getSnapshot().digs, 0);
});

test("dig totals and collected recipes/tips persist and reload", async () => {
  const storage = createMockStorage();
  const money = createMockWalletWithTransactions(300);
  const base = () => ({ wallet: money.wallet, transaction: money.transaction, gameStorage: storage, clock: createMockClock("2026-11-09") });

  const a = createExplorationModule(base(), { random: createSequenceRandom(RECIPE) });
  await a.init();
  await a.dig();

  const b = createExplorationModule(base());
  const s = await b.init();
  assert.equal(s.digs, 1);
  assert.equal(s.recipes.length, 1);
  assert.equal(b.listRecipes().find((r) => r.id === DEFAULT_RECIPES[0].id).found, true);
});
