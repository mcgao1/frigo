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

// --- Phase 3C: Fri's mainline clue letters (flag-gated, no gift) ---------------

test("detector:ready delivers Fri's clue letter exactly once, with no gift", async () => {
  const deps = createMockDeps({ today: "2026-11-11" });
  const l = createLettersModule(deps);
  await l.init();
  assert.equal(l.isDelivered("fri-detector-clue"), false); // nothing before the flag

  const res = await l.trigger("detector:ready");
  assert.deepEqual(res.newlyDelivered, ["fri-detector-clue"]);
  assert.equal(l.isDelivered("fri-detector-clue"), true);

  const letter = await l.open("fri-detector-clue"); // readable
  assert.equal(letter.from, "Fri");
  assert.equal(letter.gift, 0);                                   // no GP
  assert.ok(letter.body.join(" ").includes("beside your fridge")); // points to the fridge-side dig
  const row = l.listInbox().find((x) => x.id === "fri-detector-clue");
  assert.equal(row.hasGift, false);
  await assert.rejects(() => l.claimGift("fri-detector-clue"), (e) => {
    assert.equal(e.code, LettersErrorCode.NO_GIFT);
    return true;
  });

  // re-raising the same flag must not deliver it a second time
  assert.deepEqual((await l.trigger("detector:ready")).newlyDelivered, []);
  assert.equal(deps.ledger.length, 0); // no GP ever moved for a mainline letter
});

test("detector:repaired delivers Fri's Frostpeak letter exactly once, with no gift", async () => {
  const deps = createMockDeps({ today: "2026-11-15" });
  const l = createLettersModule(deps);
  await l.init();
  assert.equal(l.isDelivered("fri-frostpeak-clue"), false);

  const res = await l.trigger("detector:repaired");
  assert.deepEqual(res.newlyDelivered, ["fri-frostpeak-clue"]);
  const letter = await l.open("fri-frostpeak-clue");
  assert.equal(letter.from, "Fri");
  assert.equal(letter.gift, 0);
  assert.ok(letter.body.join(" ").includes("Frostpeak"));
  assert.deepEqual((await l.trigger("detector:repaired")).newlyDelivered, []); // once only
  assert.equal(deps.ledger.length, 0);
});

test("Fri letters are flag-gated, not date-gated: time passing alone never delivers them", async () => {
  const deps = createMockDeps({ today: "2026-11-09" });
  const l = createLettersModule(deps);
  await l.init();

  deps.clock._set("2026-11-30"); // weeks pass with no flag raised
  const res = await l.refresh();
  assert.ok(!res.newlyDelivered.includes("fri-detector-clue"));
  assert.ok(!res.newlyDelivered.includes("fri-frostpeak-clue"));
  assert.equal(l.isDelivered("fri-detector-clue"), false);

  await l.trigger("detector:ready"); // the flag, not the date, delivers it
  assert.equal(l.isDelivered("fri-detector-clue"), true);
});

test("Fri letters persist delivered+read once across re-init and never re-deliver (cross-day)", async () => {
  const storage = createMockStorage();
  const base = (today) => ({ ...createMockDeps({ today }), gameStorage: storage });

  const a = createLettersModule(base("2026-11-12")); // welcome + grandma already delivered by date
  await a.init();
  await a.trigger("detector:ready");
  await a.trigger("detector:repaired");
  await a.open("fri-detector-clue");

  const b = createLettersModule(base("2026-11-25")); // reload on a much later day
  const res = await b.init();
  assert.deepEqual(res.newlyDelivered, []);                     // nothing re-delivered on reload
  assert.equal(b.isDelivered("fri-detector-clue"), true);
  assert.equal(b.isDelivered("fri-frostpeak-clue"), true);
  assert.ok(b.getState().read.includes("fri-detector-clue"));  // read survived

  assert.deepEqual((await b.trigger("detector:ready")).newlyDelivered, []);    // re-raise: still no re-deliver
  assert.deepEqual((await b.trigger("detector:repaired")).newlyDelivered, []);
});

test("the new mainline letters leave the existing letters and their rewards untouched", async () => {
  const l = createLettersModule(createMockDeps({ today: "2026-11-12" }));
  await l.init();
  assert.equal(l.isDelivered("welcome"), true);              // date-gated, delivered
  assert.equal(l.isDelivered("grandma"), true);
  assert.equal(l.isDelivered("guild"), false);              // still flag-gated on voyage:complete
  assert.equal(l.isDelivered("fri-detector-clue"), false);  // Fri letters never deliver by date
  assert.equal(l.isDelivered("fri-frostpeak-clue"), false);
  const g = await l.open("grandma");
  assert.equal(g.gift, 50);                                 // old gift reward unchanged
});
