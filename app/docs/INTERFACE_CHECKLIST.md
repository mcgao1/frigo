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
| `infrastructure.applyRepair()` | A | B (game / repair) | Proposed |
| `food.batchAdded` (event) | A | B (game / income) | Proposed |
| `food.batchFullyConsumed` (event) | A | B (game / income) | Proposed |
| `food.batchDiscarded` (event / `cause`) | A | B (game / income) | Proposed |
| `foodTypeId` (field) | A | B (game) | Proposed |
| `batchId` (field) | A | B (game) | Proposed |

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

## `infrastructure.applyRepair()`

| Field | Value |
|---|---|
| Interface Name | `infrastructure.applyRepair()` |
| Owner | A |
| Used By | B (game / repair) |
| Purpose | Notify infrastructure that a fridge component has been repaired, so the fridge's operational / cooling state is updated. Repair (B) handles the economy + progression side; the actual effect on cooling belongs to infrastructure (A). |
| Parameters | *(proposed)* `({ component: string, level?: number })` — the repaired component id, optionally a new condition level |
| Return Type | *(proposed)* `{ ok: boolean }` / `void` |
| Error Format | *(TBD — to be agreed; e.g. unknown component)* |
| Status | Proposed |
| Last Updated | 2026-11-06 |

> Proposed by B (repair module) on 2026-11-06. The repair module currently calls
> this best-effort (ignores failures) so it is not yet a hard dependency. Needs
> A's confirmation before it can be relied on (move to `Agreed`).

## `food.batchAdded` (event)

| Field | Value |
|---|---|
| Interface Name | `food.batchAdded` — a food-domain event (delivered via `food.subscribeEvents`) |
| Owner | A |
| Used By | B (game / income — entry reward) |
| Purpose | Fire once when the player logs a **genuinely new** inventory batch, so income credits +4 GP (≤3/day, once per batch). |
| Parameters | *(proposed)* payload `{ batchId: string, foodTypeId: string, localDate: "YYYY-MM-DD" }` |
| Return Type | *(proposed)* n/a (event) |
| Error Format | *(TBD — to be agreed)* |
| Status | Proposed |
| Last Updated | 2026-11-17 |

> Must fire only for a real new batch — **not** for an edit or a delete-and-re-log
> of an existing one (see `batchId` and `food.batchDiscarded`). B dedups by
> `batchId`, so correctness depends on A keeping that id stable.

## `food.batchFullyConsumed` (event)

| Field | Value |
|---|---|
| Interface Name | `food.batchFullyConsumed` — a food-domain event |
| Owner | A |
| Used By | B (game / income — consume reward, Phase 2B) |
| Purpose | Fire once when an inventory record is **fully** consumed, so income credits +3 GP (per `foodTypeId` + `localDate`, ≤3 types/day). |
| Parameters | *(proposed)* payload `{ batchId: string, foodTypeId: string, localDate: "YYYY-MM-DD" }` |
| Return Type | *(proposed)* n/a (event) |
| Error Format | *(TBD — to be agreed)* |
| Status | Proposed |
| Last Updated | 2026-11-17 |

> **Partial** consumption and **discard / spoilage must not** fire this — only a
> full consume of the record earns GP.
>
> **Reward exclusions (partial / delete / discard / expiry) — Pending A/B
> Integration, NOT verified.** "These earn no GP" holds in B *only because B has
> no entrypoint for them*: the app routes solely `batchFullyConsumed` into
> `recordConsume`, so B can neither reward nor unit-test them. B's passing tests
> are therefore **not** evidence that real-inventory integration is correct — the
> guarantee rests entirely on A firing `batchFullyConsumed` for a **true full
> consume only**, and routing partial / delete / discard / expiry elsewhere (see
> `food.batchDiscarded`). Must be confirmed by an A+B integration test with A's
> real inventory before it can be called done.

## `food.batchDiscarded` (event / `cause` field)

