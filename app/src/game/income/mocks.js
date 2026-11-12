/**
 * In-memory mocks of A's ports for developing/testing the income module.
 * Reuses the shared money + storage doubles from repair, and voyage's advanceable
 * clock (income's daily rules need time to move forward).
 *
 * @typedef {import("./ports.js").IncomeDeps} IncomeDeps
 */
import { createMockWalletWithTransactions, createMockStorage } from "../repair/mocks.js";
import { createMockClock } from "../voyage/mocks.js";

export { createMockWalletWithTransactions, createMockStorage, createMockClock };

/**
 * Convenience: a full set of mocked deps for the income module. The clock is
 * advanceable via `clock._advanceDays(n)` / `clock._set(date)`.
 * @param {{ balance?: number, today?: string }} [opts]
 * @returns {IncomeDeps & { wallet: any, ledger: any[], clock: ReturnType<typeof createMockClock> }}
 */
export function createMockDeps({ balance = 0, today = "2026-11-09" } = {}) {
  const money = createMockWalletWithTransactions(balance);
  return {
    wallet: money.wallet,
    transaction: money.transaction,
    gameStorage: createMockStorage(),
    clock: createMockClock(today),
    ledger: money.ledger,
  };
}
