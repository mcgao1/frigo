/**
 * Ports the detector module depends on — cross-module interfaces owned by
 * Developer A. Detector (Developer B) depends only on these abstractions and
 * never imports A's modules. All are registered `Proposed` in
 * app/docs/INTERFACE_CHECKLIST.md, so the shapes below are assumptions, not
 * locked contracts. Every call is awaited, so A may implement sync or async.
 *
 * Assumed food-snapshot shape (food.getSnapshot is Proposed, "food-state
 * object"): `{ items: Array<FoodItem> }`.
 * @typedef {Object} FoodItem
 * @property {string} id
 * @property {string} [name]
 * @property {number} [freshness]  0..1, 1 = perfectly fresh (optional)
 * @property {string} [spoilsOn]   ISO `YYYY-MM-DD` the item spoils (optional)
 *
 * @typedef {Object} FoodEvent
 * @property {"added" | "removed" | "spoiled" | string} type
 * @property {string} [id]
 *
 * @typedef {Object} FoodPort
 * @property {() => ({ items?: FoodItem[] } | Promise<{ items?: FoodItem[] }>)} getSnapshot
 *   `food.getSnapshot()`
 * @property {(cb: (event: FoodEvent) => void) => (() => void)} [subscribeEvents]
 *   `food.subscribeEvents()` — returns an unsubscribe function.
 *
 * @typedef {import("../repair/ports.js").WalletPort} WalletPort
 * @typedef {import("../repair/ports.js").TransactionPort} TransactionPort
 * @typedef {import("../repair/ports.js").GameStoragePort} GameStoragePort
 * @typedef {import("../repair/ports.js").ClockPort} ClockPort
 *
 * @typedef {Object} DetectorDeps
 * @property {FoodPort} food
 * @property {GameStoragePort} gameStorage
 * @property {ClockPort} [clock]
 * @property {WalletPort} [wallet]            required only to upgrade
 * @property {TransactionPort} [transaction]  required only to upgrade
 */

export {};
