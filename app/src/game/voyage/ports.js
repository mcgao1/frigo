/**
 * Ports the voyage module depends on — cross-module interfaces owned by
 * Developer A. Voyage (Developer B) depends only on these abstractions and never
 * imports A's modules. All are registered `Proposed` in
 * app/docs/INTERFACE_CHECKLIST.md. Every call is awaited (A may be sync or async).
 *
 * Voyage reuses the same wallet / transaction / gameStorage / clock port shapes
 * the repair module already defined — no voyage-specific A interface is needed.
 *
 * @typedef {import("../repair/ports.js").WalletPort} WalletPort
 * @typedef {import("../repair/ports.js").TransactionPort} TransactionPort
 * @typedef {import("../repair/ports.js").GameStoragePort} GameStoragePort
 * @typedef {import("../repair/ports.js").ClockPort} ClockPort
 *
 * @typedef {Object} VoyageDeps
 * @property {WalletPort} wallet
 * @property {TransactionPort} transaction
 * @property {GameStoragePort} gameStorage
 * @property {ClockPort} clock
 */

export {};
