/**
 * Ports the story module depends on — cross-module interfaces owned by
 * Developer A. Story (Developer B) depends only on these abstractions and never
 * imports A's modules. All are registered `Proposed` in
 * app/docs/INTERFACE_CHECKLIST.md. Every call is awaited (A may be sync or async).
 *
 * Reuses the repair module's gameStorage / clock / transaction port shapes — no
 * story-specific A interface is needed. Note: story is driven mostly by in-game
 * progress flags (triggered by other B modules), which are NOT cross-module A
 * interfaces — they are plain internal calls within the game domain.
 *
 * @typedef {import("../repair/ports.js").GameStoragePort} GameStoragePort
 * @typedef {import("../repair/ports.js").ClockPort} ClockPort
 * @typedef {import("../repair/ports.js").TransactionPort} TransactionPort
 *
 * @typedef {Object} StoryDeps
 * @property {GameStoragePort} gameStorage
 * @property {ClockPort} [clock]            used only to timestamp chapter unlocks
 * @property {TransactionPort} [transaction] used only to grant chapter rewards (best-effort)
 */

export {};
