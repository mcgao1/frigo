# V1 Playground Gap Audit

**Date:** 2026-11-17 · **Author:** Developer B (game / progression) · **Scope:** review-only — **no business module changed**
**Commissioned by:** the 2026-11-17 play-test feedback. Phase 4A (sandbox persistence) is complete + checkpointed; this audit precedes any V1 rule change and the Phase 4B 7-day economy sim.

---

## 0. TL;DR (中文速览)

- **Playground = 开发沙盒，不是 V1 经济。** 它用的是 Mock：300 起始 GP、UI 里写 "coins"、随手可点的 raise-a-flag 调试按钮、以及**旧占位内容**（Landlord/Grandma/Guild 信、4 个旧 Story 章节、Collection 收藏集奖励）。
- **目前真实的 V1 GP 规则只有 income**：首开 +5/天、记录批次 +4（≤3/天）、吃完一种食物 +3（≤3/天）；主线支出 = 冰箱 30 + 探测器 10 + 航行 15 = **55**。
- **会污染「0-GP 七天模拟」的旧 GP 来源 = 3 个模块、最多约 +400 GP**：Collection(+100/+50)、Letters 礼物(+50/+30)、Story 章节(+20/+50/+100)。**好消息：这三个模块都已支持构造期配置覆盖**，所以「隔离旧奖励」= 给七天模拟传一套 **"V1 经济档案"** 配置即可，**无需改任何业务模块源码**（Collection/Story/Letters 的模块与数据结构完整保留）。
- **两个真缺口需要新功能**：① 挖掘层每日 2 次成功付费挖掘上限（Exploration 现在没有任何每日上限）；② 免费无限的 Check Freezer 只读库存视图（现在没有，且依赖 A 的 Food/Inventory 接口）。
- **其余是规划/占位问题**：Communicator、动态 displayName、Unknown Sender 随机任务 —— 本轮只登记，不实现。

---

## 1. Currency: GP vs "Coins", and the 300 starting balance

