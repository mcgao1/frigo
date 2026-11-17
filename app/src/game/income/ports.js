/**
 * Ports the income module depends on — cross-module interfaces owned by
 * Developer A. Income (Developer B) depends only on these abstractions and never
 * imports A's modules. All are registered `Proposed` in
 * app/docs/INTERFACE_CHECKLIST.md. Every call is awaited (A may be sync or async).
 *
 * Reuses the repair module's transaction / gameStorage / clock port shapes — no
 * income-specific A interface is needed.
 *
 * Income does NOT subscribe to food itself: the app routes A's food events to
 * `recordEntry(batchId)` (from `food.batchAdded`) and
 * `recordConsume(batchId, foodTypeId)` (from `food.batchFullyConsumed`), the same
 * way it routes other cross-module signals. Those events + stable `batchId` /
 * `foodTypeId` fields are A's additions, registered Proposed in the checklist.
 *
 * @typedef {import("../repair/ports.js").TransactionPort} TransactionPort
 * @typedef {import("../repair/ports.js").GameStoragePort} GameStoragePort
 * @typedef {import("../repair/ports.js").ClockPort} ClockPort
 *
 * @typedef {Object} IncomeDeps
 * @property {TransactionPort} transaction  credits GreenPoints (kind "credit")
 * @property {GameStoragePort} gameStorage  persists the per-day counters
 * @property {ClockPort} clock              distinct local day drives daily reset + the +5
 */

export {};
