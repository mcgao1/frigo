/**
 * In-memory mocks of A's ports for developing/testing the detector in isolation.
 * Reuses the shared money / storage / clock doubles from the repair module
 * (reuse over re-implement) and adds a food mock (getSnapshot + subscribeEvents).
 *
 * @typedef {import("./ports.js").DetectorDeps} DetectorDeps
 */
import {
  createMockWalletWithTransactions,
  createMockStorage,
  createMockClock,
} from "../repair/mocks.js";

export { createMockWalletWithTransactions, createMockStorage, createMockClock };

/**
 * Mock food port. `items` is the current snapshot; `emit(event)` notifies
 * subscribers (used to test auto-staleness on food changes).
 * @param {import("./ports.js").FoodItem[]} [items]
 */
export function createMockFood(items = []) {
  let current = items.map((i) => ({ ...i }));
  const subscribers = new Set();

  return {
    getSnapshot: () => ({ items: current.map((i) => ({ ...i })) }),
    subscribeEvents: (cb) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    /** Test helper: replace the snapshot and notify subscribers. */
    _set: (next, event = { type: "changed" }) => {
      current = next.map((i) => ({ ...i }));
      for (const cb of subscribers) cb(event);
    },
    /** Test helper: emit an event without changing items. */
    _emit: (event) => {
      for (const cb of subscribers) cb(event);
    },
    _subscriberCount: () => subscribers.size,
  };
}

/**
 * Convenience: a full set of mocked deps for the detector module.
 * @param {{ balance?: number, items?: import("./ports.js").FoodItem[], today?: string }} [opts]
 * @returns {DetectorDeps & { food: ReturnType<typeof createMockFood>, ledger: any[] }}
 */
export function createMockDeps({ balance = 300, items = [], today = "2026-11-09" } = {}) {
  const money = createMockWalletWithTransactions(balance);
  return {
    food: createMockFood(items),
    gameStorage: createMockStorage(),
    clock: createMockClock(today),
    wallet: money.wallet,
    transaction: money.transaction,
    ledger: money.ledger,
  };
}
