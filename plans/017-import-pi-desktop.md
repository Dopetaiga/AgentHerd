# Plan 017: Import model services from PI-Desktop (ADR 0027)

Executor: Claude (lead). Status: WITHDRAWN 2026-11-05 — the owner removed the feature (see ADR 0027).

## Scope

- `packages/host/src/import-pi-desktop.ts`: `readPiDesktop(dir, {builtin, existing})`,
  `readPiDesktopSecret(dir, ref)`, `serviceIdFor(name, baseUrl, taken)`.
- `Host.importPiDesktop()` → `PiDesktopImport {added, merged, skipped, models}`; in `HOST_METHODS`.
- `ModelService.api` (`openai-completions` | `anthropic-messages`) for custom services;
  `resolveModel` uses it; the desktop custom form has 接口格式 under 高级.
- `builtinBaseUrls()` in `packages/herder/src/models.ts`.
- 模型 page button 「从 PI-Desktop 导入」 with a toast of what was added, merged and skipped.

## Tests

`packages/host/test/import-pi-desktop.test.ts`: decrypting keys written like PI-Desktop does,
mapping builtin/custom/Anthropic services, skipping OAuth/disabled/Responses, unique ids, merging
into an existing list without replacing its key.
