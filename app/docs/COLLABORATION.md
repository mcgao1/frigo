# Collaboration Rules

How Developer **A** and Developer **B** work together on the Frigo single-player
game under `app/`. The existing website prototype (`index.html`, `assets/`,
`网页素材/`) is **not** part of this and must be left untouched.

## Ownership

| Area | Owner | Path(s) |
|---|---|---|
| Food | A | `app/src/food/` |
| Economy | A | `app/src/economy/` |
| Infrastructure | A | `app/src/infrastructure/` |
| Game / progression | B | `app/src/game/` (repair, detector, voyage, exploration, collection, story, letters) |
| Contracts | A + B (shared) | `app/src/contracts/` |
| Config | A + B (shared) | `app/src/config/` |
| Integration tests | A + B (shared) | — |

- **A owns** food, economy, and infrastructure.
- **B owns** game.
- **`contracts`, `config`, and integration tests are maintained jointly** — change
  them by agreement, not unilaterally.

## Before you build

- **Search first.** Before writing anything, search the repo for existing
  interfaces and functions that already do what you need.
- **Reuse over re-implement.** Prefer an existing function to a new one; do not
  duplicate logic that already exists elsewhere.

## Interfaces (cross-module contracts)

- Whoever first needs a new cross-module interface **proposes and registers it
  first** in [`INTERFACE_CHECKLIST.md`](./INTERFACE_CHECKLIST.md) with status
  `Proposed`.
- An interface is **official only after both developers confirm it** (status
  `Agreed`). Until then, names, parameters, return types, and error formats are
  drafts — do not assume they are locked.
- A confirmed interface (`Agreed` / `Implemented` / `Tested`) **stays
  backward-compatible by default**. Do not modify, delete, or rename it on your
  own.
- If a confirmed interface genuinely must change, **state the reason and get the
  other developer's confirmation first**, then update the checklist.

## Module boundaries

- **Do not modify the other developer's modules.** B does not edit
  `food` / `economy` / `infrastructure`; A does not edit `game`.
- Any change that reaches into the other side's area must be **explained and
  confirmed before it is made**.

## Per-module routine

Each time a module is finished (or meaningfully changed):

1. Run the relevant tests.
2. Update [`INTERFACE_CHECKLIST.md`](./INTERFACE_CHECKLIST.md) (statuses, fields,
   *Last Updated*).

## Merging

- Merge into `main` **through a Pull Request**.
- **Never push feature code directly to `main`.**

## AI agents

- An AI agent must **not auto-"fix" unrelated code**. It stays within the task
  and the owner's area. See [`AGENTS.md`](../../AGENTS.md) for the full agent
  workflow.
