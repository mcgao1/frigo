/**
 * Ports the repair module depends on — the cross-module interfaces owned by
 * Developer A (food / economy / infrastructure). Repair (Developer B) only
 * depends on these abstractions; it never imports A's modules directly.
 *
 * Status of each port is tracked in app/docs/INTERFACE_CHECKLIST.md. All of
 * these are currently `Proposed`, so the exact shapes are NOT locked. The repair
 * module awaits every call, so A may implement them synchronously or async
 * without breaking repair.
 *
 * @typedef {Object} WalletPort
 * @property {() => (number | Promise<number>)} getBalance
 *   `wallet.getBalance()` — current wallet balance in currency units.
 *
 * @typedef {Object} TransactionPort
 * @property {(req: { amount: number, kind: "debit" | "credit", reason?: string })
 *   => ({ ok: boolean, balance: number } | Promise<{ ok: boolean, balance: number }>)}
 *   execute
 *   `transaction.execute()` — atomically debit/credit the wallet.
 *
 * @typedef {Object} GameStoragePort
 * @property {(key?: string) => (unknown | Promise<unknown>)} load
 *   `gameStorage.load()` — read persisted state, or null when nothing is stored.
 * @property {(state: unknown) => (void | boolean | Promise<void | boolean>)} save
 *   `gameStorage.save()` — persist state.
 *
 * @typedef {Object} ClockPort
 * @property {() => (Date | string | Promise<Date | string>)} getLocalDate
 *   `clock.getLocalDate()` — current local date (used to timestamp repairs).
 *
 * @typedef {Object} InfrastructurePort
 * @property {(req: { component: string, level?: number })
 *   => (unknown | Promise<unknown>)} applyRepair
 *   `infrastructure.applyRepair()` — tell infrastructure a component is fixed so
 *   cooling state updates. Called best-effort (failures are swallowed) until the
 *   interface is Agreed.
 *
 * @typedef {Object} RepairDeps
 * @property {WalletPort} wallet
 * @property {TransactionPort} transaction
 * @property {GameStoragePort} gameStorage
 * @property {ClockPort} [clock]
 * @property {InfrastructurePort} [infrastructure]
 */

export {};
