# ADR 0041: The Herder keeps its whole conversation and folds it itself (billion-context's kernel)

- Status: Accepted
- Date: 2026-11-08
- Related: [ADR 0003](0003-herder-on-pi-agent-core.md), [ADR 0009](0009-mit-license-reference-only.md),
  [ADR 0020](0020-fork-pi-agent-loop-track-upstream.md), [ADR 0037](0037-herder-retries-and-never-drops.md)

## Context

The Herder is one long session with the owner. It was saved as the last 200 messages in state key
`herder.messages`, and every request sent all of them: older messages were lost, and a busy day
could still pass the model's window. Spec 04 promised that compaction keeps unresolved owner
instructions verbatim, but there was no compaction.

pi-durable compacts at a token threshold. The owner did not want that (2026-11-07): "我希望的是用
billion-context的形式" — the model decides which parts are done and folds them into summaries it
writes itself, it can search and unfold them, and nothing is lost.
[billion-context](https://github.com/ranxianglei/billion-context) does this as a proxy or an agent
plugin. Its engine, [acp-kernel](https://github.com/ranxianglei/acp-kernel), is a library with no
host dependency (MIT plus an attribution term). The owner asked to copy the code into the repo and
own it instead of depending on the package: "参考把代码全copy过来，就类似嵌入，但是代码是我们自己写，
而不是完全依赖这个".

## Decision

- `packages/context-kernel` is a copy of billion-context's `kernel/` (acp-kernel 0.0.185, upstream
  commit 6945a35). AgentHerd owns it: it is not an npm dependency, we change it when the Herder
  needs it, and upstream fixes are taken by hand. `UPSTREAM.md` lists every local change; today only
  import extensions and one self-import differ. Its own test suite (1605 tests) runs in `pnpm test`.
- `herd.db` schema 7 adds `herder_log(seq, message_json)`: every Herder message, never cut. A save
  rewrites only from the first changed message. The kernel's state (folds, refs) is in state key
  `herder.context`; when it is missing, the folds are rebuilt by replaying the `compress` calls in
  the log. On upgrade, `herder.messages` moves into the log.
- Before each model request (`transformContext` of the loop), `packages/herder/src/context.ts` maps
  the log to the kernel's messages (ids `h<index>` by position; an opening line goes first because
  the kernel always keeps the first user message), runs the kernel, and maps the result back:
  folded ranges become one summary note, messages carry a `<acp …>mNNNNN</acp>` ref, tool calls are
  sent unchanged.
- The Herder gets the kernel's four tools: `compress` (fold ranges into summaries it writes),
  `decompress` (show a fold's content; the fold stays), `search_context` and `acp_status`. The
  kernel's rules go into the system prompt after the Herder's own and before the memory snapshot.
  The Herder's prompt adds: fold finished parts; keep unfinished owner requests verbatim, with task
  names, folders and models.
- The kernel's nudges and status line are added only to the request, as notes at the end. They are
  not saved, so the cached prefix does not change.
- Last resorts, never a cut: when the request reaches 90 % of the model's window, AgentHerd folds
  the oldest whole turns with a plain summary down to 60 % (never the current turn); a "context too
  long" error from the provider folds about half and retries once. Folded messages stay in the log
  and can be searched and shown.
- Ref tags the model copies are removed from what reaches the owner and from tool arguments. A
  turn that only used the context tools counts as not acted, so a transient error still retries it.
- README, README.zh-CN and `docs/references.md` state that AgentHerd uses acp-kernel and
  billion-context, with links, as the license's additional term asks.

## Alternatives

- Depend on the `acp-kernel` npm package: a smaller diff, but the code would not be ours to change.
- Run billion-context as a proxy in front of the Herder's model: one more process, and it rewrites
  HTTP requests of a loop we already own.
- Compact at a threshold like pi-durable: no model judgment, nothing to unfold.
- Write a smaller engine: the kernel is tested and measured (LongMemEval-S 79.2 %); ours would start
  from zero.

## Consequences

- The whole conversation with the owner is kept; nothing is cut. A long history costs memory and one
  slow first request after start: 10,000 messages took about 2.8 s once, then about 40 ms per request.
  An archive for very old messages is future work.
- The system prompt is about 11,000 characters longer.
- About 25,000 lines of upstream code live in the repo (excluded from biome, type-checked, tested).
- Folds are in the audit log (`herder.context.*`). There is no App view of the folds yet.
