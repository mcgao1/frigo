/**
 * createSandboxBackend — bundles the three persistent primitives (storage, wallet,
 * clock) under ONE namespace into the A-port shape the business modules consume
 * ({ gameStorage, wallet, transaction, clock }), plus a Sandbox Reset.
 *
 * Reset clears the whole namespace back to a defined initial state IN PLACE: the
 * storage / wallet / clock objects keep their identity, so modules already wired
 * on this backend keep working — callers only re-init() their modules afterwards
 * to reload the now-cleared per-module docs. This is what lets a real browser
 * refresh (rebuild the backend over the same localStorage + namespace) recover
 * every module's state, and what lets Reset return to a clean slate without
 * re-wiring.
 *
 * Sandbox tooling only — not A's modules, and it imports no business module.
 */
import { createLocalStorageGameStorage } from "./localStorageStorage.js";
import { createPersistentWallet } from "./persistentWallet.js";
import { createControllableClock } from "./controllableClock.js";

export const SANDBOX_DEFAULTS = Object.freeze({ startDate: "2026-11-09", startBalance: 0 });

/**
 * @param {{ namespace: string, startDate?: string, startBalance?: number, backend?: object }} opts
 *   backend: a Web Storage; defaults to globalThis.localStorage. Pass a fake in Node.
 */
export function createSandboxBackend({
  namespace,
  startDate = SANDBOX_DEFAULTS.startDate,
  startBalance = SANDBOX_DEFAULTS.startBalance,
  backend,
} = {}) {
  if (!namespace || typeof namespace !== "string") {
    throw new TypeError("sandboxBackend: a non-empty string namespace is required");
  }

  const storage = createLocalStorageGameStorage({ namespace, backend });
  const money = createPersistentWallet({ storage, startingBalance: startBalance });
  const clock = createControllableClock({ storage, startDate });

  /**
   * Clear the whole namespace back to the defined initial state, in place.
   * Order: drop every doc, then re-establish wallet + clock at their defaults.
   * Afterwards every per-module doc is gone, so re-init()'d modules start fresh.
   */
  function reset() {
    storage.reset(); // drop every doc (wallet, clock, and all module docs)
    money._reset(); // balance -> startBalance, empty ledger, re-persist game.wallet
    clock._reset(); // date -> startDate, re-persist game.clock
    return { startBalance, startDate };
  }

  function getState() {
    return {
      namespace,
      isPersistent: storage.isPersistent,
      money: money.getState(),
      clock: clock.getState(),
      keys: storage.keys(),
    };
  }

  return {
    // A-port shape the business modules consume:
    gameStorage: storage,
    wallet: money.wallet,
    transaction: money.transaction,
    clock,
    // sandbox extras:
    money,
    storage,
    isPersistent: storage.isPersistent,
    namespace,
    startDate,
    startBalance,
    reset,
    getState,
  };
}
