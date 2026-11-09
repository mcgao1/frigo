/**
 * In-memory mocks of A's ports for developing/testing the voyage module.
 * Reuses the shared money + storage doubles from the repair module. The clock,
 * though, must be able to advance (voyages span days), so this module provides
 * an advanceable clock rather than repair's fixed one.
 *
 * @typedef {import("./ports.js").VoyageDeps} VoyageDeps
 */
import {
  createMockWalletWithTransactions,
  createMockStorage,
} from "../repair/mocks.js";

export { createMockWalletWithTransactions, createMockStorage };

/** Advanceable clock: `_set(date)` and `_advanceDays(n)` move time forward. */
export function createMockClock(date = "2026-11-09") {
  let current = date;
  return {
    getLocalDate: () => current,
    _set: (d) => {
      current = d;
    },
    _advanceDays: (n) => {
      const t = Date.parse(`${current}T00:00:00Z`);
      current = new Date(t + n * 86400000).toISOString().slice(0, 10);
      return current;
    },
  };
}

/**
 * Convenience: a full set of mocked deps for the voyage module. A deterministic
 * rng (always 0 → reward == min) is returned separately so tests can pass it to
 * createVoyageModule's options for repeatable rewards.
 * @param {{ balance?: number, today?: string }} [opts]
 * @returns {VoyageDeps & { ledger: any[], rngMin: () => number }}
 */
export function createMockDeps({ balance = 300, today = "2026-11-09" } = {}) {
  const money = createMockWalletWithTransactions(balance);
  return {
    wallet: money.wallet,
    transaction: money.transaction,
    gameStorage: createMockStorage(),
    clock: createMockClock(today),
    ledger: money.ledger,
    rngMin: () => 0,
  };
}
