# Interface Checklist

Registry of cross-module interfaces for the Frigo single-player game (`app/`).
Maintained jointly by Developer **A** (food / economy / infrastructure) and
Developer **B** (game / progression). See [COLLABORATION.md](./COLLABORATION.md)
for the working rules and [`AGENTS.md`](../../AGENTS.md) for the AI-agent workflow.

## Status lifecycle

`Proposed` → `Agreed` → `Implemented` → `Tested`

- **Proposed** — name and shape are a draft from one side; nothing is fixed.
- **Agreed** — both developers have confirmed the signature and error format.
- **Implemented** — the owner has shipped it behind this agreed signature.
- **Tested** — covered by tests and verified by the consumer.

> ⚠️ **Nothing below is locked yet.** The function names are the *current
> proposal* only. Parameters, return types, and error formats have **not** been
> confirmed by both sides — do not assume any signature is final. Only an entry
> marked `Agreed` (or later) may be depended on, and from that point it must
> stay backward-compatible (see COLLABORATION.md).

## Ownership at a glance

| Interface | Owner | Used By | Status |
|---|---|---|---|
| `wallet.getBalance()` | A | B (game) | Proposed |
| `transaction.execute()` | A | B (game) | Proposed |
| `gameStorage.load()` | A | B (game) | Proposed |
| `gameStorage.save()` | A | B (game) | Proposed |
| `clock.getLocalDate()` | A | B (game) | Proposed |
| `food.getSnapshot()` | A | B (game) | Proposed |
| `food.subscribeEvents()` | A | B (game) | Proposed |

---

## `wallet.getBalance()`

| Field | Value |
|---|---|
| Interface Name | `wallet.getBalance()` |
| Owner | A |
| Used By | B (game) |
| Purpose | Read the player's current wallet balance — to display funds and gate purchases / repairs. |
| Parameters | *(proposed)* none |
| Return Type | *(proposed)* `number` — balance in currency units |
| Error Format | *(TBD — to be agreed)* |
| Status | Proposed |
| Last Updated | 2026-11-05 |

## `transaction.execute()`

| Field | Value |
|---|---|
| Interface Name | `transaction.execute()` |
| Owner | A |
| Used By | B (game) |
| Purpose | Execute a wallet transaction (debit or credit) atomically and update the balance. |
| Parameters | *(proposed)* `{ amount: number, kind: "debit" \| "credit", reason?: string }` |
| Return Type | *(proposed)* `{ ok: boolean, balance: number }` |
| Error Format | *(TBD — to be agreed; e.g. insufficient funds)* |
| Status | Proposed |
| Last Updated | 2026-11-05 |

## `gameStorage.load()`

| Field | Value |
|---|---|
| Interface Name | `gameStorage.load()` |
| Owner | A |
| Used By | B (game) |
| Purpose | Load persisted game / progression state for the current player. |
| Parameters | *(proposed)* `(key?: string)` |
| Return Type | *(proposed)* saved state object, or `null` when nothing is stored |
| Error Format | *(TBD — to be agreed)* |
| Status | Proposed |
| Last Updated | 2026-11-05 |

## `gameStorage.save()`

| Field | Value |
|---|---|
| Interface Name | `gameStorage.save()` |
| Owner | A |
| Used By | B (game) |
| Purpose | Persist game / progression state for the current player. |
| Parameters | *(proposed)* `(state: object)` — or `(key: string, value: unknown)` |
| Return Type | *(proposed)* `boolean` / `void` |
| Error Format | *(TBD — to be agreed; e.g. storage quota exceeded)* |
| Status | Proposed |
| Last Updated | 2026-11-05 |

## `clock.getLocalDate()`

| Field | Value |
|---|---|
| Interface Name | `clock.getLocalDate()` |
| Owner | A |
| Used By | B (game) |
| Purpose | Get the current local date for daily / time-gated progression (letters, voyages, detectors). |
| Parameters | *(proposed)* none |
| Return Type | *(proposed)* `Date`, or an ISO `YYYY-MM-DD` string |
| Error Format | *(TBD — to be agreed)* |
| Status | Proposed |
| Last Updated | 2026-11-05 |

## `food.getSnapshot()`

| Field | Value |
|---|---|
| Interface Name | `food.getSnapshot()` |
| Owner | A |
| Used By | B (game) |
| Purpose | Get a point-in-time snapshot of the current food state (inventory / freshness). |
| Parameters | *(proposed)* none |
| Return Type | *(proposed)* food-state object |
| Error Format | *(TBD — to be agreed)* |
| Status | Proposed |
| Last Updated | 2026-11-05 |

## `food.subscribeEvents()`

| Field | Value |
|---|---|
| Interface Name | `food.subscribeEvents()` |
| Owner | A |
| Used By | B (game) |
| Purpose | Subscribe to food-domain events (added, removed, spoiled, …) so the game can react. |
| Parameters | *(proposed)* `(callback: (event) => void)` |
| Return Type | *(proposed)* `unsubscribe: () => void` |
| Error Format | *(TBD — to be agreed)* |
| Status | Proposed |
| Last Updated | 2026-11-05 |

---

## How to add or change an entry

1. Whoever first needs an interface adds a row here with status **Proposed** and
   fills in every field (use *TBD* where it is genuinely open).
2. The two developers discuss; once both confirm, set the status to **Agreed**
   and update *Last Updated*.
3. The owner implements it, then marks **Implemented**; once tested by the
   consumer, mark **Tested**.
4. An `Agreed`/`Implemented`/`Tested` interface must not be renamed, removed, or
   changed incompatibly without re-agreeing first.

## Day 1 clarification and validation (2026-11-06)

- All seven interfaces remain **Proposed**. Suggested signatures above are discussion examples only, not agreed contracts. Parentheses in a function name do not establish that it takes no arguments. Synchronous/asynchronous behavior is also pending agreement.
- Before moving to Agreed, record the owner and consumer confirmations, date, and PR/discussion link. Before moving to Implemented or Tested, record the implementation path and relevant test command/results.
- Existing website code was searched for these interfaces and equivalent responsibilities. Its internal `save()` only persists `frigoFridgeTune` presentation settings; it is not the proposed game storage service.
- Day 1 adds documentation and tracked empty directories only. No game implementation or executable game test suite is introduced. Website files and assets remain unchanged from the main baseline.
