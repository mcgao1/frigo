/**
 * Tests for the letters module, run against mocked A ports.
 * Run with `node --test src/game/letters/letters.test.js` from app/.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createLettersModule, LettersErrorCode } from "./letters.js";
import { createMockDeps, createMockStorage, createMockClock } from "./mocks.js";

test("init delivers letters whose date has arrived, not future ones", async () => {
  const deps = createMockDeps({ today: "2026-11-10" });
  const l = createLettersModule(deps);
  const res = await l.init();
  assert.deepEqual(res.newlyDelivered, ["welcome"]);
  assert.equal(l.isDelivered("welcome"), true);
  assert.equal(l.isDelivered("grandma"), false); // deliverOn 2026-11-12
  assert.equal(l.unreadCount(), 1);
});

test("opening a delivered letter marks it read and returns its body", async () => {
  const l = createLettersModule(createMockDeps({ today: "2026-11-10" }));
  await l.init();
  const letter = await l.open("welcome");
  assert.equal(letter.from, "The Landlord");
  assert.ok(letter.body.length >= 1);
  assert.equal(l.unreadCount(), 0);
});

test("opening an undelivered letter throws NOT_DELIVERED", async () => {
  const l = createLettersModule(createMockDeps({ today: "2026-11-10" }));
  await l.init();
  await assert.rejects(() => l.open("grandma"), (e) => {
    assert.equal(e.code, LettersErrorCode.NOT_DELIVERED);
    return true;
  });
});

test("refresh delivers a letter once its date arrives", async () => {
  const deps = createMockDeps({ today: "2026-11-10" });
  const l = createLettersModule(deps);
  await l.init();
  assert.equal(l.isDelivered("grandma"), false);

  deps.clock._set("2026-11-12");
  const res = await l.refresh();
  assert.deepEqual(res.newlyDelivered, ["grandma"]);
  assert.equal(l.isDelivered("grandma"), true);
});

test("a flag-gated letter is delivered by trigger", async () => {
  const l = createLettersModule(createMockDeps({ today: "2026-11-10" }));
  await l.init();
  assert.equal(l.isDelivered("guild"), false);
  const res = await l.trigger("voyage:complete");
  assert.deepEqual(res.newlyDelivered, ["guild"]);
  assert.equal(l.isDelivered("guild"), true);
});

test("claiming a gift credits coins once", async () => {
  const deps = createMockDeps({ today: "2026-11-12", balance: 300 });
  const l = createLettersModule(deps);
  await l.init(); // welcome + grandma delivered

  const res = await l.claimGift("grandma");
  assert.equal(res.gift, 50);
  assert.equal(res.balance, 350);
  assert.equal(deps.wallet.getBalance(), 350);
  assert.equal(deps.ledger[0].reason, "letters:gift:grandma");

  await assert.rejects(() => l.claimGift("grandma"), (e) => {
    assert.equal(e.code, LettersErrorCode.ALREADY_CLAIMED);
    return true;
  });
  assert.equal(deps.wallet.getBalance(), 350); // not double-credited
});

test("claiming a gift from a giftless letter throws NO_GIFT", async () => {
  const l = createLettersModule(createMockDeps({ today: "2026-11-10" }));
  await l.init();
  await assert.rejects(() => l.claimGift("welcome"), (e) => {
    assert.equal(e.code, LettersErrorCode.NO_GIFT);
    return true;
  });
});

test("claiming without a transaction dep is unavailable", async () => {
  const l = createLettersModule({
    clock: createMockClock("2026-11-12"),
    gameStorage: createMockStorage(),
  });
  await l.init();
  await assert.rejects(() => l.claimGift("grandma"), (e) => {
    assert.equal(e.code, LettersErrorCode.CLAIM_UNAVAILABLE);
    return true;
  });
});

test("unknown letter throws UNKNOWN_LETTER", async () => {
  const l = createLettersModule(createMockDeps({ today: "2026-11-10" }));
  await l.init();
  await assert.rejects(() => l.open("nope"), (e) => {
    assert.equal(e.code, LettersErrorCode.UNKNOWN_LETTER);
    return true;
  });
});

test("a failed gift transaction leaves it unclaimed", async () => {
  const l = createLettersModule({
    clock: createMockClock("2026-11-12"),
    gameStorage: createMockStorage(),
    transaction: { execute: () => ({ ok: false, balance: 300 }) },
  });
  await l.init();
  await assert.rejects(() => l.claimGift("grandma"), (e) => {
    assert.equal(e.code, LettersErrorCode.TRANSACTION_FAILED);
    return true;
  });
  assert.equal(l.getState().claimed.includes("grandma"), false);
});

test("delivery, read and claimed state persist across instances", async () => {
  const storage = createMockStorage();
  const base = (today) => ({ ...createMockDeps({ today }), gameStorage: storage });

  const a = createLettersModule(base("2026-11-12"));
  await a.init();
  await a.open("welcome");
  await a.claimGift("grandma");

  const b = createLettersModule(base("2026-11-12"));
  await b.init();
  const state = b.getState();
  assert.ok(state.read.includes("welcome"));
  assert.ok(state.claimed.includes("grandma"));
  assert.equal(b.isDelivered("grandma"), true);
});
