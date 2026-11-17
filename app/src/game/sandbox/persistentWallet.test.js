/**
 * Phase 4A, Part 2 — tests for the persistent Wallet + ledger.
 * Run with `node --test src/game/sandbox/persistentWallet.test.js` from app/.
 *
 * Each test uses its own namespace + fake backend. Reload is simulated by
 * building a SECOND storage + wallet over the SAME backend + namespace.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createPersistentWallet } from "./persistentWallet.js";
import {
  createLocalStorageGameStorage,
  createFakeLocalStorage,
  createBlockedLocalStorage,
} from "./localStorageStorage.js";
import { createMockWalletWithTransactions } from "../repair/mocks.js";

let seq = 0;
const uniq = (p) => `${p}-${Date.now()}-${seq++}`;
const storageOn = (backend, namespace) => createLocalStorageGameStorage({ namespace, backend });

test("starts at the starting balance with an empty ledger", () => {
  const w = createPersistentWallet({
    storage: storageOn(createFakeLocalStorage(), uniq("w")),
    startingBalance: 55,
  });
  assert.equal(w.getBalance(), 55);
  assert.equal(w.wallet.getBalance(), 55);
  assert.deepEqual(w.getState().ledger, []);
});

test("debit and credit match the in-memory mock exactly (balance + ledger)", () => {
  const seqOps = [
    { amount: 5, kind: "debit", reason: "explore:dig" },
    { amount: 10, kind: "credit", reason: "income:consume" },
    { amount: 999, kind: "debit", reason: "too-much" }, // rejected
    { amount: 3, kind: "nonsense" }, // rejected
    { amount: 15, kind: "debit", reason: "voyage:fare" },
  ];

  const mock = createMockWalletWithTransactions(20);
  const persistent = createPersistentWallet({
    storage: storageOn(createFakeLocalStorage(), uniq("w")),
    startingBalance: 20,
  });

  for (const op of seqOps) {
    const a = mock.transaction.execute(op);
    const b = persistent.transaction.execute(op);
    assert.deepEqual(b, a); // same {ok, balance} every step
  }
  assert.equal(persistent.getBalance(), mock.getBalance());
  assert.deepEqual(persistent.getState().ledger, mock.ledger); // identical ledgers
});

test("an over-balance debit fails with ok:false and writes no ledger entry", () => {
  const w = createPersistentWallet({
    storage: storageOn(createFakeLocalStorage(), uniq("w")),
    startingBalance: 4,
  });
  const res = w.transaction.execute({ amount: 5, kind: "debit", reason: "nope" });
  assert.deepEqual(res, { ok: false, balance: 4 });
  assert.equal(w.getBalance(), 4);
  assert.deepEqual(w.getState().ledger, []);
});

test("balance and ledger persist across a simulated reload", () => {
  const backend = createFakeLocalStorage();
  const ns = uniq("w");

  const before = createPersistentWallet({ storage: storageOn(backend, ns), startingBalance: 20 });
  before.transaction.execute({ amount: 5, kind: "debit", reason: "explore:dig" });
  before.transaction.execute({ amount: 12, kind: "credit", reason: "income:entry" });
  assert.equal(before.getBalance(), 27);

  const after = createPersistentWallet({ storage: storageOn(backend, ns), startingBalance: 20 });
  assert.equal(after.getBalance(), 27); // recovered, not reset to 20
  assert.deepEqual(after.getState().ledger, [
    { amount: 5, kind: "debit", reason: "explore:dig", balance: 15 },
    { amount: 12, kind: "credit", reason: "income:entry", balance: 27 },
  ]);
});

test("_reset returns to the starting balance + empty ledger, and that persists", () => {
  const backend = createFakeLocalStorage();
  const ns = uniq("w");

  const w = createPersistentWallet({ storage: storageOn(backend, ns), startingBalance: 10 });
  w.transaction.execute({ amount: 5, kind: "credit" });
  assert.equal(w.getBalance(), 15);

  w._reset();
  assert.equal(w.getBalance(), 10);
  assert.deepEqual(w.getState().ledger, []);

  const after = createPersistentWallet({ storage: storageOn(backend, ns), startingBalance: 10 });
  assert.equal(after.getBalance(), 10); // the reset was persisted
  assert.deepEqual(after.getState().ledger, []);
});

test("the returned live ledger reference reflects executed transactions", () => {
  const w = createPersistentWallet({
    storage: storageOn(createFakeLocalStorage(), uniq("w")),
    startingBalance: 30,
  });
  assert.equal(w.ledger.length, 0);
  w.transaction.execute({ amount: 15, kind: "debit", reason: "voyage:fare" });
  assert.equal(w.ledger.length, 1);
  assert.equal(w.ledger[0].balance, 15);
});

test("with a blocked storage it still works in-session but does NOT recover across reload", () => {
  const backend = createBlockedLocalStorage();
  const ns = uniq("w");

  const before = createPersistentWallet({ storage: storageOn(backend, ns), startingBalance: 20 });
  before.transaction.execute({ amount: 5, kind: "debit" });
  assert.equal(before.getBalance(), 15); // usable this session

  const after = createPersistentWallet({ storage: storageOn(backend, ns), startingBalance: 20 });
  assert.equal(after.getBalance(), 20); // explicitly back to start — no false recovery
});

test("a storage without load/save is rejected", () => {
  assert.throws(() => createPersistentWallet({ storage: {} }), TypeError);
  assert.throws(() => createPersistentWallet({}), TypeError);
});
