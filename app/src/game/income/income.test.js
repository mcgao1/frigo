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
  assert.deepEqual(s.consumedTypes, []);
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

test("recordEntry pays up to the daily cap, then stops (cap_exceeded), resets next day", async () => {
  const deps = createMockDeps();
  const inc = createIncomeModule(deps);
  await inc.init();

  for (let i = 0; i < ENTRY_CAP; i++) {
    const r = await inc.recordEntry(`d1-${i}`);
    assert.equal(r.credited, true);
    assert.equal(r.entriesToday, i + 1);
  }
  let r = await inc.recordEntry("d1-over");
  assert.equal(r.credited, false);
  assert.equal(r.reason, "CAP_EXCEEDED");
  assert.equal(deps.wallet.getBalance(), ENTRY_GP * ENTRY_CAP);
  assert.equal(deps.ledger[0].reason, "income:entry");

  deps.clock._advanceDays(1);
  r = await inc.recordEntry("d2-fresh");
  assert.equal(r.credited, true);
  assert.equal(r.entriesToday, 1);
});

test("recordConsume pays +3 per foodTypeId: once per day, up to 3 distinct foods", async () => {
  const deps = createMockDeps();
  const inc = createIncomeModule(deps);
  await inc.init();

  // three distinct foods fully consumed today, each its own batch -> +3 each
  let r = await inc.recordConsume("b-orange-1", "orange");
  assert.equal(r.credited, true);
  assert.equal(r.amount, CONSUME_GP);
  assert.equal(r.foodTypeId, "orange");
  assert.deepEqual(r.typesToday, ["orange"]);
  assert.equal((await inc.recordConsume("b-apple-1", "apple")).credited, true);
  assert.equal((await inc.recordConsume("b-banana-1", "banana")).credited, true);
  assert.equal(deps.wallet.getBalance(), CONSUME_GP * 3); // +9

  // same foodTypeId again today (a different batch) -> no reward
  r = await inc.recordConsume("b-orange-2", "orange");
  assert.equal(r.credited, false);
  assert.equal(r.reason, "TYPE_DONE");

  // a 4th distinct food today -> capped
  r = await inc.recordConsume("b-grape-1", "grape");
  assert.equal(r.credited, false);
  assert.equal(r.reason, "CAP_EXCEEDED");
  assert.equal(deps.wallet.getBalance(), CONSUME_GP * CONSUME_CAP); // still +9
  assert.ok(deps.ledger.some((l) => l.reason === "income:consume:orange"));
});

test("a new day re-rewards the same foodTypeId via a NEW batch", async () => {
  const deps = createMockDeps();
  const inc = createIncomeModule(deps);
  await inc.init();

  assert.equal((await inc.recordConsume("day1-orange", "orange")).credited, true);
  deps.clock._advanceDays(1);
  const r = await inc.recordConsume("day2-orange", "orange"); // a new real consume, new day
  assert.equal(r.credited, true);
  assert.equal(r.amount, CONSUME_GP);
  assert.equal(deps.wallet.getBalance(), CONSUME_GP * 2);
});

test("the SAME batchId replayed across a day never re-rewards", async () => {
  const deps = createMockDeps();
  const inc = createIncomeModule(deps);
  await inc.init();

  assert.equal((await inc.recordConsume("orange-batch-X", "orange")).credited, true);
  deps.clock._advanceDays(1);
  const replay = await inc.recordConsume("orange-batch-X", "orange"); // same batch re-sent
  assert.equal(replay.credited, false);
  assert.equal(replay.reason, "DUPLICATE_BATCH");
  // a genuinely new batch of the same food on the new day still earns
  assert.equal((await inc.recordConsume("orange-batch-Y", "orange")).credited, true);
  assert.equal(deps.wallet.getBalance(), CONSUME_GP * 2);
});

test("recordConsume requires a stable batchId and foodTypeId", async () => {
  const inc = createIncomeModule(createMockDeps());
  await inc.init();
  for (const badBatch of [undefined, null, "", "   "]) {
    await assert.rejects(() => inc.recordConsume(badBatch, "orange"), (e) => {
      assert.equal(e.code, IncomeErrorCode.MISSING_BATCH_ID);
      return true;
    });
  }
  for (const badType of [undefined, null, "", "   "]) {
    await assert.rejects(() => inc.recordConsume("b1", badType), (e) => {
      assert.equal(e.code, IncomeErrorCode.MISSING_FOOD_TYPE);
      return true;
    });
  }
  assert.deepEqual(inc.getSnapshot().consumedTypes, []);
  assert.equal(inc.getSnapshot().consumeBatchCount, 0);
});

