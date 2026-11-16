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

// --- Phase 2A: entry reward dedup by batchId ------------------------------

test("recordEntry rewards once per batchId; a duplicate delivery is ignored", async () => {
  const deps = createMockDeps();
  const inc = createIncomeModule(deps);
  await inc.init();

  let r = await inc.recordEntry("batch-1");
  assert.equal(r.credited, true);
  assert.equal(r.amount, ENTRY_GP);
  assert.equal(r.batchId, "batch-1");
  assert.equal(r.entriesToday, 1);

  r = await inc.recordEntry("batch-1"); // same batch delivered again, same day
  assert.equal(r.credited, false);
  assert.equal(r.reason, "DUPLICATE_BATCH");
  assert.equal(deps.wallet.getBalance(), ENTRY_GP); // no second +4
  assert.equal(inc.getSnapshot().entries, 1);       // the daily slot was not re-consumed
  assert.equal(inc.getSnapshot().entryBatchCount, 1);
});

test("the daily cap counts rewarded batches; a duplicate does not consume a slot", async () => {
  const deps = createMockDeps();
  const inc = createIncomeModule(deps);
  await inc.init();

  await inc.recordEntry("b1");
  await inc.recordEntry("b2");
  await inc.recordEntry("b3"); // ENTRY_CAP (3) reached
  assert.equal(inc.getSnapshot().entries, ENTRY_CAP);

  let r = await inc.recordEntry("b1"); // duplicate of a rewarded batch
  assert.equal(r.reason, "DUPLICATE_BATCH"); // distinguished from the cap

  r = await inc.recordEntry("b4"); // a genuinely new batch, over today's cap
  assert.equal(r.reason, "DAILY_CAP");
  assert.equal(deps.wallet.getBalance(), ENTRY_GP * ENTRY_CAP);
});

test("a batchId cannot earn again after the day rolls over", async () => {
  const deps = createMockDeps();
  const inc = createIncomeModule(deps);
  await inc.init();

  assert.equal((await inc.recordEntry("keep-1")).credited, true);
  deps.clock._advanceDays(1);
  const r = await inc.recordEntry("keep-1"); // new day, cap free, but same batch
  assert.equal(r.credited, false);
  assert.equal(r.reason, "DUPLICATE_BATCH");
  assert.equal(deps.wallet.getBalance(), ENTRY_GP); // still only the one +4
});

test("a new day resets the daily cap for NEW batchIds", async () => {
  const deps = createMockDeps();
  const inc = createIncomeModule(deps);
  await inc.init();

  await inc.recordEntry("d1-a");
  await inc.recordEntry("d1-b");
  await inc.recordEntry("d1-c"); // day 1 cap reached
  assert.equal((await inc.recordEntry("d1-d")).reason, "DAILY_CAP");

  deps.clock._advanceDays(1);
  const r = await inc.recordEntry("d2-a"); // new day, new batch
  assert.equal(r.credited, true);
  assert.equal(r.entriesToday, 1);
  assert.equal(deps.wallet.getBalance(), ENTRY_GP * (ENTRY_CAP + 1));
});

test("rewarded batchIds persist across re-init: a reload cannot re-earn", async () => {
  const storage = createMockStorage();
  const money = createMockWalletWithTransactions(0);
  const clock = createMockClock("2026-11-09");
  const base = () => ({ transaction: money.transaction, gameStorage: storage, clock });

  const a = createIncomeModule(base());
  await a.init();
  await a.recordEntry("persist-1"); // +4
  assert.equal(money.getBalance(), ENTRY_GP);

  const b = createIncomeModule(base());
  const snap = await b.init();
  assert.equal(snap.entryBatchCount, 1);
  assert.equal(b.hasEntryBatch("persist-1"), true);

  const r = await b.recordEntry("persist-1"); // same batch after a reload
  assert.equal(r.credited, false);
  assert.equal(r.reason, "DUPLICATE_BATCH");
  assert.equal(money.getBalance(), ENTRY_GP); // unchanged
});

test("a failed entry credit does not record the batchId (retryable, no double-charge)", async () => {
  let calls = 0;
  let bal = 0;
  const transaction = {
    execute: ({ amount }) => {
      calls += 1;
      if (calls === 1) return { ok: false, balance: bal }; // first attempt fails
      bal += amount;
      return { ok: true, balance: bal };
    },
  };
  const inc = createIncomeModule({ transaction, gameStorage: createMockStorage(), clock: createMockClock("2026-11-09") });
  await inc.init();

  await assert.rejects(() => inc.recordEntry("b1"), (e) => {
    assert.equal(e.code, IncomeErrorCode.TRANSACTION_FAILED);
    return true;
  });
  assert.equal(inc.hasEntryBatch("b1"), false); // not recorded
  assert.equal(inc.getSnapshot().entries, 0);   // slot not consumed

  const r = await inc.recordEntry("b1"); // retry now succeeds, earns its single reward
  assert.equal(r.credited, true);
  assert.equal(r.amount, ENTRY_GP);
  assert.equal(inc.hasEntryBatch("b1"), true);
  assert.equal(inc.getSnapshot().entries, 1);
});
