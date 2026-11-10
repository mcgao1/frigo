/**
 * Tests for the story module, run against mocked A ports.
 * Run with `node --test src/game/story/story.test.js` from app/.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createStoryModule, StoryErrorCode } from "./story.js";
import { createMockDeps, createMockStorage } from "./mocks.js";

test("init unlocks the opening chapter (no requirements) and timestamps it", async () => {
  const deps = createMockDeps({ today: "2026-11-10" });
  const s = createStoryModule(deps);
  const res = await s.init();
  assert.deepEqual(res.newlyUnlocked, ["ch1"]);
  assert.equal(s.isUnlocked("ch1"), true);
  assert.equal(s.isUnlocked("ch2"), false);
  assert.equal(s.listChapters().find((c) => c.id === "ch1").unlockedAt, "2026-11-10");
});

test("a trigger that completes a chapter unlocks it and credits the reward", async () => {
  const deps = createMockDeps({ balance: 300 });
  const s = createStoryModule(deps);
  await s.init();

  const res = await s.trigger("repair:any");
  assert.deepEqual(res.newlyUnlocked, [{ id: "ch2", reward: 20 }]);
  assert.equal(s.isUnlocked("ch2"), true);
  assert.equal(deps.wallet.getBalance(), 320);
  assert.equal(deps.ledger[0].reason, "story:reward:ch2");
});

test("a chapter needing several flags stays locked until all are set", async () => {
  const deps = createMockDeps();
  const s = createStoryModule(deps);
  await s.init();

  let res = await s.trigger("collection:dairy");
  assert.deepEqual(res.newlyUnlocked, []);
  assert.equal(s.isUnlocked("ch4"), false);

  res = await s.trigger("collection:greens");
  assert.deepEqual(res.newlyUnlocked, [{ id: "ch4", reward: 100 }]);
  assert.equal(s.isUnlocked("ch4"), true);
});

test("triggering the same flag twice does not unlock or reward twice", async () => {
  const deps = createMockDeps({ balance: 300 });
  const s = createStoryModule(deps);
  await s.init();

  await s.trigger("repair:any");
  const second = await s.trigger("repair:any");
  assert.deepEqual(second.newlyUnlocked, []);
  assert.equal(deps.wallet.getBalance(), 320); // still only one reward
});

test("getBeats throws CHAPTER_LOCKED until unlocked, then returns the beats", async () => {
  const s = createStoryModule(createMockDeps());
  await s.init();
  assert.throws(() => s.getBeats("ch2"), (e) => {
    assert.equal(e.code, StoryErrorCode.CHAPTER_LOCKED);
    return true;
  });
  await s.trigger("repair:any");
  const beats = s.getBeats("ch2");
  assert.ok(Array.isArray(beats) && beats.length >= 1);
});

test("getBeats throws UNKNOWN_CHAPTER for a missing chapter", async () => {
  const s = createStoryModule(createMockDeps());
  await s.init();
  assert.throws(() => s.getBeats("ch99"), (e) => {
    assert.equal(e.code, StoryErrorCode.UNKNOWN_CHAPTER);
    return true;
  });
});

test("current() reports the latest unlocked chapter", async () => {
  const s = createStoryModule(createMockDeps());
  await s.init();
  assert.deepEqual(s.current(), { id: "ch1", title: "A cold awakening" });
  await s.trigger("repair:any");
  assert.equal(s.current().id, "ch2");
});

test("without a transaction dep the chapter still unlocks, reward not granted", async () => {
  const s = createStoryModule({
    gameStorage: createMockStorage(),
  });
  await s.init();
  const res = await s.trigger("repair:any");
  assert.deepEqual(res.newlyUnlocked, [{ id: "ch2", reward: 0 }]);
  assert.equal(s.isUnlocked("ch2"), true);
});

test("a failed reward credit does not block the unlock", async () => {
  const s = createStoryModule({
    gameStorage: createMockStorage(),
    transaction: { execute: () => ({ ok: false, balance: 0 }) },
  });
  await s.init();
  const res = await s.trigger("repair:any");
  assert.deepEqual(res.newlyUnlocked, [{ id: "ch2", reward: 0 }]);
  assert.equal(s.isUnlocked("ch2"), true);
});

test("flags and unlocked chapters persist across instances", async () => {
  const storage = createMockStorage();
  const base = () => ({ ...createMockDeps(), gameStorage: storage });

  const a = createStoryModule(base());
  await a.init();
  await a.trigger("repair:any");
  await a.trigger("voyage:complete");

  const b = createStoryModule(base());
  const progress = await b.init();
  assert.equal(b.isUnlocked("ch2"), true);
  assert.equal(b.isUnlocked("ch3"), true);
  assert.equal(progress.current.id, "ch3");
});