test("a failed consume credit does not record the batch (retryable, no double-charge)", async () => {
  let calls = 0, bal = 0;
  const transaction = {
    execute: ({ amount }) => {
      calls += 1;
      if (calls === 1) return { ok: false, balance: bal };
      bal += amount;
      return { ok: true, balance: bal };
    },
  };
  const inc = createIncomeModule({ transaction, gameStorage: createMockStorage(), clock: createMockClock("2026-11-09") });
  await inc.init();

  await assert.rejects(() => inc.recordConsume("c1", "orange"), (e) => {
    assert.equal(e.code, IncomeErrorCode.TRANSACTION_FAILED);
    return true;
  });
  assert.equal(inc.hasConsumeBatch("c1"), false);
  assert.deepEqual(inc.getSnapshot().consumedTypes, []);

  const r = await inc.recordConsume("c1", "orange"); // retry earns its single reward
  assert.equal(r.credited, true);
  assert.equal(r.amount, CONSUME_GP);
  assert.equal(inc.consumeBatchStatus("c1"), "rewarded");
});

test("consume state persists across re-init: processed batches don't re-reward, day bucket restored", async () => {
  const storage = createMockStorage();
  const money = createMockWalletWithTransactions(0);
  const clock = createMockClock("2026-11-09");
  const base = () => ({ transaction: money.transaction, gameStorage: storage, clock });

  const a = createIncomeModule(base());
  await a.init();
  await a.recordConsume("p-orange", "orange"); // +3
  assert.equal(money.getBalance(), CONSUME_GP);

  const b = createIncomeModule(base());
  const snap = await b.init();
  assert.deepEqual(snap.consumedTypes, ["orange"]);        // today's bucket restored
  assert.equal(b.consumeBatchStatus("p-orange"), "rewarded");

  // replay the same batch after a reload -> no reward
  assert.equal((await b.recordConsume("p-orange", "orange")).reason, "DUPLICATE_BATCH");
  // same food, new batch, same day -> type already done -> no reward
  assert.equal((await b.recordConsume("p-orange-2", "orange")).reason, "TYPE_DONE");
  assert.equal(money.getBalance(), CONSUME_GP);             // unchanged
});

// --- Phase 2B closure: an UNREWARDED but seen consume batch is deduped for life.
// A batch that was skipped today (its type already earned, or the day's food cap
// was full) is still a resolved event: it must never earn, even re-sent on a
// later day when that type/cap is free again.

test("a TYPE_DONE consume batch is recorded and can never earn, even re-sent on a later day", async () => {
  const deps = createMockDeps();
  const inc = createIncomeModule(deps);
  await inc.init();

  assert.equal((await inc.recordConsume("orange-A", "orange")).credited, true); // +3
  // a second orange batch the same day: real consume, but the type already earned
  const dup = await inc.recordConsume("orange-B", "orange");
  assert.equal(dup.credited, false);
  assert.equal(dup.reason, "TYPE_DONE");
  assert.equal(inc.consumeBatchStatus("orange-B"), "type_done"); // recorded as processed

  deps.clock._advanceDays(1); // next day orange COULD earn again — but only via a NEW batch
  const replay = await inc.recordConsume("orange-B", "orange"); // this exact batch re-sent
  assert.equal(replay.credited, false);
  assert.equal(replay.reason, "DUPLICATE_BATCH"); // resolved for life, no back-pay
  assert.equal(deps.wallet.getBalance(), CONSUME_GP); // still only the one +3
});

test("a 4th-food consume batch is burned cap_exceeded and never back-paid on a later day", async () => {
  const deps = createMockDeps();
  const inc = createIncomeModule(deps);
  await inc.init();

  await inc.recordConsume("c-orange", "orange"); // +3
  await inc.recordConsume("c-apple", "apple");   // +3
  await inc.recordConsume("c-banana", "banana"); // +3  -> 3 distinct foods today
  const over = await inc.recordConsume("c-grape", "grape"); // a 4th distinct food today
  assert.equal(over.credited, false);
  assert.equal(over.reason, "CAP_EXCEEDED");
  assert.equal(inc.consumeBatchStatus("c-grape"), "cap_exceeded"); // recorded, burned

  deps.clock._advanceDays(1); // next day the distinct-food cap is free again
  const replay = await inc.recordConsume("c-grape", "grape"); // this exact batch re-sent
  assert.equal(replay.credited, false);
  assert.equal(replay.reason, "DUPLICATE_BATCH"); // the burned batch itself never back-pays
  assert.equal(deps.wallet.getBalance(), CONSUME_GP * 3); // only the 3 day-1 rewards

  // a genuinely NEW grape batch on the new day still earns (the cap, not the food, was the block)
  assert.equal((await inc.recordConsume("grape-day2", "grape")).credited, true);
  assert.equal(deps.wallet.getBalance(), CONSUME_GP * 4);
});

