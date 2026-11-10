/**
 * Ports the collection module depends on — cross-module interfaces owned by
 * Developer A. Collection (Developer B) depends only on these abstractions and
 * never imports A's modules. All are registered `Proposed` in
 * app/docs/INTERFACE_CHECKLIST.md. Every call is awaited (A may be sync or async).
 *
 * Reuses the repair module's transaction / gameStorage / clock port shapes and
 * the detector module's food port shape — no collection-specific A interface is
 * needed.
 *
 * Assumption on food events (food.subscribeEvents is Proposed): an "added" event
 * MAY carry the item, e.g. `{ type: "added", id, item: { kind, name } }`. When it
 * does, collection records it immediately; otherwise `sync()` (pull from
 * food.getSnapshot) is the authoritative path.
 *
 * @typedef {import("../detector/ports.js").FoodPort} FoodPort
 * @typedef {import("../repair/ports.js").TransactionPort} TransactionPort
 * @typedef {import("../repair/ports.js").GameStoragePort} GameStoragePort
 * @typedef {import("../repair/ports.js").ClockPort} ClockPort
 *
 * @typedef {Object} CollectionDeps
 * @property {FoodPort} food
 * @property {GameStoragePort} gameStorage
 * @property {ClockPort} [clock]            used only to timestamp discoveries
 * @property {TransactionPort} [transaction] required only to claim set rewards
 */

export {};