| Dimension | Finding |
|---|---|
| **Current real behavior** | Internally there is ONE currency, moved only through A's `transaction.execute({kind:"credit"\|"debit"})`. The income module is literally "GreenPoints (GP)". No business module stores or names "coins". **A 0-GP start is already supported** by the sandbox backend (`createSandboxBackend` default `startBalance: 0`). First valid open = `income:daily` +5 (correct). |
| **Legacy / Mock / Debug** | The word **"coins"** and the **300 start** exist ONLY in `playground.html` (UI labels + `startBalance: 300`). Pure dev scaffolding. |
| **Divergence from V1** | Label mismatch (coins → GP) in the sandbox UI; 300 is debug money, not an economy rule. |
| **Minimal change** | (a) Phase 4B: construct the sandbox with `startBalance: 0` — **already supported, no code change**. (b) Optional: relabel "coins" → "GP" in `playground.html` (untracked sandbox UI only; not a business change). |
| **A interface dependency** | None (GP rides A's wallet/transaction ports, already in INTERFACE_CHECKLIST). |
| **Dev order & test** | Trivial, first. Covered by existing income tests + a "from-0 start" assertion in the 4B sim. |

---

## 2. Legacy GP reward sources — the 7-day-sim blockers (feedback #2)

### Every GP movement in the codebase (ground truth)

| Reason (ledger) | Module | Amount | Kind | V1 status | Action before the 0-GP sim |
|---|---|---|---|---|---|
| `income:daily` | income | **+5** / local day | credit | ✅ REAL V1 | keep |
| `income:entry` | income | **+4**, ≤3/day | credit | ✅ REAL V1 | keep |
| `income:consume:<type>` | income | **+3**, ≤3/day | credit | ✅ REAL V1 | keep |
| `explore:loot:gp` | exploration | **+3 / +6 / +12** (loot tier on a paid −5 dig) | credit | ⚠️ real mechanic, tied to the dig economy | keep — but rides on item 3's daily cap |
| `collection:set:dairy` | collection | **+100** | credit | ❌ LEGACY balance | isolate → reward 0 in V1 profile |
| `collection:set:greens` | collection | **+50** | credit | ❌ LEGACY balance | isolate → reward 0 |
| `letters:gift:grandma` | letters | **+50** | credit | ❌ LEGACY placeholder letter | isolate → exclude / gift 0 |
| `letters:gift:guild` | letters | **+30** | credit | ❌ LEGACY placeholder letter | isolate → exclude / gift 0 |
| `story:reward:ch2` ("First repairs") | story | **+20** | credit | ❌ LEGACY/unconfirmed | isolate → reward 0 |
| `story:reward:ch3` ("Set sail") | story | **+50** | credit | ❌ LEGACY/unconfirmed | isolate → reward 0 |
| `story:reward:ch4` ("The full pantry") | story | **+100** | credit | ❌ LEGACY/unconfirmed | isolate → reward 0 |
| `fragment:buy:<id>` | repair | −5 ×6 = **−30** | debit | ✅ REAL | keep |
| `detector:repair` | detector | **−10** | debit | ✅ REAL | keep |
| `voyage:depart:<planet>` | voyage | **−15** | debit | ✅ REAL | keep |
| `explore:dig` | exploration | **−5** | debit | ✅ REAL | keep (capped — item 3) |

**Max legacy injection:** Collection 150 + Letters 80 + Story 170 = **~400 GP** — ~7× the 55 GP mainline. Any of it entering a 0-GP balance test invalidates it.

| Dimension | Finding |
|---|---|
| **Minimal change (no module source touched)** | All three legacy-reward modules already take a construction-time override: `createCollectionModule(deps, { sets })`, `createLettersModule(deps, { letters })`, `createStoryModule(deps, { chapters })`. Define a **"V1 economy profile"** once (collection sets `reward:0`; a V1 letter set that excludes the placeholder Landlord/Grandma/Guild or sets `gift:0`; chapters `reward:0`) and inject it in the Phase 4B sim harness. Module logic + data structures are preserved exactly (satisfies #2/#5/#6: keep, don't delete). |
| **A interface dependency** | None for isolation. |
| **Dev order & test** | FIRST step of Phase 4B setup. Test: a from-0 run credits only `income:*` (+ `explore:loot:gp` if digging); assert total `collection:* / letters:gift:* / story:reward:*` credits == 0. |

---

## 3. Digging Layer — daily cap of 2 successful paid digs (feedback #3)

| Dimension | Finding |
|---|---|
| **Current real behavior** | `exploration.dig()` debits `DIG_COST` (5 GP) and rolls the LOCKED loot table. `options` already supports `cost / loot / recipes / tips / junk / random / storageKey`. Persisted state = total digs + found recipes/tips. |
| **Legacy / Mock / Debug** | None — the mechanic is real. |
| **Divergence from V1** | **No daily cap exists** — a player can dig unlimited times/day (funds permitting). V1 wants **≤2 successful paid digs per local day, midnight reset, count surviving refresh/re-init.** |
| **Minimal change** | Add to exploration state a `{ digDay, digsToday }` pair (the same `rollDay` pattern income already uses). In `dig()`, after resolving the local day: if `digsToday >= maxDigsPerDay` (new `options.maxDigsPerDay`, default **2**) return `{ credited:false, reason:"DAILY_DIG_CAP" }` **before** the debit; else debit → roll → `digsToday++` → persist. ~15 lines in `exploration.js`; no other module affected. |
| **Independence guarantee (required)** | The 3 free fridge-side detector digs live entirely in `detector.js` (`dig()` → no wallet, no exploration call — proven by the mainline "Detector ⊥ Exploration" test). The cap applies ONLY to `exploration.dig()`; detector digs stay uncapped. ✅ already structurally separate. |
| **A interface dependency** | None (uses B's clock for the local day + midnight reset). |
| **Dev order & test** | After item 2. Tests: 2 digs ok → 3rd capped (no debit); cap resets next local day; `digsToday` persists across reload; detector digs unaffected while exploration is capped. |

---

## 4. Check Freezer — free, unlimited, read-only inventory (feedback #4)

| Dimension | Finding |
|---|---|
| **Current real behavior** | The only way to "see" fridge contents is `detector.scan()` — which **requires a repaired detector** and returns freshness readings, not a plain inventory. `food.getSnapshot()` (A's port) returns items `{id, name, kind, freshness, spoilsOn}`. |
| **Legacy / Mock / Debug** | Playground food = a 5-item mock; no photo / location fields. |
| **Divergence from V1** | **No free, unlimited, detector-independent "Check Freezer" view exists.** V1 wants: a plain inventory list, tap item → detail, show the user's **original uploaded photo** if present; **no GP, no random drops, no effect on the daily dig count.** |
| **Minimal change (B side)** | A thin read-only `freezer` view module that calls A's inventory port and renders list + detail, with **zero economy hooks**. Do NOT build against faked production data. |
| **A interface dependency (Proposed — add to INTERFACE_CHECKLIST)** | `food.getSnapshot()` lacks the V1 fields: **`location`** (freezer compartment), rich **`itemDetail`**, **`photoRef`** (original-photo URI + uploader/time). Register as **Proposed**; B will not invent production inventory. |
| **Dev order & test** | Spec + Proposed interface now; implement after A confirms. Test: view costs 0 GP, triggers 0 loot, leaves `digsToday` unchanged. |

---

## 5. Letters → Communicator; which letters are V1 (feedback #5)

| Dimension | Finding |
|---|---|
| **Current real behavior** | `letters` delivers by date and/or flags, persists delivered/read/claimed, supports a one-time GP gift. Mechanism is sound and reusable. |
| **Letter inventory** | **LEGACY placeholder:** `welcome` (Landlord, gift 0), `grandma` (gift **50**), `guild` (gift **30**). **CONFIRMED V1:** `fri-detector-clue`, `fri-frostpeak-clue` (Fri, gift 0, flag-gated, user-authored). |
| **Divergence from V1** | V1 routes Fri through a **Communicator** (story messages + special letters + **preset reply options, no free text**). The module has delivery/archive but no Communicator surface or reply options; placeholder letters are currently indistinguishable from canon. |
| **Minimal change** | (a) Add a data-only `track: "v1" \| "legacy"` tag per letter so the sim/app can filter (keep legacy data — don't delete). (b) Keep the Fri copy verbatim (only the salutation is dynamic — item 7). (c) Communicator = a later presentation layer **on top of** the existing letters/trigger mechanism (no delivery rewrite); preset-reply options = a new data field (future). |
| **A interface dependency** | None now (Communicator is B-side; may later surface A inventory/photo via item 4). |
| **Dev order & test** | Tag now (cheap, data-only); Communicator UI is post-4B. Test: legacy letters excluded from the V1 letter set; Fri letters still deliver flag-gated + giftless. |

---

## 6. Story chapters & the raise-a-flag buttons (feedback #6)

| Dimension | Finding |
|---|---|
| **Current real behavior** | 4 chapters, flag-unlocked; each may credit a one-time GP reward on unlock (`story:reward:*`). |
| **Chapter inventory** | ch1 "A cold awakening" — no requires, reward **0** (starts unlocked). ch2 "First repairs" — `repair:any`, reward **20**. ch3 "Set sail" — `voyage:complete`, reward **50**. ch4 "The full pantry" — `collection:dairy`+`collection:greens`, reward **100**. **All LEGACY/unconfirmed** — predate the Fri mainline; none references Fri. |
| **Legacy / Mock / Debug** | The playground's **raise-a-flag buttons are always visible** — these are DEBUG controls. |
| **Divergence from V1** | (a) legacy chapter GP (170 total) not isolated; (b) chapters not reconciled with the Fri mainline; (c) debug flag buttons shown outside Debug. |
| **Minimal change** | (a) Sim injects `chapters` with `reward:0` (item 2). (b) Gate the raise-a-flag UI behind the playground's `?debug` (playground-only tweak). (c) Keep chapter data; mark each `track: legacy` pending a V1 story pass. |
| **A interface dependency** | None. |
| **Dev order & test** | Reward-zero in the V1 profile (item 2); debug-gate = playground tweak; canon reconciliation = separate design task. |

---

## 7. Dynamic displayName — unified fallback (feedback #7)

| Dimension | Finding |
|---|---|
| **Current real behavior** | None — Fri's letters hardcode "human" / "Hey, human." in their body text. |
| **Divergence from V1** | V1 wants: username if set, else `human`; applied uniformly, not hardcoded per message. |
| **Minimal change** | One `displayName(user)` helper (`user?.name?.trim() || "human"`) + a template token (e.g. `{name}`) the letters/Communicator layer substitutes at render time. Store the 2 Fri letters with `{name}` at the salutation instead of literal "human". One helper, no per-letter logic. |
| **A interface dependency** | Needs a `user.displayName` source (profile) — likely app/A profile; mark **Proposed** if unavailable. |
| **Dev order & test** | Small; do alongside Communicator tagging. Test: with/without a username → correct salutation; no other copy changes. |

---

## 8. Unknown Sender random missions — register only (feedback #8)

| Dimension | Finding |
|---|---|
| **Current real behavior** | Not implemented. |
| **Divergence from V1** | A separate system (NOT Fri mainline): 0–2 optional tasks/week, accept/reject, accepted → finish within 24h → **+5 GP**, later surfaced in the Communicator. |
| **Minimal change** | None this round — register the gap. When built, deps: clock (weekly window + 24h timer), transaction (+5 GP on completion), gameStorage (offer/accept/deadline state), a task-verification signal (likely A food events). Must stay independent of Fri letters. |
| **A interface dependency** | Future — completion likely keys off A food/inventory events; mark Proposed when designed. |
| **Dev order & test** | After the V1 mainline economy is validated; out of current scope. |

---

## 9. Recommended build order & test strategy

1. **Isolate legacy rewards (item 2)** via a V1 economy profile (config-only, no module source change) — unblocks everything. *Test:* from-0 run credits only `income:*` (+ optional dig loot); legacy credits == 0.
2. **Phase 4B 7-day economy sim** from **0 GP** on that profile (separate, gated on #1).
3. **Exploration daily dig cap (item 3)** — small module feature + tests; re-assert detector independence.
4. **Check Freezer spec + Proposed A interface (item 4)** — spec now, build after A confirms `location` / `itemDetail` / `photoRef`.
5. **Letters/Story `track` tag + debug-gate the flag buttons (items 5/6)** — data-only + playground tweak.
6. **displayName helper (item 7)** — small, alongside Communicator tagging.
7. **Communicator surface (item 5)** and **Unknown Sender (item 8)** — later, post-4B.

All B-side. A dependencies (items 4, 7, 8) go through `INTERFACE_CHECKLIST.md` as **Proposed**, never faked. No business module is modified by this audit.
