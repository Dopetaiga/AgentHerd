# ADR 0038: The Herder has a long-term memory in herd.db

- Status: Accepted
- Date: 2026-11-06

## Context

The owner: "我觉得我们的pi需要引入一个长期记忆库", without having to approve every write; similar past
tasks must be found before a new one starts. We studied ai-memory, OpenClaw, Hermes Agent, nanobot,
OpenMausBot, rakazo, open-duet, AnyModelBot, DeepSeekBot and OpenViking.

## Decision

- Six kinds: owner, person, project, note, case, experience. Owner and note are resident in the
  system prompt with caps (1375 / 2200 chars, reject when full); the rest are recalled.
- Writes come from the Herder's `memory` tool, a task-end job and a review job, and all pass code
  checks: owner facts need verbatim typed evidence, preferences a lasting marker, no temporary
  paths, no values the Herder chose itself. Changes are revisions and can be undone.
- Storage in `herd.db` (no Markdown files), FTS5 trigram plus a local embedding model (downloaded once into `<home>/models` until there is an installer)
  (bge-small-zh-v1.5), hybrid 0.7/0.3, fast-model rerank when starting a task.
- Shown and edited in the app's 「记忆」 page and with `/记忆`, `/忘掉`, `/恢复` in Feishu.

## Consequences

- +60–80 MB installer for the embedding runtime and model.
- See [spec 08 §2](../spec/08-herder-interaction.md#2-memory).
