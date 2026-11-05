# ADR 0027: Import model services and keys from PI-Desktop

- Status: Accepted
- Date: 2026-11-05
- Related: [ADR 0021](0021-model-list-then-choose-per-role.md)

## Context

The maintainer already configured model services in PI-Desktop and asked (2026-11-05): "你把我pi-desktop的这些模型服务，复制一份到AgentHerd".
PI-Desktop keeps services in `~/.pi-desktop/pi.sqlite` (`providers`: name, vendor key, API style,
base URL, auth kind, chosen models in `config_json`) and API keys in `~/.pi-desktop/secrets/`,
one file per secret named `sha256(secret_ref).bin`, holding `base64(nonce ‖ ciphertext ‖ tag)`
encrypted with AES-256-GCM under the raw 32-byte `secrets/.machine-key`
(PI-Desktop `crates/host-core/src/secrets.rs`).

## Decision

- The host gets `importPiDesktop()`; the 模型 page has a 「从 PI-Desktop 导入」 button. It reads the
  database read-only, decrypts the keys, and writes services to `config.json` and keys to
  `secrets.json`, as if the owner had added them by hand.
- A service whose vendor is a key-only pi-ai provider at its default address becomes a `builtin`
  service; others become custom services. Custom services gain an `api` field so Anthropic-format
  gateways (`anthropic_messages`) work; OpenAI chat completions stays the default.
- A service AgentHerd already has (same provider, or same base URL) only gains the missing models;
  its id and key stay. New ids come from the name, or the host name when the name is too short.
- Skipped, with a reason shown: disabled services, account sign-in (OAuth) services, and API styles
  AgentHerd cannot call (OpenAI Responses).
- Import is a one-off copy, not a sync. Running it again adds what is new.

## Consequences

- Keys leave PI-Desktop's encrypted store for AgentHerd's `secrets.json` (mode 600), which is the
  same protection AgentHerd gives keys typed by hand (ADR 0021).
- If PI-Desktop changes its secret format, import of keys fails and services come without keys;
  the owner then adds keys by hand.
