/**
 * In-memory mocks of A's ports for developing/testing the letters module.
 * Reuses repair's money/storage doubles and voyage's advanceable clock (delivery
 * is date-driven, so the clock must move) — reuse over re-implement.
 *
 * @typedef {import("./ports.js").LettersDeps} LettersDeps
 */
import { createMockWalletWithTransactions, createMockStorage } from "../repair/mocks.js";
import { createMockClock } from "../voyage/mocks.js";

export { createMockWalletWithTransactions, createMockStorage, createMockClock };

/**
 * Convenience: a full set of mocked deps for the letters module.
 * @param {{ balance?: number, today?: string }} [opts]
 * @returns {LettersDeps & { wallet: object, ledger: any[] }}
 */
export function createMockDeps({ balance = 300, today = "2026-11-10" } = {}) {
  const money = createMockWalletWithTransactions(balance);
  return {
    clock: createMockClock(today),
    gameStorage: createMockStorage(),
    transaction: money.transaction,
    wallet: money.wallet,
    ledger: money.ledger,
  };
}
