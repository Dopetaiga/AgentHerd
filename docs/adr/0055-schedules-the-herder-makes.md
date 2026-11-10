# ADR 0055: The Herder makes schedules when the owner asks

- Status: Accepted
- Date: 2026-11-10
- Builds on: [ADR 0033](0033-herder-does-not-repeat-reports.md), [ADR 0048](0048-watch-mail-only-when-asked.md), [ADR 0052](0052-offer-new-github-work-when-asked.md), [ADR 0053](0053-the-herder-tells-task-results.md)

## Context

The Herder ran only when the owner wrote, answered, or a task needed telling. Owners want
things done at set times: 「每天早上 9 点看看 PI-Desktop 有没有新 issue」, 「每周一汇总上周的
PR」, 「明天下午三点提醒我交周报」. The deepseek-super-agent prototype has `routines.json` edited
by hand; personal agents such as OpenClaw let the agent make cron jobs in chat. The owner chose
(2026-11-10): the Herder makes them in chat; they hold at once and the Herder says back what it
set (no confirmation card), so a wrong time is corrected in the next message.

## Decision

- A **schedule** (`Schedule`, `packages/core/src/schedules.ts`, table `schedules`, schema 13)
  has a short name (`about`), the words to run (`prompt`, up to 2000 characters) and a time:
  `daily` at `HH:MM` on every day or some weekdays, `every` N hours (1–168), or `once` at
  `YYYY-MM-DD HH:MM`, in the Mac's local time. At most 20.
- Only the Herder makes, changes, pauses and removes them (`schedule_add`, `schedule_change`,
  `schedule_remove`), only in an owner turn. A task's reply, a web page, a mail, new GitHub
  work or a schedule's own turn cannot make one. The prompt tells the Herder to write the
  `prompt` complete on its own (project, what to do, when to stay quiet) and to restate the
  schedule in one line.
- Core `Schedules` looks every minute for due schedules; a minute tick instead of one long timer
  because timers fire late after the Mac slept. On start it looks at once: times missed while
  AgentHerd was off run **once**, not once per missed time. A `once` schedule is removed after
  it ran; a paused one has no next time.
- A due schedule gives the Herder a **scheduled turn** (`HerderPort.scheduled`): the saved prompt
  is treated as the owner's words (it came from an owner message), so `session_start` may copy
  it as `ownerText` and folders named in it count as picked. The Herder answers, starts a task
  or replies `[quiet]` to send nothing. The scheduled turn cannot make schedules, watches or
  memory.
- The app has a 「定时任务」 page listing schedules with their next run; the owner can pause,
  resume or remove one there. Making one is only in chat.

## Alternatives

- **Confirmation card before a schedule holds.** Rejected by the owner: one more tap for every
  schedule; the restated line catches mistakes.
- **Running the task directly at the time, without the Herder.** Rejected: most schedules are
  checks whose answer is often "nothing new"; the Herder decides whether to start work or stay
  quiet, and a task needs a project and an agent that may have changed.
- **cron expressions.** Rejected: three kinds cover what owners ask; the model fills fields more
  reliably than it writes cron.
- **Catch up every missed time.** Rejected: after a night closed, seven "看看新 issue" turns say
  the same thing.

## Consequences

- One Herder model call per run; a quiet run costs a call and says nothing.
- A schedule set while AgentHerd is off does not exist; one due while it is off runs on start.
- The scheduled turn waits behind the owner's current turn like other Herder jobs.
- The time zone is the Mac's; a schedule made in 「9 点」 stays at 09:00 local when travelling.
