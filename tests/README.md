# Verification conventions

Use Node's test runner for core behavior: `npm test`. Capture-dependent and original-research tests skip explicitly when private inputs are absent from a public source distribution. The portable synthetic tests still run. A skip is not a passing captured/live check.

Distinguish these evidence classes in fixture names and test descriptions:

- `synthetic`: constructed values/DOM used to exercise a defined behavior; not captured from a live site.
- `captured`: exact sanitized DOM with source site, capture date and scope in adjacent provenance metadata.
- `live-extension`: observed behavior of the actually loaded extension in the named site's draft.

Synthetic player names/projections are test-only data. Do not bundle them as production research. Prior reconnaissance notes may inform tests but must not be renamed as captured fixtures. Keep exact browser captures in `work/fixtures/` until sanitized and reviewed for a distributable test fixture.

Test decision quality and state correctness: scoring, unique starter/flex assignment, roster needs, snake turns, explicit pick invalidation, history gaps, stale responses and coverage. Do not add tests merely to assert configuration text or mirror an implementation formula.
