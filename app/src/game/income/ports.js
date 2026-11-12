/**
 * Ports the income module depends on — cross-module interfaces owned by
 * Developer A. Income (Developer B) depends only on these abstractions and never
 * imports A's modules. All are registered `Proposed` in
 * app/docs/INTERFACE_CHECKLIST.md. Every call is awaited (A may be sync or async).
 *
 * Reuses the repair module's transaction / gameStorage / clock port shapes — no
 * income-specific A interface is needed.
 *
 * Income does NOT subscribe to food itself: the app routes food events
 * (batch entered / batch consumed, with a category) to `recordEntry()` /
 * `recordConsume(category)`, the same way it routes other cross-module signals.
 * Those food events are A's `food.subscribeEvents` additions, already Proposed.
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
