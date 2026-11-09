/**
 * Ports the exploration module depends on — cross-module interfaces owned by
 * Developer A. Exploration (Developer B) depends only on these abstractions and
 * never imports A's modules. All are registered `Proposed` in
 * app/docs/INTERFACE_CHECKLIST.md. Every call is awaited (A may be sync or async).
 *
 * Reuses the repair module's wallet / transaction / gameStorage / clock port
 * shapes — no exploration-specific A interface is needed.
 *
 * @typedef {import("../repair/ports.js").WalletPort} WalletPort
 * @typedef {import("../repair/ports.js").TransactionPort} TransactionPort
 * @typedef {import("../repair/ports.js").GameStoragePort} GameStoragePort
 * @typedef {import("../repair/ports.js").ClockPort} ClockPort
 *
 * @typedef {Object} ExplorationDeps
 * @property {WalletPort} wallet
 * @property {TransactionPort} transaction
 * @property {GameStoragePort} gameStorage
 * @property {ClockPort} clock
 */

export {};
