# Plan 018: Model tiers arranged by dragging (ADR 0028)

Executor: Claude (lead). Status: DONE (manual run pending).

## Scope

- `packages/herder/src/model-guide.ts`: `Tier`, `TIERS`, `tierOf(model)`, `placeModels(refs, saved)`,
  `tiersText(placement)`; replaces `DEFAULT_MODEL_GUIDE` / `effectiveModelGuide`.
- Host: `modelTiers()` → `ModelTiersView`, `setModelTiers(tiers | null)`; `config.json` `modelTiers`;
  the Herder's guide is `tiersText` of the current placement.
- Desktop: `components/ModelTiers.tsx` (three columns, HTML drag and drop, 恢复自动分档) on the 主管
  page, replacing `ModelGuide.tsx`; dev-bridge fake.

## Tests

`packages/herder/test/model-guide.test.ts` (name rules, placement, text), host test (placement by
name, owner's drag kept, new model appended, reset), tools test (tiers in session_list).

## Maintenance notes

- 2026-11-05: same-name models are one card (tiers keyed by model name, `TierModelView.services`);
  `session_start` with a bare name fails over between services via `HerderHost.checkModel`
  (host caches test calls). Test: tools test "merges a model offered by several services…".
