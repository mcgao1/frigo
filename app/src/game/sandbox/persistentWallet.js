/**
 * createPersistentWallet — the shared money double (wallet + transaction) with
 * the SAME semantics as createMockWalletWithTransactions (repair/mocks.js), but
 * its balance and full ledger are persisted through an injected GameStorage, so a
 * browser refresh restores both. Sandbox tooling only — this is B's test double,
 * not A's economy module.
 *
 * Parity with the in-memory mock (all synchronous):
 *   wallet.getBalance() -> number
 *   transaction.execute({amount, kind:"debit"|"credit", reason?})
 *     debit with amount > balance -> { ok:false, balance }  (no ledger entry)
 *     otherwise moves the balance, appends {amount,kind,reason,balance}, returns { ok:true, balance }
 *     any other kind -> { ok:false, balance }  (no ledger entry)
 */

export const WALLET_KEY = "game.wallet";

/**
 * @param {{ storage: { load: Function, save: Function }, key?: string, startingBalance?: number }} opts
 */
export function createPersistentWallet({ storage, key = WALLET_KEY, startingBalance = 0 } = {}) {
  if (!storage || typeof storage.load !== "function" || typeof storage.save !== "function") {
    throw new TypeError("persistentWallet: a storage with load/save is required");
  }

  let balance = startingBalance;
  /** @type {Array<{amount:number,kind:string,reason?:string,balance:number}>} */
  let ledger = [];

  function persist() {
    storage.save({ key, balance, ledger });
  }

  const loaded = storage.load(key);
  if (loaded && typeof loaded === "object" && Number.isFinite(loaded.balance)) {
    balance = loaded.balance;
    ledger = Array.isArray(loaded.ledger) ? loaded.ledger.map((e) => ({ ...e })) : [];
  } else {
    persist(); // establish the doc so a reload before any transaction is consistent
  }

  const wallet = {
    getBalance: () => balance,
  };

  const transaction = {
    execute: ({ amount, kind, reason } = {}) => {
      if (kind === "debit") {
        if (amount > balance) return { ok: false, balance };
        balance -= amount;
      } else if (kind === "credit") {
        balance += amount;
      } else {
        return { ok: false, balance };
      }
      ledger.push({ amount, kind, reason, balance });
      persist();
      return { ok: true, balance };
    },
  };

  /** In-place reset to the starting balance + empty ledger (used by Sandbox Reset). */
  function _reset() {
    balance = startingBalance;
    ledger.length = 0; // keep the same array reference callers may hold
    persist();
  }

  function getState() {
    return { balance, ledger: ledger.map((e) => ({ ...e })) };
  }

  return { wallet, transaction, ledger, getBalance: () => balance, _reset, getState, key };
}
