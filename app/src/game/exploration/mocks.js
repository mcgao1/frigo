/**
 * In-memory mocks of A's ports for developing/testing the exploration module.
 * Reuses repair's money/storage doubles and voyage's advanceable clock (energy
 * regenerates across days, so the clock must move) — reuse over re-implement.
 *
 * @typedef {import("./ports.js").ExplorationDeps} ExplorationDeps
 */
import {
  createMockWalletWithTransactions,
  createMockStorage,
} from "../repair/mocks.js";
import { createMockClock } from "../voyage/mocks.js";

export { createMockWalletWithTransactions, createMockStorage, createMockClock };

/**
 * Convenience: a full set of mocked deps for the exploration module.
 * @param {{ balance?: number, today?: string }} [opts]
 * @returns {ExplorationDeps & { ledger: any[] }}
 */
export function createMockDeps({ balance = 300, today = "2026-11-09" } = {}) {
  const money = createMockWalletWithTransactions(balance);
  return {
    wallet: money.wallet,
    transaction: money.transaction,
    gameStorage: createMockStorage(),
    clock: createMockClock(today),
    ledger: money.ledger,
  };
}
