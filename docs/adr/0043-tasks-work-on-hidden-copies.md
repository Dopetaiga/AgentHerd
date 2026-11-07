# ADR 0043: Tasks work on hidden copies of their project, and AgentHerd picks the project when it can

- Status: Accepted
- Date: 2026-11-07
- Amends: [ADR 0035](0035-herder-finds-projects-owner-picks.md) (one exact match no longer asks)

## Context

Every task started with a question 「在哪个目录？」, even when only one project had the name the
owner typed. Tasks ran in the owner's own folder, so two tasks on one project, or a task and the
owner, edited the same files at once. We looked at OpenBot (one fixed workspace per agent, folders
attached in settings) and Comma (each task gets its own git worktree of a repository). The owner
(2026-11-07) wanted no new settings and no folders, branches or worktrees to see: "设置里不需要新增
东西，我觉得可以不给用户作为这个感知到有目录", and changes put back "每轮结束就放回".

## Decision

- Where a task works:
  - A git project: a hidden copy under `~/.agentherd/worktrees/<project>-<hash>/<task id8>`, made
    with `git worktree add --detach` from a snapshot of the owner's working tree (commit, staged,
    unstaged and untracked files; ignored files left out). `node_modules`, `.venv`, `venv` are
    linked (junctions on Windows), `.env*` files copied. No branch is created; the snapshots live
    under `refs/agentherd/tasks/<id>` so `git branch` stays clean. The owner's index is never
    touched (snapshots use a temporary index).
  - A folder that is not a git project: the task runs in it, as before.
  - No project: an empty folder `~/.agentherd/tasks/<id8>`; the board shows 「无项目」.
  - `agentherd run` (CLI) keeps running in the given folder.
- Syncing, at turn boundaries:
  - Turn start: what the owner changed since the last sync is copied into the task's copy, except
    files the task changed itself.
  - Turn end: what the task changed is written into the owner's folder as uncommitted changes.
    A file both changed differently is a conflict: the owner's version stays and one message lists
    the files with a button 「用任务的版本」.
  - Task end: a last sync, then the copy is removed (links unlinked first). Continuing an ended
    task makes a new copy from its last snapshot. Copies left by a crash are removed on start.
- Picking the project: when `project_find` finds exactly one project with the name and that name
  is in the owner's typed words this turn, the Herder starts there without asking. Otherwise it
  still asks with paths as buttons (ADR 0035 stays for everything else).
- Continuing: a reply (Feishu 引用回复) to a task's report, alarm, conflict or relay message goes to
  that task without the Herder (`message_tasks` table, schema 7). Otherwise the Herder decides and
  asks 「接着做：<name>」/「新任务」 when unsure.
- Messages name the project, never the copy's path.

## Consequences

- Several tasks can work on one project at once without overwriting each other mid-turn; the owner
  sees their changes as ordinary uncommitted edits after each turn.
- Build outputs and other ignored files are not in the copy; a task that needs them rebuilds.
  Dependencies are shared through the links, so installing a package in a task changes the owner's.
- A conflict never loses work: the task's version stays in its snapshot until the owner picks it.
- One copy per open task uses disk space for tracked files only.
