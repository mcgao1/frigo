/**
 * Phase 4A, Part 4 — tests for the sandbox backend assembly + Reset.
 * Run with `node --test src/game/sandbox/sandboxBackend.test.js` from app/.
 *
 * A "refresh" is a second backend built over the SAME Web Storage + namespace.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createSandboxBackend } from "./sandboxBackend.js";
import { createFakeLocalStorage, createBlockedLocalStorage } from "./localStorageStorage.js";

let seq = 0;
const uniq = (p) => `${p}-${Date.now()}-${seq++}`;

test("exposes the A-port shape plus sandbox extras", () => {
  const be = createSandboxBackend({
    namespace: uniq("be"),
    backend: createFakeLocalStorage(),
    startDate: "2026-11-09",
    startBalance: 0,
  });
  assert.equal(typeof be.gameStorage.load, "function");
  assert.equal(typeof be.gameStorage.save, "function");
  assert.equal(typeof be.wallet.getBalance, "function");
  assert.equal(typeof be.transaction.execute, "function");
  assert.equal(typeof be.clock.getLocalDate, "function");
  assert.equal(be.isPersistent, true);
  assert.equal(be.clock.getLocalDate(), "2026-11-09");
  assert.equal(be.wallet.getBalance(), 0);
});

test("balance + date round-trip across a refresh", () => {
  const backend = createFakeLocalStorage();
  const namespace = uniq("be");

  const before = createSandboxBackend({ namespace, backend, startDate: "2026-11-09", startBalance: 0 });
  before.transaction.execute({ amount: 20, kind: "credit", reason: "income" });
  before.clock._advanceDays(4); // -> 2026-11-13
  // a stand-in module doc, to prove per-module state recovers too
  before.gameStorage.save({ key: "game.repair", fragments: ["a", "b"], repaired: false });

  const after = createSandboxBackend({ namespace, backend, startDate: "2026-11-09", startBalance: 0 });
  assert.equal(after.wallet.getBalance(), 20);
  assert.equal(after.clock.getLocalDate(), "2026-11-13");
  assert.deepEqual(after.gameStorage.load("game.repair"), { key: "game.repair", fragments: ["a", "b"], repaired: false });
});

test("reset clears the namespace and restores startBalance + startDate, keeping object identity", () => {
  const be = createSandboxBackend({
    namespace: uniq("be"),
    backend: createFakeLocalStorage(),
    startDate: "2026-11-09",
    startBalance: 0,
  });
  const walletRef = be.wallet;
  const clockRef = be.clock;
  const storageRef = be.gameStorage;

  be.transaction.execute({ amount: 30, kind: "credit" });
  be.clock._advanceDays(7);
  be.gameStorage.save({ key: "game.detector", digCount: 3 });

  be.reset();

  assert.equal(be.wallet.getBalance(), 0); // back to startBalance
  assert.equal(be.clock.getLocalDate(), "2026-11-09"); // back to startDate
  assert.equal(be.gameStorage.load("game.detector"), null); // module doc cleared
  assert.deepEqual(be.money.getState().ledger, []); // ledger wiped
  // identity preserved: modules wired on these references keep working
  assert.equal(be.wallet, walletRef);
  assert.equal(be.clock, clockRef);
  assert.equal(be.gameStorage, storageRef);
});

test("reset is persisted: a refresh after reset sees the clean initial state", () => {
  const backend = createFakeLocalStorage();
  const namespace = uniq("be");

  const be = createSandboxBackend({ namespace, backend, startDate: "2026-11-09", startBalance: 0 });
  be.transaction.execute({ amount: 30, kind: "credit" });
  be.clock._advanceDays(7);
  be.gameStorage.save({ key: "game.detector", digCount: 3 });
  be.reset();

  const after = createSandboxBackend({ namespace, backend, startDate: "2026-11-09", startBalance: 0 });
  assert.equal(after.wallet.getBalance(), 0);
  assert.equal(after.clock.getLocalDate(), "2026-11-09");
  assert.equal(after.gameStorage.load("game.detector"), null);
});

test("two namespaces on one backend are isolated, including across reset", () => {
  const backend = createFakeLocalStorage();
  const stamp = Date.now();
  const a = createSandboxBackend({ namespace: "be-a-" + stamp, backend, startBalance: 0 });
  const b = createSandboxBackend({ namespace: "be-b-" + stamp, backend, startBalance: 0 });

  a.transaction.execute({ amount: 100, kind: "credit" });
  b.transaction.execute({ amount: 7, kind: "credit" });
  assert.equal(a.wallet.getBalance(), 100);
  assert.equal(b.wallet.getBalance(), 7);

  a.reset(); // must not touch b
  assert.equal(a.wallet.getBalance(), 0);
  assert.equal(b.wallet.getBalance(), 7);
});

test("reports isPersistent from the storage backend", () => {
  const ok = createSandboxBackend({ namespace: uniq("be"), backend: createFakeLocalStorage() });
  const blocked = createSandboxBackend({ namespace: uniq("be"), backend: createBlockedLocalStorage() });
  assert.equal(ok.isPersistent, true);
  assert.equal(blocked.isPersistent, false);
});

test("a blocked backend recovers nothing across a refresh (no false recovery)", () => {
  const backend = createBlockedLocalStorage();
  const namespace = uniq("be");

  const before = createSandboxBackend({ namespace, backend, startDate: "2026-11-09", startBalance: 0 });
  before.transaction.execute({ amount: 20, kind: "credit" });
  before.clock._advanceDays(4);
  assert.equal(before.wallet.getBalance(), 20); // usable this session

  const after = createSandboxBackend({ namespace, backend, startDate: "2026-11-09", startBalance: 0 });
  assert.equal(after.isPersistent, false);
  assert.equal(after.wallet.getBalance(), 0); // explicitly lost
  assert.equal(after.clock.getLocalDate(), "2026-11-09");
});

test("a non-string namespace is rejected", () => {
  assert.throws(() => createSandboxBackend({ backend: createFakeLocalStorage() }), TypeError);
});
