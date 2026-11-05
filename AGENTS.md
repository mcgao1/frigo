# AGENTS.md

Rules for any AI agent working in this repository.

This repo has two parts:

1. **The website prototype** — `index.html`, `assets/`, `网页素材/` at the repo
   root. This is the existing, self-contained homepage prototype (served on
   GitHub Pages). **Leave it untouched** unless a task explicitly targets it.
2. **The single-player game** — everything under `app/`. Two developers share it:
   - **Developer A** owns `app/src/food/`, `app/src/economy/`,
     `app/src/infrastructure/`.
   - **Developer B** owns `app/src/game/` (repair, detector, voyage,
     exploration, collection, story, letters).
   - `app/src/contracts/`, `app/src/config/`, and integration tests are shared.

Authoritative references — read them before doing anything:
[`app/docs/INTERFACE_CHECKLIST.md`](app/docs/INTERFACE_CHECKLIST.md) and
[`app/docs/COLLABORATION.md`](app/docs/COLLABORATION.md).

## Before development — every time

1. **Read the contracts and rules.** Read `app/docs/INTERFACE_CHECKLIST.md` and
   `app/docs/COLLABORATION.md` first.
2. **Check for existing work.** Search the repo for an existing implementation
   with the same name, the same functionality, or one that would conflict with
   what you are about to write. Reuse it instead of duplicating.
3. **Check cross-module needs.** Decide whether the task needs a new cross-module
   interface. If it does, register it in `INTERFACE_CHECKLIST.md` as `Proposed`
   first — do not just start calling an unregistered interface.

## While developing

4. **Do not change confirmed interfaces.** Never modify, rename, or remove an
   interface marked `Agreed` / `Implemented` / `Tested`. If one truly must
   change, stop and get both developers to re-agree first.
5. **Stay in your owner's area.** Do not modify another developer's modules
   (B does not touch `food` / `economy` / `infrastructure`; A does not touch
   `game`). Do not auto-"fix" unrelated code — stay within the task's scope.
6. **Run the relevant tests** for the code you changed.

## After development — report

7. Report back, explicitly:
   - **New interfaces** proposed or registered.
   - **Files modified** (and why).
   - **Search / de-duplication results** — what you checked for existing work and
     what you found.
   - **Test results.**

## Merging

Changes reach `main` **only through a Pull Request** — never push feature code
directly to `main`.
