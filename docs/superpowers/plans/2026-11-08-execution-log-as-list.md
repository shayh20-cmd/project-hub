# Execution Log as a Task List — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the execution log's own item model (`doc.execItems`, ball panel, rounds) with planning-style tasks — inline cells, an updates column whose latest assignee is "who has the ball", the same side panel — while keeping the schedule, the dashboard and the type split.

**Architecture:** Execution items become tasks in one sheet `{type:'execlog', track:'execution'}` per project. `ExecutionView` keeps its schedule/counters/ball bar and hosts `ListView` the way `DrawSetView` does (own `ListsCtx`, `ExtraCellsCtx`, `SectionBadgeCtx`, `projectFields`). Because every task collector filters `type==='list'`, the log is invisible outside the execution screens; trial users get it added explicitly where wanted. A pure `execMigrateDoc(doc)` in the `exec-logic` block converts old documents wherever a document is read (page `migrateData`, `mcp.js`).

**Tech Stack:** single-file React (compiled `React.createElement`, no build), Node `node:test`, `tools/local-server/mcp.js` (loads the page's `exec-logic` block).

**Spec:** `docs/superpowers/specs/2026-11-08-execution-log-as-list-design.md` (Hebrew; its "החלטות שקיבלתי" section is binding).

## Global Constraints

- Work on a new branch `feat/exec-log-as-list` cut from `origin/master` (in a worktree); carry the spec and this plan into it and commit them in Task 1. Merge `origin/master` again before any deploy.
- Execution stays trial-only: `canSeeExec()` (page) / `canExec(me)` (`mcp.js`), list `EXEC_TRIAL_USERS`. Non-trial users must not see exec-log tasks anywhere.
- Types: `issue` (ISS), `rfi` (RFI), `submittal` (SUB), `general` (GEN). `change` is no longer a type; existing `CHG-xxx` numbers are kept on migrated tasks; the CHG counter is frozen.
- Numbers are official and never reused: `data.execSeq[type]` holds the highest number given.
- Ball candidates in exec updates: the project's disciplines (`projList(data,'disciplines')`, includes `PM`) plus `CONT` (קבלן). `ARCH` = the office ("הכדור אצלנו"). No supervisor.
- Update statuses = planning's `EV_STATUSES`, unchanged. Open/closed = `taskStatusEff(task)!=='C'` (an `approved` update closes, as in planning).
- Workdays = Sunday–Thursday (`execWorkdays`). Thresholds unchanged: `EXEC_RFI_LATE=7`, `EXEC_ISSUE_LATE=14`.
- Migration keeps every task id equal to the old item id (so `execRef.itemId`, `finishes[].submittalId/changeId`, Outlook `?exec=` links keep working), is idempotent, deterministic, and keeps the original array as `doc.execItemsLegacy`.
- Every new UI string: Hebrew in the page, English in `i18n-dict.js` (last `Object.assign` chunk); run `node tools/i18n-extract.js`. Logical CSS only.
- Page editing conventions: as in `docs/superpowers/plans/2026-10-11-meeting-summaries.md` → "Conventions for every task" (Node patch scripts with exact anchors asserted once, CRLF, syntax check prints `scripts 3`). Mirror tests in `tests/` updated with the code they mirror.
- Never edit real data while browser-testing; back up `data/project_hub_01.json` before the first page load of the migrated code (Task 3).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A migrated item whose consultant name matches no discipline (e.g. "קונסטרוקציה – אור פרקמן") — expect the ball on the item's discipline (or ARCH if none) and the name kept in the update note, never a dropped update. Test in Task 2.
- Two tabs open while the new page loads: both migrate the same doc — expect identical sheet/task ids so the three-way merge yields one log, not two. Test in Task 2 (run twice → deep-equal; run on output → unchanged).
- An item added by a stale (pre-deploy) tab to `doc.execItems` after migration — expect it folded into the existing log on next read, not lost and not duplicated. Test in Task 2.
- A non-trial user opens a project with an exec log: no exec tasks in My Tasks, home widgets, search, track stages, connector task tools. Test in Task 3 (`execlog` absent from collectors) and Task 7 (connector).
- A task with no updates: ball = none, waiting = 0, counted as open, not in "ball with us". Test in Task 1.

---

### Task 1: Task-model helpers in `exec-logic`

**Files:**
- Modify: `project_hub_01.html` (inside `/* ═══ exec-logic ═══ */ … /* ═══ /exec-logic ═══ */`)
- Test: `tests/exec-logic.test.js` (extend the `new Function(...)` return list)

**Interfaces:**
- Produces (all pure, global in the page, returned by the test loader and later by `mcp.js`):
  - `EXT_TYPES` = `{issue:{prefix:'ISS',label:'Issue'}, rfi:{prefix:'RFI',label:'RFI'}, submittal:{prefix:'SUB',label:'הגשה'}, general:{prefix:'GEN',label:'כללי'}}`
  - `EXEC_LOG_SHEET_ID = 'exlog'`; `execLogSheet(doc) -> sheet|null`; `execLogTasks(doc) -> task[]`
  - The block must stay self-contained (the test loader and `mcp.js` evaluate it alone), so it carries its own copies of the two event rules it needs: `exLatest(events)` = same ordering as `evCurrent`, `exCountStart(events, today)` = same as `evCountStart`. A test asserts they agree with the page's `evCurrent`/`evCountStart` on a shared fixture (extract those two functions from the page the same way).
  - `execTaskClosed(task) -> bool` — same rule as `taskStatusEff(task)==='C'`: `statusOverride ? statusId==='C' : latest update is 'approved' (or no updates and statusId==='C')`
  - `execNextNo(tasks, type, seqMap) -> {seq, no}` — `no` like `'RFI-007'`, per-type, max of seqMap and existing `exSeq`
  - `execNewTask(tasks, {type, title, discipline, ownerId, ballTo, dueDate, source}, seqMap, today) -> task` with fields `id, title, exType, exSeq, exNo, discipline, assigneeIds:[ownerId]|[], dueDate, createdAt, exSource, events:[first update: status 'progress', assignee ballTo||'ARCH', date today]`
  - `execBall(task) -> disciplineId|null` (latest update's `assignee` via `exLatest`; null when no updates or closed)
  - `execWaitingT(task, today) -> workdays` from `exCountStart(events, today).date`; 0 when no updates or closed
  - `execRound(task) -> number` (max `ev.round`, 0 if none)
  - `execCountsT(tasks, today) -> {rfiOpen, rfiLate, subPending, subRound3, issuesLate, mine, mineAvg}` — same meaning as today's `execCounts`, with `mine` = open tasks whose ball is `ARCH`, `subPending` = open submittals, `subRound3` = open submittals with `execRound>=3`, `issuesLate` = open issues with `execWorkdays(createdAt,today)>14`
  - `execBallSplitT(tasks) -> {ARCH, CONT, PM, consultants}` (open tasks only)
  - `execForMeT(tasks, staffId, iManage) -> task[]` (open, ball `ARCH`, assignee me, or nobody assigned and I manage)
  - `execSetChange(task, patch|null) -> task` (null removes the mark; patch fields `tenderSpec, tenderRef, proposed, approvedText, decision`, decision default `'requested'`)
  - `execDecideChangeT(task, {decision, notes, approvedText, name}, today) -> task` — decisions `requested | in_review | approved | approved_cond | rejected`; a final one (`approved`, `approved_cond`, `rejected`) appends an `approved` update (closes the task) with the decision in its title and notes in `note`; `requested` on a closed task (reopen) appends a `progress` update to `ARCH`

- [ ] **Step 1: Write failing tests** in `tests/exec-logic.test.js`:
  - `execNextNo` gives `RFI-001`, then `RFI-002`; `GEN-001` independent; respects `seqMap {rfi:9}` → `RFI-010`; ignores tasks whose `exNo` starts `CHG-`.
  - `execNewTask` → `exNo:'SUB-001'`, one update with assignee `'CONT'` when `ballTo:'CONT'`.
  - No-updates task: `execBall` null, `execWaitingT` 0, not closed, not in `execCountsT(...).mine`.
  - Ball/waiting: updates ARCH (Sun 2026-10-04) → CONT (Thu 2026-10-08); today Sun 2026-10-11 → ball `CONT`, waiting 1.
  - `execCountsT` on a fixture of 6 tasks gives exact numbers for each field (RFI waiting 8 workdays counts late; submittal with rounds 1,2,3 counts in `subRound3`).
  - `execBallSplitT` buckets `STRC` under `consultants`, skips closed.
  - `execDecideChangeT(approved_cond)` closes the task, keeps `exChange.decision==='approved_cond'`; then `requested` reopens.
- [ ] **Step 2: Run** `node --test tests/exec-logic.test.js` — new tests FAIL (not defined).
- [ ] **Step 3: Implement** the functions above inside the `exec-logic` block. Keep the old `execItems` helpers for now (Task 2's migration reads old items; Tasks 4–7 remove callers; Task 8 deletes the dead ones).
- [ ] **Step 4: Run** `node --test tests/exec-logic.test.js` → PASS; syntax check prints `scripts 3`.
- [ ] **Step 5: Commit** (with spec + plan): `feat(exec): task-model helpers for the execution log`

### Task 2: `execMigrateDoc` — old items to log tasks

**Files:** Modify `project_hub_01.html` (`exec-logic` block); Test `tests/exec-logic.test.js`

**Interfaces:**
- Consumes: Task 1 names.
- Produces: `execMigrateDoc(doc, disciplines) -> doc` (`disciplines` = the project list the caller resolves: `projList(d,'disciplines')` in the page, `projList(doc,'disciplines',c.reg)` in `mcp.js`; returns the same object when there is nothing to do); `execPartyDisc({party,name}, item, disciplines) -> disciplineId`.

Rules (from the spec):
- No `doc.execItems` (or empty) → return `doc` unchanged.
- Ensure sheet `{id:'exlog', type:'execlog', track:'execution', name:'יומן ביצוע', groups:[], tasks:[]}`; append a task for every item whose id isn't already in it; afterwards `execItemsLegacy = [...(legacy||[]), ...migratedItems]`, `execItems` removed. Running again on the output returns it unchanged.
- Task fields: `id` = item id; `title, description→description, discipline, priority, dueDate, createdAt, assigneeIds` from `ownerId`; `exType` = item type, `change`→`general`; `exSeq, exNo` = item `seq, number`; `exSource` = item `source`; `links` kept as `exLinks`; response/revision files → `attachments` (`{id,url,name}`), none dropped.
- `exChange` for `type:'change'`: `{tenderSpec, tenderRef, proposed, approvedText, decision: item.status}`.
- Updates (`events`), chronological, one per response that has a `ballTo` or is `close/decision/reopen`: `date` = `at.slice(0,10)`, `assignee` = `execPartyDisc(ballTo)` (or of the closer for close), `note` = body (plus the party name when it didn't map), `title` = old status label when it changed, `round` = submittal revision index (A→1, B→2 …) for updates after that revision was submitted, `countDays:true`.
- Last status (spec): closed → final `approved` update; RFI `answered` → `sent` to the side that asked; Issue `in_progress` → `progress`; submittal `rejected` → `comments` with `CONT`; others → `progress` to the current ball. Ball of the last update = the item's current `ball`.
- `execPartyDisc`: architect→`ARCH`, contractor→`CONT`, supervisor→`PM`, consultant → discipline whose id/label/`DISCIPLINE_FULL_NAMES` value occurs in `name`, else `item.discipline` if not `ARCH`, else `ARCH`.
- `execSeq`: keep as is (CHG counter simply stops being used).

- [ ] **Step 1: Failing tests:** a fixture doc with one item of each old type (RFI answered with 3 responses, closed issue, submittal with revisions A,B and status rejected, change approved_cond, consultant "קונסטרוקציה – אור פרקמן" with no STRC match → falls back) asserting: task ids = item ids; `exNo` preserved incl. `CHG-001` with `exType:'general'`; last update status/assignee per the rules; `execRound` of the submittal = 2; files moved to `attachments`; running the migration on its own output returns it unchanged; two runs on clones deep-equal (determinism — update ids derived from response ids, e.g. `'ev-'+response.id`); a doc with sheet already migrated plus one new item in `execItems` → one task added, legacy has both.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run → PASS; syntax check.
- [ ] **Step 5: Commit** `feat(exec): migrate execution items into log tasks`

### Task 3: Page wiring and the trial gate

**Files:** Modify `project_hub_01.html` (`migrateData`, CSS vars, `canSeeExec` callers)

- [ ] **Step 1:** Back up `data/project_hub_01.json` and `data/projects/*.json` to `data/backups/pre-execlog-<date>/`.
- [ ] **Step 2:** In `migrateData(d)`, call `d = execMigrateDoc(d, projList(d,'disciplines'))` after the tracks block (the `execution` track exists by then).
- [ ] **Step 3:** Add `--disc-CONT` / `--disc-CONT-bg` CSS variables next to `--disc-PM` (light and dark themes); define `EXEC_CONT_DISC = {id:'CONT', label:'CONT', color:'var(--disc-CONT)', bg:'var(--disc-CONT-bg)'}`.
- [ ] **Step 4: Gate audit.** Grep every reader of `.sheets` that does not filter `type==='list'` (search, `InboxPanel`, `OverviewPage`, home widgets, `hideFieldEverywhere`, `migrateOngoingHome`, export) and make each skip `type==='execlog'`. Record the list of call sites checked in the commit message.
- [ ] **Step 5: Verify:** add a test to `tests/page-scripts.test.js` (or a new `tests/exec-gate.test.js`) that greps the page for `.sheets` iterations and fails if one lacks `'list'`/`'execlog'` filtering (allow-list known sites). Run all tests; syntax check.
- [ ] **Step 6: Commit** `feat(exec): migrate on load; execution log kept out of task collectors`

### Task 4: `ExecutionView` hosts the list

**Files:** Modify `project_hub_01.html` (`ExecutionView`, `EX_VTABS` render, CSS for `ex-*`)

**Interfaces:** Consumes Task 1 helpers; `ListView`, `ListsCtx`, `ExtraCellsCtx`, `SectionBadgeCtx` as `DrawSetView` uses them.

- [ ] **Step 1:** Keep `ExecScheduleGantt`, the four counters and the ball bar; feed them `execCountsT` / `execBallSplitT` over `execLogTasks(data)`. Ball-bar legend: אדריכל · קבלן · PM · יועצים. Clicking a counter sets the chip filter as today.
- [ ] **Step 2:** Replace the table with `ListView` on the log sheet: `data:{...sheet, tasks:viewTasks, type:'list', __layoutScreen:'execlog'}`, `save` writes back into the `exlog` sheet (merge `tasks` by id so filtered-out tasks survive), `projectFields:[...EX_FIELDS, ...(data.fields||[])]` with `EX_FIELDS=[{id:'exNo',title:'מס׳',type:'text'},{id:'exType',title:'סוג',type:'text'},{id:'exBall',title:'הכדור אצל',type:'text'},{id:'exWait',title:'ממתין',type:'number'}]`; `ExtraCellsCtx` renders them (type tag as today's `ex-type-*` style; wait in red over threshold; `exportText` for each).
- [ ] **Step 3:** `ListsCtx` value: project priorities, `disciplines:[...projList(data,'disciplines'), EXEC_CONT_DISC]`, planning statuses, team — so the updates cell and side panel offer CONT/PM/consultants.
- [ ] **Step 4:** Chips (הכל · Issues · RFI · הגשות · כללי · שינויים) filter `viewTasks` by `exType` (שינויים = `exChange` set); "הצג סגורים" filters by `execTaskClosed`. "+ פריט חדש ▾" (Issue/RFI/הגשה/כללי) appends `execNewTask(...)` and bumps `execSeq`; the list's own add-row creates a task of the active chip's type (`general` on הכל/שינויים) via the same path.
- [ ] **Step 5:** Remove `ExNewItemDialog` and the old table code; `openItemId` / `ph:go-exec` now open the task's side panel (`focusTask`).
- [ ] **Step 6: Verify in preview** (project-hub, trial user, אולם ספורט לוד): counters show numbers, list renders with numbers/types, clicking the updates cell adds an update with CONT available, ball bar moves. Screenshot. All tests; syntax check.
- [ ] **Step 7: Commit** `feat(exec): the execution log is a task list`

### Task 5: Change requests — mark, side panel, ויתורים ושינויים

**Files:** Modify `project_hub_01.html` (`TaskDetailSidebar` extension point, `ExChangesView`)

- [ ] **Step 1:** Add `TaskSidebarExtraCtx` (render `(task, onUpdate) => node|null`); `TaskDetailSidebar` renders it under the description. `ExecutionView` provides a section: toggle "בקשת שינוי של הקבלן" (`execSetChange`), fields מה נקבע במכרז / הפניה / מה מוצע / מה אושר בפועל, decision buttons (`execDecideChangeT`), and the meeting / Outlook source line.
- [ ] **Step 2:** `ExChangesView` lists `execLogTasks(data).filter(t=>t.exChange)` with filters הכל / ממתינים / אושרו / נדחו by `exChange.decision`; rows open the same side panel; its summary uses the same task fields. Remove `ExecItemPanel`.
- [ ] **Step 3: Verify in preview:** mark a test task, decide `approved_cond` → task closes, appears under אושרו; reopen. Delete the test task afterwards.
- [ ] **Step 4: Commit** `feat(exec): change request is a mark on any log item`

### Task 6: Finishes, meetings, My Tasks, landing

**Files:** Modify `project_hub_01.html` (`ExFinishesView`, `finishStatus`/`finishFromSubmittal`/`finishUnlinkItem`, meeting exec helpers, `MyTasksView` exec section, landing effect, `task.execRef` button)

- [ ] **Step 1:** Finishes read `execLogTasks(data)`: a submittal counts approved when closed; `finishFromSubmittal(task)` takes element from title, files from `attachments`; ids unchanged so existing links hold. Update the mirrors in `tests/exec-logic.test.js`.
- [ ] **Step 2:** Meetings: "pull open items" lists open log tasks (number, title, ball); "open as item" creates a log task via `execNewTask` with `exSource:{kind:'meeting',ref}`; `execPill`/`execAge` read the task (`execWaitingT`).
- [ ] **Step 3:** My Tasks (trial users only): the "פריטי ביצוע אצלי" section is fed by `execForMeT(execLogTasks(doc), …)`; opening a row goes to the task in the log.
- [ ] **Step 4:** Landing: open the execution track when `execLogTasks(data).some(t=>!execTaskClosed(t))`. Task `execRef` button ("נוצרה מ־…") unchanged except it opens the log task.
- [ ] **Step 5: Verify in preview** each of the four; all tests; syntax check.
- [ ] **Step 6: Commit** `feat(exec): finishes, meetings and My Tasks read log tasks`

### Task 7: Connector and Outlook over log tasks

**Files:** Modify `tools/local-server/mcp.js`, `tools/local-server/outlook-ai.js` (types/parties), `tools/local-server/outlook.js` only if shapes change; Tests `tests/mcp-exec.test.js`, `tools/local-server/test/outlook.test.js`

- [ ] **Step 1:** `execLogic()` also returns the Task 1–2 names. Apply `L.execMigrateDoc(doc, projList(doc,'disciplines',reg))` in one place for writes — inside `writeProject(p, me, fn)` before `fn(doc)` — and in the exec tools' read paths (`list_exec_items`, `get_exec_item`, `list_finishes`), so a document still holding `execItems` is converted on first touch and saved converted on first write.
- [ ] **Step 1b:** `execInfo` returns types `issue|rfi|submittal|general` and parties as ball targets (`ARCH`, `CONT`, `PM`, then the project's consultants' disciplines); `outlook-ai.js` sanitize accepts them (keep accepting the old party ids, mapped through `execPartyDisc`). `attachToExec` appends the file to the task's `attachments`.
- [ ] **Step 2:** Tools keep their names and arguments: types `issue|rfi|submittal|general` (`change` accepted as `general` + change mark); parties map to disciplines (`contractor→CONT`, `architect→ARCH`, `supervisor→PM`, consultant name → discipline); `update_exec_item` "answer / pass the ball" appends an update; status `close` appends `approved`; change decisions go through `execDecideChangeT`. `execBrief` reports `ball` as the discipline label and `waiting_workdays` from `execWaitingT`. `get_exec_item` finds by id or `exNo`.
- [ ] **Step 3:** Rewrite the five exec tests in `tests/mcp-exec.test.js` to the new shape (same scenarios: RFI open→answer→close; submittal decision→finishes row; change approved→finishes, numbers continue; issue status and errors; trial-only listing) and add: a project file still holding `execItems` is migrated on first tool read and written back with `execItemsLegacy`. Update the Outlook exec test's expected `created` fields.
- [ ] **Step 4:** Confirm non-exec connector task tools ignore `execlog` (they filter `type==='list'`) — add one assertion to the trial test that `list_tasks` for a non-trial user returns no exec task.
- [ ] **Step 5:** `cd tools/local-server && node --test "test/*.test.js"` and `node --test "tests/*.test.js"` → PASS.
- [ ] **Step 6: Commit** `feat(exec): connector and Outlook work on execution log tasks`

### Task 8: Cleanup, translations, full check

**Files:** `project_hub_01.html`, `i18n-dict.js`, `tests/exec-logic.test.js`

- [ ] **Step 1:** Delete old-model helpers no caller uses any more (`execRespond`, `execSetBall`, `execAddRevision`, thread/round helpers, `execCounts`, `execBallSplit`, `execForMe`, `execLogRows` …) except what `execMigrateDoc` needs; drop their tests. Grep proves no caller remains.
- [ ] **Step 2:** Add English for every new Hebrew string (chips כללי, column titles, side-panel section, decisions); `node tools/i18n-extract.js` shows none of them; `node tools/i18n-extract.test.js` passes.
- [ ] **Step 3: Full check in preview**, Hebrew and English (dir flips): log, dashboard, changes, finishes, meeting pull, My Tasks; a non-trial user (switch `LOCAL_USER_NAME`) sees no exec tasks anywhere. Screenshots.
- [ ] **Step 4:** All test suites from `CLAUDE.md` → PASS.
- [ ] **Step 5: Commit** `chore(exec): remove the old item model; translations`
