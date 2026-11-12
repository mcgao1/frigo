/**
 * In-memory mocks of Developer A's ports, for developing and testing the repair
 * module in isolation while the real food / economy / infrastructure modules and
 * their interfaces are still Proposed. These are B's own test doubles and live
 * under game/ — they are not an implementation of A's modules.
 *
 * The wallet and transaction mocks share one balance so `transaction.execute`
 * actually moves money the way `wallet.getBalance` reports it.
 *
 * @typedef {import("./ports.js").RepairDeps} RepairDeps
 */

/** Shared money store behind the wallet + transaction mocks. */
export function createMockWalletWithTransactions(startingBalance = 0) {
  let balance = startingBalance;
  /** @type {Array<{amount:number,kind:string,reason?:string,balance:number}>} */
  const ledger = [];

  const wallet = {
    getBalance: () => balance,
  };

  const transaction = {
    execute: ({ amount, kind, reason }) => {
      if (kind === "debit") {
        if (amount > balance) return { ok: false, balance };
        balance -= amount;
      } else if (kind === "credit") {
        balance += amount;
      } else {
        return { ok: false, balance };
      }
      ledger.push({ amount, kind, reason, balance });
      return { ok: true, balance };
    },
  };

  return { wallet, transaction, ledger, getBalance: () => balance };
}

/** In-memory key/value game storage. */
export function createMockStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    load: (key) => (store.has(key) ? structuredClone(store.get(key)) : null),
    save: (state) => {
      const key = state?.key ?? "game.repair";
      store.set(key, structuredClone(state));
      return true;
    },
    _store: store,
  };
}

/** Fixed clock. */
export function createMockClock(date = "2026-11-06") {
  return { getLocalDate: () => date };
}

/** Records every applyRepair call so tests can assert infrastructure was told. */
export function createMockInfrastructure() {
  const calls = [];
  return {
    applyRepair: (req) => {
      calls.push(req);
      return { ok: true };
    },
    calls,
  };
}

/**
 * Convenience: a full set of mocked deps for the repair module.
 * @param {{ balance?: number }} [opts]
 * @returns {RepairDeps & { ledger: any[], infrastructure: { calls: any[] } }}
 */
export function createMockDeps({ balance = 200 } = {}) {
  const money = createMockWalletWithTransactions(balance);
  const infrastructure = createMockInfrastructure();
  return {
    wallet: money.wallet,
    transaction: money.transaction,
    gameStorage: createMockStorage(),
    clock: createMockClock(),
    infrastructure,
    ledger: money.ledger,
  };
}

/** Deterministic RNG for tests: cycles through `values` (each in [0,1)). */
export function createSequenceRandom(values = [0]) {
  const arr = values.length ? values : [0];
  let i = 0;
  return () => arr[i++ % arr.length];
}
