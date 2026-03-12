# Engineering Validation Log

## Date
- 2026-02-12

## Automated validations completed
- Full web test suite passed (`npm run test --workspace @syc/web`).
- Storage adapter tests passed (`npm run test --workspace @syc/storage`).
- Web typecheck passed (`npm run typecheck --workspace @syc/web`).
- Web production build passed (`npm run build --workspace @syc/web`).
- Monorepo check passed (`npm run check`).
- Local end-to-end smoke script passed (`npm run smoke:local --workspace @syc/web`).

## New validation coverage added
- End-to-end workflow test: upload -> review -> policy -> notify -> intervention complete.
  - File: `apps/web/tests/workflow-e2e.test.ts`
- Ingestion orchestration integration tests including retry and stale-row safety.
  - File: `apps/web/tests/ingestion-workflow.test.ts`
- Parser outage simulation via transient failure retries and failed parse run assertions.
  - File: `apps/web/tests/ingestion-workflow.test.ts`
- Notification PII log scrubbing assertion.
  - File: `apps/web/tests/notifications.test.ts`
- Sheets quota/rate-limit simulation for adapter failure surfacing.
  - File: `packages/storage/tests/sheets-adapter.test.ts`
- Performance smoke test for medium ingestion batch latency.
  - File: `apps/web/tests/performance-smoke.test.ts`
- Development storage fallback tests (no-Sheets local execution path, file-backed).
  - File: `apps/web/tests/storage-adapter.test.ts`

## Remaining non-automatable / external validations
- Live Google Sheets bootstrap/verification requires:
  - `GOOGLE_SHEETS_SPREADSHEET_ID`
  - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
  - `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
- `npm run sheets:bootstrap --workspace @syc/web` currently fails until those variables are provided.
- UAT sign-off and pilot launch tasks require stakeholder execution.

## Latest smoke evidence
- Date: 2026-02-13
- Base URL: `http://127.0.0.1:3003`
- Parse run: `af2cec4b-9d94-4ac0-b85c-c7ea684c1f3f`
- Review task: `af2cec4b-9d94-4ac0-b85c-c7ea684c1f3f:review:af2cec4b-9d94-4ac0-b85c-c7ea684c1f3f:raw:0001`
- Policy version: `1`
- Intervention: `int_1_stu_kezay3_x`
- Notification summary: attempted `6`, sent `6`, failed `0`, dead-lettered `0`
- Dashboard snapshot:
  - `totalStudents`: `1`
  - `incidentsInRange`: `1`
  - `countAtX`: `1`
  - `countAtX10`: `0`
  - `countAtX20`: `0`
  - `countAtX30`: `0`

## Live Google Sheets smoke evidence
- Date: 2026-02-13
- Base URL: `http://127.0.0.1:3010`
- Parse run: `96f88127-1d10-4346-a6e0-a8ae4f468add`
- Review task: `96f88127-1d10-4346-a6e0-a8ae4f468add:review:96f88127-1d10-4346-a6e0-a8ae4f468add:raw:0001`
- Policy version: `3`
- Intervention: `int_3_stu_kezay3_x`
- Notification summary: attempted `5`, sent `5`, failed `0`, dead-lettered `0`
- Dashboard snapshot:
  - `totalStudents`: `2`
  - `incidentsInRange`: `5`
  - `countAtX`: `1`
  - `countAtX10`: `1`
  - `countAtX20`: `1`
  - `countAtX30`: `1`
- Notes:
  - Transient Google Sheets `429 RESOURCE_EXHAUSTED` read-quota bursts occurred during repeated API calls.
  - Smoke runner now retries quota/transient failures with exponential backoff.
  - Storage adapter now reuses a singleton Sheets adapter per process and caches per-tab header checks to reduce read pressure.