test("unrewarded consume batch statuses persist across re-init and still block a replay", async () => {
  const storage = createMockStorage();
  const money = createMockWalletWithTransactions(0);
  const clock = createMockClock("2026-11-09");
  const base = () => ({ transaction: money.transaction, gameStorage: storage, clock });

  const a = createIncomeModule(base());
  await a.init();
  await a.recordConsume("r-orange", "orange");     // +3 rewarded
  await a.recordConsume("r-orange-dup", "orange"); // TYPE_DONE, recorded seen
  await a.recordConsume("r-apple", "apple");       // +3
  await a.recordConsume("r-banana", "banana");     // +3  -> 3 foods today
  await a.recordConsume("r-grape", "grape");       // CAP_EXCEEDED, recorded seen
  assert.equal(money.getBalance(), CONSUME_GP * 3); // +9

  const b = createIncomeModule(base());
  await b.init();
  // the unrewarded-but-seen statuses survived the reload
  assert.equal(b.consumeBatchStatus("r-orange-dup"), "type_done");
  assert.equal(b.consumeBatchStatus("r-grape"), "cap_exceeded");

  clock._advanceDays(1); // a fresh day after the reload
  assert.equal((await b.recordConsume("r-orange-dup", "orange")).reason, "DUPLICATE_BATCH");
  assert.equal((await b.recordConsume("r-grape", "grape")).reason, "DUPLICATE_BATCH");
  assert.equal(money.getBalance(), CONSUME_GP * 3); // no back-pay after a reload
});

test("GP only increases: caps yield no credit but never debit", async () => {
  const deps = createMockDeps({ balance: 7 });
  const inc = createIncomeModule(deps);
  await inc.init();
  await inc.recordEntry("g1");            // +4 -> 11
  await inc.recordEntry("g2");            // +4 -> 15
  await inc.recordEntry("g3");            // +4 -> 19
  const before = deps.wallet.getBalance();
  const r = await inc.recordEntry("g4");  // over cap -> cap_exceeded, no credit
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
  await a.recordEntry("persist-entry"); // +4
  await a.recordConsume("persist-eat", "dairy"); // +3

  const b = createIncomeModule(base());
  const snap = await b.init();
  assert.equal(snap.earned, DAILY_OPEN_GP + ENTRY_GP + CONSUME_GP);
  assert.equal(money.getBalance(), DAILY_OPEN_GP + ENTRY_GP + CONSUME_GP);

  assert.equal((await b.openDay()).credited, false);         // already opened today
  assert.equal((await b.recordConsume("persist-eat-2", "dairy")).credited, false); // foodTypeId already rewarded today
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
  assert.equal(r.reason, "CAP_EXCEEDED");
  assert.equal(inc.entryBatchStatus("b4"), "cap_exceeded");
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
  assert.equal((await inc.recordEntry("d1-d")).reason, "CAP_EXCEEDED");

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

// --- Phase 2A follow-up: cap_exceeded is terminal; batchId is required -----

test("a cap_exceeded batch can never be back-paid, even re-delivered on a later day", async () => {
  const deps = createMockDeps();
  const inc = createIncomeModule(deps);
  await inc.init();

  await inc.recordEntry("f1");
  await inc.recordEntry("f2");
  await inc.recordEntry("f3");             // day-1 cap full
  let r = await inc.recordEntry("over-1"); // 4th new batch today -> burned
  assert.equal(r.reason, "CAP_EXCEEDED");
  assert.equal(inc.entryBatchStatus("over-1"), "cap_exceeded");

  deps.clock._advanceDays(1);              // next day, the daily cap is free again
  r = await inc.recordEntry("over-1");     // same burned batch re-delivered
  assert.equal(r.credited, false);
  assert.equal(r.reason, "CAP_EXCEEDED");  // still burned — no back-pay
  assert.equal(deps.wallet.getBalance(), ENTRY_GP * ENTRY_CAP); // only the 3 day-1 rewards

  r = await inc.recordEntry("day2-new");   // a genuinely new batch still earns
  assert.equal(r.credited, true);
});

test("recordEntry requires a stable batchId (no auto-generated id)", async () => {
  const inc = createIncomeModule(createMockDeps());
  await inc.init();
  for (const bad of [undefined, null, "", "   "]) {
    await assert.rejects(() => inc.recordEntry(bad), (e) => {
      assert.equal(e.code, IncomeErrorCode.MISSING_BATCH_ID);
      return true;
    });
  }
  assert.equal(inc.getSnapshot().entries, 0);
  assert.equal(inc.getSnapshot().entryBatchCount, 0);
});

test("cap_exceeded status persists across re-init: a reload cannot back-pay it", async () => {
  const storage = createMockStorage();
  const money = createMockWalletWithTransactions(0);
  const clock = createMockClock("2026-11-09");
  const base = () => ({ transaction: money.transaction, gameStorage: storage, clock });

  const a = createIncomeModule(base());
  await a.init();
  await a.recordEntry("c1");
  await a.recordEntry("c2");
  await a.recordEntry("c3");                 // cap full
  assert.equal((await a.recordEntry("c-over")).reason, "CAP_EXCEEDED");
  assert.equal(money.getBalance(), ENTRY_GP * ENTRY_CAP);

  const b = createIncomeModule(base());
  await b.init();
  assert.equal(b.entryBatchStatus("c-over"), "cap_exceeded"); // survived the reload
  const r = await b.recordEntry("c-over");   // re-delivered after a reload
  assert.equal(r.credited, false);
  assert.equal(r.reason, "CAP_EXCEEDED");
  assert.equal(money.getBalance(), ENTRY_GP * ENTRY_CAP); // unchanged
});
