/**
 * Phase 4A, Part 1 — tests for the localStorage-backed GameStorage.
 * Run with `node --test src/game/sandbox/localStorageStorage.test.js` from app/.
 *
 * Every test uses its OWN namespace and its OWN fake backend, so stale sandbox
 * data can never leak between tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createLocalStorageGameStorage,
  createFakeLocalStorage,
  createBlockedLocalStorage,
  backendWorks,
} from "./localStorageStorage.js";

let seq = 0;
const freshNs = () => `test-storage-${Date.now()}-${seq++}`;

test("saves and loads a doc round-trip; a missing key loads as null", () => {
  const backend = createFakeLocalStorage();
  const s = createLocalStorageGameStorage({ namespace: freshNs(), backend });

  assert.equal(s.isPersistent, true);
  assert.equal(s.load("game.money"), null); // nothing saved yet

  s.save({ key: "game.money", balance: 42, ledger: [{ amount: 5, kind: "credit" }] });
  const loaded = s.load("game.money");
  assert.equal(loaded.balance, 42);
  assert.deepEqual(loaded.ledger, [{ amount: 5, kind: "credit" }]);
});

test("load returns a fresh copy, not a shared reference into the store", () => {
  const s = createLocalStorageGameStorage({ namespace: freshNs(), backend: createFakeLocalStorage() });
  s.save({ key: "k", list: [1, 2, 3] });

  const first = s.load("k");
  first.list.push(999); // mutate the returned copy
  const second = s.load("k");
  assert.deepEqual(second.list, [1, 2, 3]); // store is untouched
});

test("state persists across a simulated reload (new instance, same backend + namespace)", () => {
  const backend = createFakeLocalStorage();
  const namespace = freshNs();

  const before = createLocalStorageGameStorage({ namespace, backend });
  before.save({ key: "game.detector", digCount: 2, foundAt: null });

  // "Refresh": a brand-new storage object over the same backend + namespace.
  const after = createLocalStorageGameStorage({ namespace, backend });
  const recovered = after.load("game.detector");
  assert.equal(recovered.digCount, 2);
  assert.equal(recovered.foundAt, null);
});

test("namespaces are isolated: another namespace on the same backend sees nothing", () => {
  const backend = createFakeLocalStorage();
  const a = createLocalStorageGameStorage({ namespace: "ns-a-" + Date.now(), backend });
  const b = createLocalStorageGameStorage({ namespace: "ns-b-" + Date.now(), backend });

  a.save({ key: "game.money", balance: 100 });
  assert.equal(a.load("game.money").balance, 100);
  assert.equal(b.load("game.money"), null); // b's namespace is empty
});

test("reset clears only this namespace's docs, leaving other namespaces intact", () => {
  const backend = createFakeLocalStorage();
  const stamp = Date.now();
  const a = createLocalStorageGameStorage({ namespace: "reset-a-" + stamp, backend });
  const b = createLocalStorageGameStorage({ namespace: "reset-b-" + stamp, backend });

  a.save({ key: "game.money", balance: 7 });
  a.save({ key: "game.clock", date: "2026-11-17" });
  b.save({ key: "game.money", balance: 99 });

  a.reset();
  assert.equal(a.load("game.money"), null);
  assert.equal(a.load("game.clock"), null);
  assert.deepEqual(a.keys(), []);
  assert.equal(b.load("game.money").balance, 99); // other namespace survives
});

test("when the backend is unavailable, isPersistent is false and it falls back to memory", () => {
  const s = createLocalStorageGameStorage({ namespace: freshNs(), backend: createBlockedLocalStorage() });
  assert.equal(s.isPersistent, false);

  s.save({ key: "game.money", balance: 5 });
  assert.equal(s.load("game.money").balance, 5); // still usable in-session via memory
});

test("a non-persistent store does NOT recover across a reload (no false recovery)", () => {
  const backend = createBlockedLocalStorage();
  const namespace = freshNs();

  const before = createLocalStorageGameStorage({ namespace, backend });
  assert.equal(before.isPersistent, false);
  before.save({ key: "game.money", balance: 5 });

  // "Refresh" with the same blocked backend: a fresh in-memory store, nothing recovered.
  const after = createLocalStorageGameStorage({ namespace, backend });
  assert.equal(after.isPersistent, false);
  assert.equal(after.load("game.money"), null); // explicitly lost, not a silent pass
});

test("backendWorks reports availability honestly", () => {
  assert.equal(backendWorks(createFakeLocalStorage()), true);
  assert.equal(backendWorks(createBlockedLocalStorage()), false);
  assert.equal(backendWorks(null), false);
  assert.equal(backendWorks(undefined), false);
});

test("a non-string namespace is rejected", () => {
  assert.throws(() => createLocalStorageGameStorage({ backend: createFakeLocalStorage() }), TypeError);
  assert.throws(
    () => createLocalStorageGameStorage({ namespace: "", backend: createFakeLocalStorage() }),
    TypeError,
  );
});
