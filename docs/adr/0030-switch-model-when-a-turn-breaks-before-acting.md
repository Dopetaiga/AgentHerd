# ADR 0030: Switch the model and run again when a task's first turn breaks before it acts

- Status: Accepted
- Date: 2026-11-05

## Context

A task started on a model with no balance (`403 INSUFFICIENT_BALANCE`) failed and the owner had
to start it again. The Herder already tests a model before starting a task (ADR 0028), but a test
can pass and the real turn still fail. Asked what to fix first, the maintainer chose "任务中途没额度/
报错，还没动手就自动换模型重跑". OpenBot fails over to backup models only while the turn has
not written text or run a tool, so nothing is done twice.

## Decision

- When a task's turn fails (the agent's prompt call errors or the agent exits) and the task has a
  model from the owner's list, the turn has no text and no tool call, and no earlier turn of the
  task ended, AgentHerd closes the agent, starts it again with the next model, and sends the same
  prompt.
- The next model follows the Herder's order (`fallbackOrder` in `packages/herder/src/tools.ts`):
  other services with the same model name, the same tier, then the other tiers; only models the
  agent can run; each must answer a test call. The failed model counts as failing for 2 minutes.
- At most `MAX_MODEL_SWITCHES` (3) models per task. The owner gets one line in chat; the audit
  log has `task.model-switched`.
- A task the owner stopped, or a turn that already did something, is never run again.

## Consequences

- Later turns are not switched: a new agent session would lose the conversation.
- An agent that reports a model error as plain text and ends its turn normally is not detected.
