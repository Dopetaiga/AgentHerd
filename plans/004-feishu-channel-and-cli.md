# Plan 004: The owner approves a mock agent's request from a real Feishu card, started from a CLI

> **Executor instructions:** Follow this plan step by step. Run every **Verify** command and
> compare with the expected result. If a STOP condition happens, stop and report. Do not
> improvise. When done, set the state of this plan in `plans/README.md`.

> **Drift check (run first):** `git diff --stat <plan 003 done sha>..HEAD -- packages docs/spec/05-channels.md`.
> If files changed in a way that makes "Current state" wrong, STOP.

## Status

- Milestone: M1 (closes it)
- Size: M
- Risk: MEDIUM (real external service; manual step)
- Depends on: plan 003
- Planned at: `c9f52e2`, 2026-11-04

## Why this matters

M1's exit criterion is one manual run with real Feishu
([07-delivery.md §1](../docs/spec/07-delivery.md#1-milestones)). This plan adds the first real
channel and a small CLI so the loop can be run before the desktop app exists.

## Current state

- `Herd`, `channel-fake` and the M1 E2E tests exist (plan 003).
- A throwaway prototype proved the Feishu flow on 2026-11-04 (not in this repo; do not copy
  it, rewrite to the spec): `registerApp` from `@larksuiteoapi/node-sdk` 1.76.0 with
  `createOnly: true`, addons for the scopes, event and callback below; one scan returns
  `client_id`, `client_secret` and `user_info.open_id`; QR valid 3600 s; `WSClient` +
  `EventDispatcher` receive both `im.message.receive_v1` and `card.action.trigger`; the
  callback handler returns `{ toast, card: { type: "raw", data } }` to update the card.

## Scope

**In scope:**

- `packages/channel-feishu`: `Channel` implementation per
  [05-channels.md §3](../docs/spec/05-channels.md#3-feishu-channel).
- `packages/cli` (`agentherd` bin, run with `tsx`): `setup feishu`, `run`, `status`.
- Secret storage for the CLI in the macOS keychain.
- Channel contract tests against recorded payloads.

**Out of scope:**

- Desktop onboarding UI (M2). Starting tasks from a chat message through the Herder (M2, E2E-RUN-FROM-CHAT); relay, board, reports (M2).
- Reconnect queueing (E2E-CHANNEL-DOWN, M2).

## Commands you will need

```bash
pnpm add --filter @agentherd/channel-feishu @larksuiteoapi/node-sdk@^1.76.0
pnpm add --filter @agentherd/cli qrcode @napi-rs/keyring
pnpm --filter @agentherd/channel-feishu test
pnpm exec tsx packages/cli/bin/agentherd.ts setup feishu
```

## Steps

### Step 1: Card rendering

`packages/channel-feishu/src/card.ts`: `renderItemCard(view: ItemView): object` and
`renderFinalCard(view, finalState)`, Card JSON 2.0, `config.update_multi: true`. Buttons
carry callback value `{ itemId, action }`. Risk shown as a colored tag. Final state replaces
the buttons with a one-line status ("Allowed by you", "Denied by you", "Expired").

Unit tests with snapshot files under `packages/channel-feishu/test/__snapshots__/`.

### Step 2: Inbound parsing

`packages/channel-feishu/src/inbound.ts`: pure functions from recorded payloads to `Inbound`:

- `card.action.trigger` → `{ kind: "action", itemId, action, from: operator.open_id }`.
- `im.message.receive_v1` (p2p text) → `{ kind: "message", text, from: sender.open_id }`.
- Anything else → `null`.

Recorded payloads go in `packages/channel-feishu/test/fixtures/*.json`, with ids replaced by
fake ones and no tokens.

### Step 3: Channel implementation

`packages/channel-feishu/src/channel.ts` implementing `Channel`:

- `start(binding, sink)`: create `Client` and `WSClient` with the App ID from `binding.data`
  and the App Secret from the secret store (passed in as a function, not imported); register
  handlers; owner check is done by the core, but the card callback must still answer quickly:
  return a toast `"Received"` and let the core call `updateItem`.
- `sendItem` / `sendText` to the owner's `open_id` (`receive_id_type: "open_id"`);
  `updateItem` with the message API (`im.v1.message.patch`) using the stored `message_id`.
- `setup(ui)`: `registerApp` with app name `<user name>'s AgentHerd` (fallback
  `AgentHerd`), `createOnly: true`, scopes `im:message`, `im:message:send_as_bot`,
  `im:message.p2p_msg:readonly`, event `im.message.receive_v1`, callback
  `card.action.trigger`; report states through `ui` (`qr`, `waiting-scan`,
  `waiting-confirm`, `verifying`, `connected`); verify with a tenant access token; return the
  binding plus the secret for the caller to store.

### Step 4: Channel contract tests

`packages/core/test/channel-contract.ts` exports a contract suite (send, update, owner check,
duplicate action, reply mapping) run against `channel-fake` and, with a stubbed Feishu
client that records requests, against `channel-feishu`.

**Verify:** `pnpm test` → all pass.

### Step 5: CLI

`packages/cli/bin/agentherd.ts`:

- `agentherd setup feishu`: runs `setup`, prints the QR in the terminal and saves `qr.png`
  under `<home>/run/`; stores the App Secret in the keychain (`@napi-rs/keyring`, service
  `agentherd`, account `feishu:<appId>`); writes the binding (no secret) into
  `<home>/config.json` with mode `600`.
- `agentherd run [--profile mock|<id>] [--script <yaml>] [--mode observe|assist] <dir> <prompt>`:
  starts `Herd` with the Feishu channel, runs one task, prints state changes, exits when the
  turn ends. Profile `mock` points at the mock-agent bin.
- `agentherd status`: prints sessions and open items from `herd.db`.
- Update [02-architecture.md §3 and §5](../docs/spec/02-architecture.md#3-packages): add
  `cli/` and `channel-fake/` to the package list; note that the CLI stores secrets in the
  keychain with `@napi-rs/keyring`, and the desktop app uses Electron `safeStorage` (M2).

**Verify:** `pnpm exec tsx packages/cli/bin/agentherd.ts --help` → lists the three commands.

### Step 6: Manual run (needs the maintainer)

Ask the maintainer to:

1. `pnpm exec tsx packages/cli/bin/agentherd.ts setup feishu` and scan the QR.
2. `pnpm exec tsx packages/cli/bin/agentherd.ts run --profile mock --script packages/mock-agent/scripts/approve.yaml /tmp/demo "run the tests"`.
3. Tap Allow on the card in Feishu.

Expected: the card turns into "Allowed by you", the CLI prints `end_turn`, `status` shows
one decision with `source = human`. Record the result (date, what was seen) in this plan's
Maintenance notes.

### Step 7: Docs and commit

- 07-delivery: mark M1 done when Step 6 passed.
- README and README.zh-CN: add a "Try it (M1)" section with the two commands.
- Commits: `feat(channel-feishu): …`, `feat(cli): …`, `docs: …`, each with a why-body.

## Test plan

Unit: card rendering, inbound parsing. Contract: both channels. Manual: Step 6.

## Done criteria

- [ ] `pnpm check` and `pnpm test` exit 0.
- [ ] No App Secret in `config.json`, logs, `herd.db` or fixtures (grep for it after Step 6).
- [ ] Manual run recorded.
- [ ] `plans/README.md` state set to `DONE`; M1 marked done in 07-delivery.

## STOP conditions

- `registerApp` or the long connection behaves differently from "Current state".
- The keychain package cannot be installed or loaded on this machine.
- A check fails twice after a fix attempt.

## Maintenance notes

- The CLI is a development tool until the desktop app exists; it stays useful for headless
  runs and E2E debugging.
- Deviations from the steps, found while implementing:
  - The protocol `Channel` has `send`/`update`/`pin` with a `View`; `card.ts` has one
    `renderCard(view)` for every view kind. Callback values carry `{ target, action }`.
  - The Feishu SDK sits behind a small `FeishuApi` interface (`src/api.ts`), so the contract
    tests use a recording stub. `setup` takes `register` and `verify` seams for unit tests.
  - `setup` gets the secret storage through `saveSecret(appId, secret)`; the binding holds only
    `appId` and `brand`.
  - The CLI runs with plain `node` (type stripping): `tsconfig.base.json` now sets
    `erasableSyntaxOnly`, so parameter properties were replaced by fields. `tsx` still works.
  - Store gained `recentSessions` and `recentDecisions` for `status`.
  - Steps 1–5 done on 2026-11-04.
- Manual run (Step 6), 2026-11-04 13:38 +08:00: `setup feishu` created app `cli_aa6078d3eef85cf1`
  with one scan (about 3 minutes from QR to credentials); the secret went to the keychain and
  `config.json` (mode 600) holds only App ID, brand and owner `open_id`. `run` with
  `approve.yaml`: card sent 1.2 s after start, the maintainer tapped Allow 7.7 s later, the
  card was patched without a `channel.error`, the CLI printed `[turn] end_turn`, and `status`
  shows one decision with `source = human`. The App Secret was not found in `config.json`,
  `herd.db`, `herd.db-wal`, the CLI output or the repo.

