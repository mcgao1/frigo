/**
 * Ports the letters module depends on — cross-module interfaces owned by
 * Developer A. Letters (Developer B) depends only on these abstractions and
 * never imports A's modules. All are registered `Proposed` in
 * app/docs/INTERFACE_CHECKLIST.md. Every call is awaited (A may be sync or async).
 *
 * Reuses the repair module's clock / gameStorage / transaction port shapes — no
 * letters-specific A interface is needed. Delivery flags (e.g. "voyage:complete")
 * are plain internal game calls, not A interfaces.
 *
 * @typedef {import("../repair/ports.js").ClockPort} ClockPort
 * @typedef {import("../repair/ports.js").GameStoragePort} GameStoragePort
 * @typedef {import("../repair/ports.js").TransactionPort} TransactionPort
 *
 * @typedef {Object} LettersDeps
 * @property {ClockPort} clock               delivery is date-driven
 * @property {GameStoragePort} gameStorage
 * @property {TransactionPort} [transaction] required only to claim letter gifts
 */

export {};
