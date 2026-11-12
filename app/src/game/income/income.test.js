/**
 * Tests for the income (GreenPoints earning) module, run against mocked A ports.
 * Run with `node --test src/game/income/income.test.js` from app/.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createIncomeModule, IncomeErrorCode, DAILY_OPEN_GP, ENTRY_GP, ENTRY_CAP, CONSUME_GP, CONSUME_CAP } from "./income.js";
import { createMockDeps, createMockWalletWithTransactions, createMockStorage, createMockClock } from "./mocks.js";

test("init starts with nothing earned and empty daily counters", async () => {
  const inc = createIncomeModule(createMockDeps());
  const s = await inc.init();
  assert.equal(s.earned, 0);
  assert.equal(s.entries, 0);
  assert.deepEqual(s.categories, []);
});

test("openDay credits once per distinct day, and resets after the day rolls", async () => {
  const deps = createMockDeps();
  const inc = createIncomeModule(deps);
  await inc.init();

  let r = await inc.openDay();
  assert.equal(r.credited, true);
  assert.equal(r.amount, DAILY_OPEN_GP);
  assert.equal(r.balance, DAILY_OPEN_GP);

  r = await inc.openDay(); // same day again
  assert.equal(r.credited, false);
  assert.equal(r.reason, "ALREADY_OPENED_TODAY");
  assert.equal(deps.wallet.getBalance(), DAILY_OPEN_GP);

  deps.clock._advanceDays(1);
  r = await inc.openDay();
  assert.equal(r.credited, true);
  assert.equal(deps.wallet.getBalance(), DAILY_OPEN_GP * 2);
  assert.ok(deps.ledger.every((l) => l.reason === "income:daily"));
});

test("recordEntry pays up to the daily cap, then stops (no penalty), resets next day", async () => {
  const deps = createMockDeps();
  const inc = createIncomeModule(deps);
  await inc.init();

  for (let i = 0; i < ENTRY_CAP; i++) {
    const r = await inc.recordEntry();
    assert.equal(r.credited, true);
    assert.equal(r.entriesToday, i + 1);
  }
  let r = await inc.recordEntry();
  assert.equal(r.credited, false);
  assert.equal(r.reason, "DAILY_CAP");
  assert.equal(deps.wallet.getBalance(), ENTRY_GP * ENTRY_CAP);
  assert.equal(deps.ledger[0].reason, "income:entry");

  deps.clock._advanceDays(1);
  r = await inc.recordEntry();
  assert.equal(r.credited, true);
  assert.equal(r.entriesToday, 1);
});

test("recordConsume pays once per category, caps categories per day, resets next day", async () => {
  const deps = createMockDeps();
  const inc = createIncomeModule(deps);
  await inc.init();

  let r = await inc.recordConsume("dairy");
  assert.equal(r.credited, true);
  assert.equal(r.amount, CONSUME_GP);

  r = await inc.recordConsume("dairy"); // same category again today
  assert.equal(r.credited, false);
  assert.equal(r.reason, "CATEGORY_DONE");

  await inc.recordConsume("greens");
  await inc.recordConsume("fruit"); // 3rd distinct category (CONSUME_CAP = 3)
  r = await inc.recordConsume("grains"); // 4th distinct → capped
  assert.equal(r.credited, false);
  assert.equal(r.reason, "DAILY_CAP");
  assert.equal(deps.wallet.getBalance(), CONSUME_GP * CONSUME_CAP);
  assert.ok(deps.ledger.some((l) => l.reason === "income:consume:dairy"));

  deps.clock._advanceDays(1);
  r = await inc.recordConsume("dairy");
  assert.equal(r.credited, true); // category dedup resets with the new day
});

test("category keys are normalized so dedup is case/whitespace-insensitive", async () => {
  const inc = createIncomeModule(createMockDeps());
  await inc.init();
  await inc.recordConsume("Dairy");
  const r = await inc.recordConsume("  dairy ");
  assert.equal(r.credited, false);
  assert.equal(r.reason, "CATEGORY_DONE");
});

test("GP only increases: caps yield no credit but never debit", async () => {
  const deps = createMockDeps({ balance: 7 });
  const inc = createIncomeModule(deps);
  await inc.init();
  await inc.recordEntry();            // +4 -> 11
  await inc.recordEntry();            // +4 -> 15
  await inc.recordEntry();            // +4 -> 19
  const before = deps.wallet.getBalance();
  const r = await inc.recordEntry();  // capped
  assert.equal(r.credited, false);
  assert.equal(deps.wallet.getBalance(), before); // unchanged, not reduced
});

test("state persists and reloads; same-day claims stay claimed after reload", async () => {
  const storage = createMockStorage();
  const money = createMockWalletWithTransactions(0);
  const clock = createMockClock("2026-11-09");
  const base = () => ({ transaction: money.transaction, gameStorage: storage, clock });

  const a = createIncomeModule(base());
  await a.init();
  await a.openDay();          // +5
  await a.recordEntry();      // +4
  await a.recordConsume("dairy"); // +3

  const b = createIncomeModule(base());
  const snap = await b.init();
  assert.equal(snap.earned, DAILY_OPEN_GP + ENTRY_GP + CONSUME_GP);
  assert.equal(money.getBalance(), DAILY_OPEN_GP + ENTRY_GP + CONSUME_GP);

  assert.equal((await b.openDay()).credited, false);         // already opened today
  assert.equal((await b.recordConsume("dairy")).credited, false); // category already done today
});

test("a failed credit transaction throws TRANSACTION_FAILED", async () => {
  const inc = createIncomeModule({
    transaction: { execute: () => ({ ok: false, balance: 0 }) },
    gameStorage: createMockStorage(),
    clock: createMockClock(),
  });
  await inc.init();
  await assert.rejects(() => inc.openDay(), (e) => {
    assert.equal(e.code, IncomeErrorCode.TRANSACTION_FAILED);
    return true;
  });
});
