/**
 * In-memory mocks of A's ports for developing/testing the story module.
 * Reuses repair's money/storage/clock doubles — reuse over re-implement.
 *
 * @typedef {import("./ports.js").StoryDeps} StoryDeps
 */
import {
  createMockWalletWithTransactions,
  createMockStorage,
  createMockClock,
} from "../repair/mocks.js";

export { createMockWalletWithTransactions, createMockStorage, createMockClock };

/**
 * Convenience: a full set of mocked deps for the story module.
 * @param {{ balance?: number, today?: string }} [opts]
 * @returns {StoryDeps & { wallet: object, ledger: any[] }}
 */
export function createMockDeps({ balance = 300, today = "2026-11-10" } = {}) {
  const money = createMockWalletWithTransactions(balance);
  return {
    gameStorage: createMockStorage(),
    clock: createMockClock(today),
    transaction: money.transaction,
    wallet: money.wallet,
    ledger: money.ledger,
  };
}