| Field | Value |
|---|---|
| Interface Name | `food.batchDiscarded` (or a `cause` field on a removal event) |
| Owner | A |
| Used By | B (game / income) |
| Purpose | Let B tell "eaten" from "thrown away / deleted / expired" so waste earns no GP. |
| Parameters | *(proposed)* either a distinct event `{ batchId, foodTypeId, localDate, reason }`, or `cause: "consumed" \| "discarded" \| "expired"` on the removal event |
| Return Type | *(proposed)* n/a (event) |
| Error Format | *(TBD — to be agreed)* |
| Status | Proposed |
| Last Updated | 2026-11-17 |

## `foodTypeId` (field)

| Field | Value |
|---|---|
| Interface Name | `foodTypeId` — a field on `food.getSnapshot()` items and on batch events |
| Owner | A |
| Used By | B (game / income) |
| Purpose | A **stable** species identifier, so consume dedup is by real type — never a user-typed name string. |
| Parameters | *(proposed)* `string`, stable for the life of a food kind |
| Return Type | *(proposed)* n/a (field) |
| Error Format | *(TBD — to be agreed)* |
| Status | Proposed |
| Last Updated | 2026-11-17 |

## `batchId` (field)

| Field | Value |
|---|---|
| Interface Name | `batchId` — a field on `food.getSnapshot()` items and on batch events |
| Owner | A |
| Used By | B (game / income) |
| Purpose | A **stable** per-batch identifier for entry dedup + consume tracking / idempotency. |
| Parameters | *(proposed)* `string`; an edit reuses the same id, and a delete + re-add must not masquerade as a new rewardable batch |
| Return Type | *(proposed)* n/a (field) |
| Error Format | *(TBD — to be agreed)* |
| Status | Proposed |
| Last Updated | 2026-11-17 |

> Proposed by B on 2026-11-17 (Phase 0 review / Phase 2A). None are `Agreed`; A
> must confirm shape and semantics before B can rely on any of them.

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

## Cross-module risks (high priority)

Recorded 2026-11-17 (Phase 0 review, confirmed Phase 2A). **Not yet mitigated — to resolve with A.**

1. **Non-atomic debit / reward / save.** Game modules settle one player action as
   separate awaited calls — `transaction.execute` (debit and/or credit) then
   `gameStorage.save` — with no atomic wrapper. If the save (or a second credit)
   fails *after* a debit lands, GP is spent but the result is unrecorded /
   uncredited (a lost-action window). Affects every spend+persist flow
   (exploration dig, repair buy, detector repair, voyage depart, income credits).
   Closing it needs A's **atomic write** (or an outbox / transaction id). Do not
   fake atomicity with two independent writes.

2. **Duplicate-submission idempotency.** The same user action delivered twice
   (double tap, retried event) is guarded only per module / per in-process call;
   there is no shared request / idempotency key at the transaction layer. Current
   tests prove *per-call* exactly-once settlement — they do **not** prove
   cross-delivery idempotency, so this is **not** considered solved. Income's
   entry path now dedups by `batchId`; spend actions (dig, buy, depart) rely on
   the wallet rejecting an over-spend. Needs an A-side **idempotency key** on
   `transaction.execute`.

3. **Event-date vs reward-date mismatch.** Income buckets the daily entry cap by
   B's own clock (`clock.getLocalDate()` at the moment the event is processed),
   **not** by the event's own date. If A stamps `food.batchAdded` with a
   `localDate` that differs from B's processing day — an event created at 23:59
   but handled after midnight, an offline-queued event replayed the next day, or
   A and B resolving "local date" in different timezones — a +4 can land in the
   wrong day's cap (or a 4th same-day batch slips through as "tomorrow").
   **Interface need:** `food.batchAdded` (and `batchFullyConsumed`) must carry an
   authoritative `localDate`; A and B must share **one** clock / timezone
   definition; and B should bucket the daily cap by the **event's** `localDate`,
   not wall-clock at processing. Not changed this round (needs a `recordEntry`
   signature/decision) — recorded for A coordination. Priority: medium-high.
