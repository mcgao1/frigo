/**
 * V1 Economy Profile tests (Phase 4B prerequisite).
 *
 * Proves the profile isolates every legacy GP reward (Collection 100/50, Story
 * 20/50/100, Letters 50/30) from a from-0-GP V1 wallet using ONLY construction-
 * time config overrides, that the two Fri mainline letters are untouched, that the
 * confirmed Income rules still earn normally, and that the modules' DEFAULT_* data
 * is NOT mutated. No business module is modified.
 *
 * Run with `node --test src/game/sandbox/v1EconomyProfile.test.js` from app/.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createCollectionModule, DEFAULT_SETS, CollectionErrorCode } from "../collection/collection.js";
import { createStoryModule, DEFAULT_CHAPTERS } from "../story/story.js";
import { createLettersModule, DEFAULT_LETTERS, LettersErrorCode } from "../letters/letters.js";
import { createIncomeModule } from "../income/income.js";
import { createMockFood } from "../detector/mocks.js";

import { createSandboxBackend } from "./sandboxBackend.js";
import { createFakeLocalStorage } from "./localStorageStorage.js";
import {
  V1_ECONOMY_PROFILE,
  V1_NAMESPACE,
  V1_COLLECTION_SETS,
  V1_STORY_CHAPTERS,
  V1_LETTERS,
  V1_MAINLINE_LETTER_IDS,
} from "./v1EconomyProfile.js";

let seq = 0;
const v1be = ({ startBalance = 0, startDate = "2026-11-09" } = {}) =>
  createSandboxBackend({
    namespace: `${V1_NAMESPACE}-test-${Date.now()}-${seq++}`,
    backend: createFakeLocalStorage(),
    startBalance,
    startDate,
  });
const base = (be) => ({ wallet: be.wallet, transaction: be.transaction, gameStorage: be.gameStorage, clock: be.clock });
const FOOD = [
  { id: "milk1", name: "Milk", kind: "milk" },
  { id: "cheese1", name: "Cheese", kind: "cheese" },
  { id: "yogurt1", name: "Yogurt", kind: "yogurt" },
  { id: "lettuce1", name: "Lettuce", kind: "lettuce" },
  { id: "spinach1", name: "Spinach", kind: "spinach" },
];
const nonIncomeCredits = (be) =>
  be.money.getState().ledger.filter((e) => e.kind === "credit" && !String(e.reason).startsWith("income:"));

// ---- unit: the profile is correctly derived -----------------------------------

test("V1 collection sets zero every reward but keep ids and names", () => {
  assert.deepEqual(
    V1_COLLECTION_SETS.map((s) => [s.id, s.name, s.reward]),
    DEFAULT_SETS.map((s) => [s.id, s.name, 0]),
  );
  assert.ok(V1_COLLECTION_SETS.every((s) => s.reward === 0));
});

test("V1 story chapters zero every reward but keep requires and beats", () => {
  assert.equal(V1_STORY_CHAPTERS.length, DEFAULT_CHAPTERS.length);
  for (let i = 0; i < DEFAULT_CHAPTERS.length; i++) {
    assert.equal(V1_STORY_CHAPTERS[i].id, DEFAULT_CHAPTERS[i].id);
    assert.equal(V1_STORY_CHAPTERS[i].reward, 0);
    assert.deepEqual(V1_STORY_CHAPTERS[i].requires, DEFAULT_CHAPTERS[i].requires);
    assert.deepEqual(V1_STORY_CHAPTERS[i].beats, DEFAULT_CHAPTERS[i].beats);
  }
});

test("V1 letters keep the two Fri letters verbatim and zero every other gift", () => {
  for (const l of V1_LETTERS) {
    const original = DEFAULT_LETTERS.find((d) => d.id === l.id);
    if (V1_MAINLINE_LETTER_IDS.includes(l.id)) {
      assert.equal(l.gift, original.gift); // Fri letters untouched
      assert.deepEqual(l.body, original.body); // body byte-for-byte
    } else {
      assert.equal(l.gift, 0); // every legacy gift neutralized
    }
  }
  // the specific legacy GP the user named is gone
  assert.equal(V1_LETTERS.find((l) => l.id === "grandma").gift, 0);
  assert.equal(V1_LETTERS.find((l) => l.id === "guild").gift, 0);
});

test("the profile does NOT mutate the modules' DEFAULT_* data", () => {
  // the originals still carry their legacy rewards — the profile copied, not edited
  assert.equal(DEFAULT_SETS.find((s) => s.id === "dairy").reward, 100);
  assert.equal(DEFAULT_SETS.find((s) => s.id === "greens").reward, 50);
  const chapterRewards = DEFAULT_CHAPTERS.map((c) => c.reward);
  assert.deepEqual(chapterRewards, [0, 20, 50, 100]);
  assert.equal(DEFAULT_LETTERS.find((l) => l.id === "grandma").gift, 50);
  assert.equal(DEFAULT_LETTERS.find((l) => l.id === "guild").gift, 30);
});

test("the V1 namespace is separate from the 300-GP playground dev save", () => {
  assert.equal(V1_NAMESPACE, "v1");
  assert.notEqual(V1_NAMESPACE, "playground");
  assert.equal(V1_ECONOMY_PROFILE.namespace, V1_NAMESPACE);
});

// ---- integration: wired on a real 0-GP sandbox backend ------------------------

test("Collection on the V1 profile: completing + claiming a set injects 0 GP", async () => {
  const be = v1be({ startBalance: 0 });
  const collection = createCollectionModule({ ...base(be), food: createMockFood(FOOD) }, V1_ECONOMY_PROFILE.collection);
  await collection.init();
  await collection.sync(); // discover milk/cheese/yogurt -> dairy complete

  const res = await collection.claimSet("dairy");
  assert.equal(res.reward, 0); // reward neutralized
  assert.equal(be.wallet.getBalance(), 0); // no GP entered the wallet
  assert.ok(nonIncomeCredits(be).every((e) => e.amount === 0)); // the collection ledger line is 0

  // re-claim is still blocked, so nothing can double-enter
  await assert.rejects(() => collection.claimSet("dairy"), (e) => {
    assert.equal(e.code, CollectionErrorCode.ALREADY_CLAIMED);
    return true;
  });
  assert.equal(be.wallet.getBalance(), 0);
});

test("Story on the V1 profile: unlocking reward chapters credits 0 GP", async () => {
  const be = v1be({ startBalance: 0 });
  const story = createStoryModule({ ...base(be) }, V1_ECONOMY_PROFILE.story);
  await story.init();

  const r2 = await story.trigger("repair:any"); // legacy ch2 was +20
  const r3 = await story.trigger("voyage:complete"); // legacy ch3 was +50
  assert.ok(r2.newlyUnlocked.length + r3.newlyUnlocked.length >= 2); // chapters still unlock
  assert.ok([...r2.newlyUnlocked, ...r3.newlyUnlocked].every((u) => u.reward === 0));

  assert.equal(be.wallet.getBalance(), 0);
  // story skips the credit entirely for reward 0 -> no story:reward ledger line at all
  assert.equal(be.money.getState().ledger.filter((e) => String(e.reason).startsWith("story:reward")).length, 0);
});

test("Letters on the V1 profile: legacy gifts are unclaimable; Fri letters deliver + read unaffected", async () => {
  const be = v1be({ startBalance: 0, startDate: "2026-11-12" }); // welcome + grandma due
  const letters = createLettersModule({ ...base(be) }, V1_ECONOMY_PROFILE.letters);
  await letters.init();
  assert.equal(letters.isDelivered("grandma"), true);

  // legacy grandma (was +50) can no longer pay out
  await assert.rejects(() => letters.claimGift("grandma"), (e) => {
    assert.equal(e.code, LettersErrorCode.NO_GIFT);
    return true;
  });

  // Fri's letter still triggers + reads exactly as before, carrying no gift
  await letters.trigger("detector:ready");
  const fri = await letters.open("fri-detector-clue");
  assert.equal(fri.from, "Fri");
  assert.equal(fri.gift, 0);
  assert.ok(fri.body.join(" ").includes("beside your fridge"));
  assert.ok(letters.getState().read.includes("fri-detector-clue"));

  // guild (was +30) delivered by its flag is also unclaimable
  await letters.trigger("voyage:complete");
  await assert.rejects(() => letters.claimGift("guild"), (e) => {
    assert.equal(e.code, LettersErrorCode.NO_GIFT);
    return true;
  });
  assert.equal(be.wallet.getBalance(), 0); // nothing ever credited
});

test("normal V1 Income rewards are unaffected by the profile (rules + caps intact)", async () => {
  const be = v1be({ startBalance: 0 });
  const income = createIncomeModule({ ...base(be) }); // DEFAULT rates = the confirmed V1 rules
  await income.init();

  assert.equal((await income.openDay()).credited, true); // +5
  assert.equal((await income.openDay()).credited, false); // once per day
  assert.equal((await income.recordEntry("b1")).credited, true); // +4
  assert.equal((await income.recordEntry("b2")).credited, true); // +4
  assert.equal((await income.recordEntry("b3")).credited, true); // +4
  assert.equal((await income.recordEntry("b4")).credited, false); // entry cap 3/day
  assert.equal((await income.recordConsume("c1", "milk")).credited, true); // +3

  assert.equal(be.wallet.getBalance(), 5 + 12 + 3); // 20
  assert.equal(income.getEarned(), 20);
  assert.ok(be.money.getState().ledger.every((e) => String(e.reason).startsWith("income:")));
});

test("a full V1-profile run: the only GP that ever enters the wallet is Income", async () => {
  const be = v1be({ startBalance: 0, startDate: "2026-11-12" });
  const food = createMockFood(FOOD);
  const collection = createCollectionModule({ ...base(be), food }, V1_ECONOMY_PROFILE.collection);
  const story = createStoryModule({ ...base(be) }, V1_ECONOMY_PROFILE.story);
  const letters = createLettersModule({ ...base(be) }, V1_ECONOMY_PROFILE.letters);
  const income = createIncomeModule({ ...base(be) });
  for (const m of [collection, story, letters, income]) await m.init();

  // confirmed V1 income
  await income.openDay(); // +5
  await income.recordEntry("b1"); // +4
  await income.recordConsume("c1", "milk"); // +3

  // every legacy reward path, exercised — must add nothing
  await collection.sync();
  await collection.claimSet("dairy"); // was +100
  await collection.claimSet("greens"); // was +50
  await story.trigger("repair:any"); // was +20
  await story.trigger("voyage:complete"); // was +50
  await story.trigger("collection:dairy");
  await story.trigger("collection:greens"); // ch4 was +100
  await letters.trigger("voyage:complete"); // guild (was +30) delivered
  // grandma (was +50) delivered by date at init
  await assert.rejects(() => letters.claimGift("grandma"), (e) => e.code === LettersErrorCode.NO_GIFT);

  assert.equal(be.wallet.getBalance(), 12); // exactly the income total (5+4+3), nothing else
  assert.equal(income.getEarned(), 12);
  assert.ok(nonIncomeCredits(be).every((e) => e.amount === 0), "no legacy GP entered the V1 wallet");
});

// re-init: the isolation survives a reload (claims/flags persisted, still 0 GP).
test("after a reload the V1 wallet still holds only Income GP (no legacy leak on re-init)", async () => {
  const backend = createFakeLocalStorage();
  const ns = `${V1_NAMESPACE}-test-${Date.now()}-${seq++}`;
  const build = () => {
    const be = createSandboxBackend({ namespace: ns, backend, startBalance: 0, startDate: "2026-11-12" });
    const food = createMockFood(FOOD);
    return {
      be,
      collection: createCollectionModule({ ...base(be), food }, V1_ECONOMY_PROFILE.collection),
      story: createStoryModule({ ...base(be) }, V1_ECONOMY_PROFILE.story),
      letters: createLettersModule({ ...base(be) }, V1_ECONOMY_PROFILE.letters),
      income: createIncomeModule({ ...base(be) }),
    };
  };

  let w = build();
  for (const m of [w.collection, w.story, w.letters, w.income]) await m.init();
  await w.income.openDay(); // +5
  await w.collection.sync();
  await w.collection.claimSet("dairy");
  await w.story.trigger("repair:any");
  assert.equal(w.be.wallet.getBalance(), 5);

  // reload, then try every legacy path AGAIN on the persisted state
  w = build();
  for (const m of [w.collection, w.story, w.letters, w.income]) await m.init();
  await w.income.openDay(); // same day -> no re-grant
  await assert.rejects(() => w.collection.claimSet("dairy"), (e) => e.code === CollectionErrorCode.ALREADY_CLAIMED);
  await w.story.trigger("repair:any"); // already unlocked -> no-op
  assert.equal(w.be.wallet.getBalance(), 5); // still just the one daily open
  assert.ok(nonIncomeCredits(w.be).every((e) => e.amount === 0));
});
