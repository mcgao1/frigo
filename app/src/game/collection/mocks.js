/**
 * In-memory mocks of A's ports for developing/testing the collection module.
 * Reuses the detector module's food double (getSnapshot + subscribeEvents) and
 * repair's money/storage/clock doubles — reuse over re-implement.
 *
 * @typedef {import("./ports.js").CollectionDeps} CollectionDeps
 */
import { createMockFood } from "../detector/mocks.js";
import {
  createMockWalletWithTransactions,
  createMockStorage,
  createMockClock,
} from "../repair/mocks.js";

export { createMockFood, createMockWalletWithTransactions, createMockStorage, createMockClock };

/**
 * Convenience: a full set of mocked deps for the collection module.
 * @param {{ items?: any[], balance?: number, today?: string }} [opts]
 * @returns {CollectionDeps & { food: ReturnType<typeof createMockFood>, ledger: any[] }}
 */
export function createMockDeps({ items = [], balance = 300, today = "2026-11-10" } = {}) {
  const money = createMockWalletWithTransactions(balance);
  return {
    food: createMockFood(items),
    gameStorage: createMockStorage(),
    clock: createMockClock(today),
    transaction: money.transaction,
    wallet: money.wallet,
    ledger: money.ledger,
  };
}
