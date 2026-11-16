/**
 * Tests for the exploration module (single paid dig site + loot table), run
 * against mocked A ports. Run with
 *   node --test src/game/exploration/exploration.test.js
 * from app/.
 *
 * LOCKED 2026-11-16 loot table (DEFAULT_LOOT weights sum to 100):
 *   junk [0,65) · tip [65,80) · recipe [80,90) · gp [90,100)   over random()*100
 * GP sub-tiers (tier weights sum to 100):
 *   +3 [0,60) · +6 [60,90) · +12 [90,100)                      over random()*100
 * Each dig consumes exactly two random() draws: (bucket, then pick-or-tier).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createExplorationModule, ExplorationErrorCode, DIG_COST, DEFAULT_RECIPES } from "./exploration.js";
import { createMockDeps, createMockWalletWithTransactions, createMockStorage, createMockClock, createSequenceRandom } from "./mocks.js";

// [bucketDraw, pickOrTierDraw] fixtures, each value in [0,1).
const JUNK   = [0.00, 0];    // bucket junk, pick first
const TIP    = [0.70, 0];    // bucket tip, pick first
const RECIPE = [0.85, 0];    // bucket recipe, pick first
const GP_3   = [0.95, 0.00]; // bucket gp, tier +3
const GP_6   = [0.95, 0.60]; // bucket gp, tier +6
const GP_12  = [0.95, 0.90]; // bucket gp, tier +12

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

test("a single dig debits exactly 5 GP (one debit of DIG_COST)", async () => {
  assert.equal(DIG_COST, 5);
  const deps = createMockDeps({ balance: 300 });
  const ex = createExplorationModule(deps, { random: createSequenceRandom(JUNK) });
  await ex.init();

  const r = await ex.dig();
  assert.equal(r.cost, 5);
  assert.equal(r.balance, 300 - 5);
  assert.equal(deps.wallet.getBalance(), 295);
  const debits = deps.ledger.filter((l) => l.reason === "explore:dig");
  assert.equal(debits.length, 1);
  assert.equal(debits[0].amount, 5);
  assert.equal(debits[0].kind, "debit");
});

test("a dig returns a recipe loot and records it", async () => {
  const deps = createMockDeps({ balance: 300 });
  const ex = createExplorationModule(deps, { random: createSequenceRandom(RECIPE) });
  await ex.init();

  const r = await ex.dig();
  assert.equal(r.loot.type, "recipe");
  assert.equal(r.loot.id, DEFAULT_RECIPES[0].id);
  assert.equal(r.loot.isNew, true);
  assert.equal(r.digs, 1);
  assert.equal(r.balance, 300 - DIG_COST);
  assert.equal(deps.ledger[0].reason, "explore:dig");
  assert.deepEqual(ex.getSnapshot().recipes, [DEFAULT_RECIPES[0].id]);
});

test("a GP loot debits the fare then credits the refund (net sink)", async () => {
  const deps = createMockDeps({ balance: 300 });
  const ex = createExplorationModule(deps, { random: createSequenceRandom(GP_3) });
  await ex.init();

  const r = await ex.dig();
  assert.equal(r.loot.type, "gp");
  assert.equal(r.loot.gp, 3);               // lowest sub-tier
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
  assert.equal(exTip.getSnapshot().tips.length, 1);

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

// --- Loot-table correctness (deterministic / controllable RNG) ------------

test("bucket boundaries map to the right loot type", async () => {
  // v1 edges across junk [0,65) tip [65,80) recipe [80,90) gp [90,100).
  const edges = [0.00, 0.64, 0.65, 0.79, 0.80, 0.89, 0.90, 0.999];
  const expected = ["junk", "junk", "tip", "tip", "recipe", "recipe", "gp", "gp"];
  const seq = edges.flatMap((v) => [v, 0]); // pick/tier draw = 0
  const ex = createExplorationModule(createMockDeps({ balance: 1000 }), { random: createSequenceRandom(seq) });
  await ex.init();

  const got = [];
  for (let i = 0; i < edges.length; i++) got.push((await ex.dig()).loot.type);
  assert.deepEqual(got, expected);
});

test("GP sub-tier boundaries yield only +3 / +6 / +12", async () => {
  // v1 fixed in gp band; v2 edges across +3 [0,60) +6 [60,90) +12 [90,100).
  const tierEdges = [0.00, 0.59, 0.60, 0.89, 0.90, 0.999];
  const expected = [3, 3, 6, 6, 12, 12];
  const seq = tierEdges.flatMap((v2) => [0.95, v2]);
  const ex = createExplorationModule(createMockDeps({ balance: 1000 }), { random: createSequenceRandom(seq) });
  await ex.init();

  const got = [];
  for (let i = 0; i < tierEdges.length; i++) got.push((await ex.dig()).loot.gp);
  assert.deepEqual(got, expected);
  for (const gp of got) assert.ok([3, 6, 12].includes(gp), `unexpected gp amount ${gp}`);
});

test("bucket distribution matches 65/15/10/10 over a deterministic uniform sweep", async () => {
  const N = 1000;
  const seq = [];
  for (let i = 0; i < N; i++) seq.push((i + 0.5) / N, 0); // uniform v1 sweep, v2=0
  const ex = createExplorationModule(createMockDeps({ balance: 6000 }), { random: createSequenceRandom(seq) });
  await ex.init();

  const counts = { junk: 0, tip: 0, recipe: 0, gp: 0 };
  for (let i = 0; i < N; i++) counts[(await ex.dig()).loot.type]++;

  // Exact over a uniform sweep (0.5 offsets avoid landing on a boundary).
  assert.deepEqual(counts, { junk: 650, tip: 150, recipe: 100, gp: 100 });
});

test("GP sub-tier distribution matches 60/30/10 over a deterministic uniform sweep", async () => {
  const N = 1000;
  const seq = [];
  for (let i = 0; i < N; i++) seq.push(0.95, (i + 0.5) / N); // v1 in gp band, uniform v2 sweep
  const ex = createExplorationModule(createMockDeps({ balance: 6000 }), { random: createSequenceRandom(seq) });
  await ex.init();

  const tiers = { 3: 0, 6: 0, 12: 0 };
  for (let i = 0; i < N; i++) tiers[(await ex.dig()).loot.gp]++;

  assert.deepEqual(tiers, { 3: 600, 6: 300, 12: 100 });
});

// --- Settlement consistency ----------------------------------------------

test("each dig settles exactly once; repeated digs do not double-charge a call", async () => {
  const deps = createMockDeps({ balance: 300 });
  const ex = createExplorationModule(deps, { random: createSequenceRandom(JUNK) });
  await ex.init();

  await ex.dig();
  await ex.dig();
  await ex.dig();
  const digDebits = deps.ledger.filter((l) => l.reason === "explore:dig");
  assert.equal(digDebits.length, 3);
  assert.ok(digDebits.every((l) => l.amount === 5 && l.kind === "debit"));
  assert.equal(ex.getSnapshot().digs, 3);

  // one gp dig = exactly one debit + one credit, nothing more
  const deps2 = createMockDeps({ balance: 300 });
  const ex2 = createExplorationModule(deps2, { random: createSequenceRandom(GP_6) });
  await ex2.init();
  await ex2.dig();
  assert.deepEqual(deps2.ledger.map((l) => l.reason), ["explore:dig", "explore:loot:gp"]);
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

test("a failed dig transaction yields no loot and no spend", async () => {
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

test("a committed dig persists and is not re-rolled on re-init", async () => {
  const storage = createMockStorage();
  const money = createMockWalletWithTransactions(300);
  const base = () => ({ wallet: money.wallet, transaction: money.transaction, gameStorage: storage, clock: createMockClock("2026-11-09") });

  const a = createExplorationModule(base(), { random: createSequenceRandom(GP_6) });
  await a.init();
  const first = await a.dig();
  assert.equal(first.loot.gp, 6);
  const ledgerLen = money.ledger.length;   // debit + credit
  const balAfter = money.getBalance();      // 300 - 5 + 6 = 301

  // Fresh instance, same storage, no injected RNG: must restore, not re-roll.
  const b = createExplorationModule(base());
  const s = await b.init();
  assert.equal(s.digs, 1);
  assert.equal(s.recipes.length, 0);
  assert.equal(s.gpReturned, 6);
  assert.equal(s.lastFind.type, "gp");
  assert.equal(s.lastFind.gp, 6);
  assert.equal(money.ledger.length, ledgerLen); // init settled nothing
  assert.equal(money.getBalance(), balAfter);   // balance unchanged by reload
  assert.equal(b.listRecipes().length, DEFAULT_RECIPES.length);
});
