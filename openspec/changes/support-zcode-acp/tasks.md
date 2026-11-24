# Tasks

Implementation starts in a new GLM-5.3 execution session after the owner's explicit approval. Open the checkout containing this [proposal](proposal.md), [spec](specs/zcode-tasks/spec.md) and [design](design.md). The earlier resolver checks are evidence about command selection only. All tasks below are pending.

## 1. Qualify the bridge and its approval behavior

- [ ] 1.1 In a disposable project, use the installed stdio bridge with AgentHerd's client capabilities. Record the OS, bridge/backend versions and backend selection for automatic discovery and explicit override. Verify initialization and session creation separately from the first real backend operation.
- [ ] 1.2 On the same real session, set a candidate approval mode and identify an authoritative confirmation of the effective mode. Repeat on load and same-profile replacement. Verify that a pending session, unreadable state or reported default cannot count as confirmation.
- [ ] 1.3 Run harmless file and command actions that require approval. Record the permission request and one-time option kinds, deny and inspect the target for side effects, then allow a separate action and inspect its result. Check relevant external-action tool coverage with harmless inputs. Keep a redacted record of the observations. **Stop and report the compatibility gap** if the tested bridge/backend cannot confirm the mode or lets a required action run before the decision.

## 2. Prepare ACP sessions before prompting

- [ ] 2.1 Add the session-scoped mode operation and confirmation to `packages/acp-client` using the qualifying evidence. Exercise accepted, rejected, ambiguous and timed-out responses in `packages/acp-client/test/connection.test.ts`. Verify current callers can still open/load sessions and set a model.
- [ ] 2.2 Cover the observed ZCode permission format in the existing ACP mapping tests. Verify the pipeline receives the action and target, a deny or cancel cannot grant permission, and allow selects only a one-time option. Change normalization only if the recorded shape requires it.
- [ ] 2.3 Invoke preparation in the task runner for initial creation, successful load and replacement after failed load. With the mock agent, assert that a prompt or replay follows confirmation, and that failure closes the attempted connection without dispatching work. Add the permission and recovery scenarios with their tests to `docs/spec/07-delivery.md`.

## 3. Register the worker and expose its status

- [ ] 3.1 Add the owner-installed `zcode` profile to the host catalog with the explicit `server` argument and `ownModels`. In host profile and agent tests, verify discovery, Windows launcher arguments, an unset backend override, explicit override passthrough and absence of AgentHerd model credential injection. Leave backend lookup to the bridge.
- [ ] 3.2 Add Agent page guidance for the installed bridge, missing bridge/backend and unusable sign-in. Check the host/desktop results for each failure and verify diagnostics are redacted. Update the agent table in `docs/spec/03-agents.md`, the integration ADR and ADR index, and the paired README agent lists. Document the observed limits of the verification button.

## 4. Route explicit requests and preserve the owner's account choice

- [ ] 4.1 Extend the Herder prompt and tool descriptions for explicit ZCode selection. Verify with Herder tool tests and a core fixed-command E2E that natural language uses the configured Herder, direct dispatch works with an empty model-service list, and the default worker model is left to ZCode. Verify a rejected named worker model produces a useful error. Update `docs/spec/04-herder.md` and the dispatch E2E entry.
- [ ] 4.2 Exclude ZCode from automatic initial selection, first-turn substitution and reopen candidates for ordinary tasks. Keep ZCode recovery on the saved ZCode profile until the owner chooses otherwise. Test ZCode as the only installed agent, missing original executables after restart, successful same-agent reopen and failed recovery. Verify the existing Pi, Codex, Claude Code and Antigravity regression tests and document the account-choice rule with its E2E entry.

## 5. Verify the complete owner experience

- [ ] 5.1 Run the relevant suite, including `pnpm exec vitest run packages/acp-client/test packages/host/test/agents.test.ts packages/herder/test/tools.test.ts packages/herder/test/agent-models.test.ts packages/core/test/e2e`, any changed desktop tests, and `pnpm check`. Record commands, environment and outcomes.
- [ ] 5.2 Verify one disposable task through `/run zcode` and another through an explicitly configured Herder. Check the selected backend, denial with no side effect, a separately approved action, the final report and a continued task. Record actual OS, backend version, fake or real channel, and only non-secret evidence of quota attribution when available. Mark unobserved claims explicitly.
