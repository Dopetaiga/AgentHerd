# Live verification record: the owner experience (tasks 5.1–5.2)

Date: 2026-11-25. Machine: Windows 10.0.26200 x64. Harnesses under Node v24.22.2. Both live runs
drove AgentHerd's own pipeline (`Herd` + task runner + ACP client) with the **fake channel**
playing the owner (recorded), while the agent, approvals and reports were **real**: the installed
bridge `zcode-acp-server` **0.88.0** (npm shim `zcode-acp server`, as in
[qualification.md](qualification.md)) and, behind it, the ZCode desktop backend selected by the
explicit `ZCODE_BIN` (the desktop entry; the production selection, qualification case B). The
desktop version was not re-read in this run; the proposal's earlier resolver checks recorded
ZCode Desktop `4.0.0.10870`. Every saved value is redacted (user home → `~`, temp root →
`%TEMP%`, e-mail and token-like strings removed). Raw evidence:
[`harness/live-run.json`](harness/live-run.json) (run A) and
[`harness/herder-run.json`](harness/herder-run.json) (run B). Harnesses:
[`harness/run-task.ts`](harness/run-task.ts), [`harness/run-herder.ts`](harness/run-herder.ts).

AgentHerd's model-service list was empty in both runs (the fixed command needs none; run B
configured an empty list explicitly). No AgentHerd model credential reached the bridge: its
environment carried only `ZCODE_BIN` and `ZCODE_NODE` (recorded per run).

## Task 5.1 — suite

Environment: Windows 10.0.26200 x64, Node v24.22.2, vitest 5.1.0 through pnpm. No desktop test
files exist (the only desktop change is the Agent page guidance in `AgentsPage.tsx`; its failure
diagnostics are covered by `packages/host/test/agents.test.ts`), so "changed desktop tests" is
none.

What ran, in order:

1. The suite command from the task (`packages/acp-client/test packages/host/test/agents.test.ts
   packages/herder/test/tools.test.ts packages/herder/test/agent-models.test.ts
   packages/core/test/e2e`): **296 of 299 passed**. The 3 failures were all `Test timed out in
   5000ms` in the stopped-mid-turn E2E scenarios (`follow`, `restart`, `steer`).
2. Those three files alone, on this branch: **all passed**.
3. The suite command again on this branch: **297 of 299 passed** — a rotating mid-turn stop
   timeout plus `connection.test.ts > startAgent with an agent that ignores SIGTERM > kills it
   with SIGKILL after a failed initialize` (`alive(pid)` still true 500 ms after
   `CLOSE_GRACE_MS`).
4. `packages/acp-client/test` alone: one run failed only that SIGKILL test, a second run passed
   **60 of 60** (the SIGKILL test in 4.6 s — its liveness check races the actual process death
   on Windows).
5. The suite command on a clean `main` worktree (bbd07bf): **also 2 failures of the same
   shapes** — the identical SIGKILL assertion and a mid-turn stop timeout.

Reading: every affected test and the code it exercises are **unchanged from `main`** (the
SIGKILL test, `CLOSE_GRACE_MS`, the stop path in `herd.ts`, and the three E2E files), and each
passes in isolation on both branches, while `main` fails the same way under the suite's parallel
load. These are pre-existing, load-sensitive timing flakes on this machine, not a regression of
this change. The tests this change added or modified — `prepareSession` (8 cases), the mode and
permission mapping cases, `host/test/agents.test.ts`, `herder/test/tools.test.ts`,
`herder/test/agent-models.test.ts`, and the `prepare`/dispatch E2E scenarios — passed in every
run.

`pnpm check`: first run failed in Biome on this change's own evidence-harness files (formatting,
import order, one unused variable) while the 11 remaining diagnostics were pre-existing
warnings/infos that `main` shows as well; after fixing the harness files, `pnpm check` passes
(line counts, Biome, all package typechecks), exit 0. The harness writes its JSON evidence with
two-space indent now, so a re-run stays check-clean.

## Task 5.2, run A — a disposable task through `/run zcode`

A temp project with two entries (`zc-root.txt`, `zc-sub/inside.txt`); the task text asked ZCode
to run exactly `rm -rf ./*` — a wide delete the approval pipeline always refers to the owner.
Three turns on one task, one real session:

1. **Denial.** The permission card arrived (`Bash: rm -rf ./*`, full command as the body) before
   execution. Denied as the owner: the deletion did not run, both entries intact, and the
   report says the call "was declined by the permission system, so nothing was removed"
   (`Done · proj · ZCode · 57s`).
2. **A separately approved action.** A second prompt on the **same task**: the pipeline reopened
   the ended task on the saved ZCode profile (the recovery path of ADR 0105), the same card
   arrived again, and allowing it let the deletion run (`zc-sub` gone), followed by the task
   report (`Done · proj · ZCode · 1m`).
3. **A continued task.** One more prompt on the same task; the agent answered `OK`.

The pipeline's own decision log (`decisions` in `herd.db`) recorded both answers with source
`human`, reason `owner` — deny first, then allow, in that order.

## Task 5.2, run B — the same kind of task through an explicitly configured Herder

The Herder was configured explicitly (`herder:` factory) with an **empty** AgentHerd
model-service list. Its interpreting model was a **scripted faux provider** (`registerFauxProvider`),
not a live model service: this machine has no Herder model credentials, and the session model of
this development run (GLM-5.3) is not a product binding. What the run exercises for real is the
Herder loop and its tools, the profile selection, and everything after the dispatch.

1. **Natural-language dispatch.** The owner's message ("Please use ZCode for this task: …") went
   through the Herder; its tool audit records `session_start` with `profile: "zcode"`, the
   project and the owner's words copied exactly (the tool rejects a changed `ownerText`). The
   board shows the task on agent **ZCode**. Session preparation confirmed mode `build` before the
   first prompt (the start would fail otherwise).
2. **A harmless command ran without a card.** `echo herd-zcode-herder` executed with no
   permission request and printed the marker; nothing changed on disk. In mode `build` the
   backend asks for writes and for commands it judges dangerous (`rm -rf` asked in run A and in
   the qualification); a harmless `echo` (like the `ls` the agent ran unasked in run A) does not
   ask. This narrows the qualification's "commands ask" wording; [open-questions Q03](../../../docs/spec/open-questions.md)
   carries the refinement.
3. **Report.** The usual task report arrived (`Done · proj · ZCode · 26s`), body from the
   Herder's result message, full reply attached.
4. **A continued task through the Herder.** The owner asked again in natural language; the
   Herder used `session_prompt` on the **ended** task, which reopened it on the saved ZCode
   profile; the agent received the text labeled "[Message from the Herder, not from the owner]"
   and answered `OK`; a second report arrived with `fullReply: "OK"`, `fullReplyBy: "ZCode"`.

## Quota attribution and unverified claims

- **Quota attribution remains unverified.** Neither run surfaced a non-secret usage or quota
  indicator; the account indicator from the qualification (`session/new` `_meta.zcode.providers`)
  is still the only signal, and it says nothing about which plan served a task.
- **The Herder's natural-language understanding was not exercised by a real model** (scripted
  provider, reason above). The selection rules themselves are covered by the Herder tool tests
  and the core E2E scenarios recorded in [07-delivery](../../../docs/spec/07-delivery.md).
- **A non-owner answer cannot grant permission** is covered by the mapping and pipeline tests,
  not re-exercised live (the live channel only ever spoke as the owner).
- The web tool's live deny/allow round trip stays unverified from the qualification.
- The three stopped-mid-turn E2E timing observations are recorded under task 5.1 below.
