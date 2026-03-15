# Signal

Sycamore-first discipline operations monorepo scaffold.

## Structure

- `apps/web`: Next.js admin app.
- `packages/domain`: Shared domain types.
- `packages/storage`: Repository interfaces.
- `packages/config`: Shared config validation helpers.

## Quick Start

### 1) Node workspace

```bash
npm install
npm run dev:web
```

### 2) Tests

```bash
npm run check
```

### 2.1) Local end-to-end smoke workflow

```bash
npm run smoke:local --workspace @syc/web
```

Optional retry tuning (useful with Google Sheets quota throttling during rapid test loops):

```bash
SMOKE_MAX_ATTEMPTS=6 SMOKE_RETRY_BASE_MS=2000 npm run smoke:local --workspace @syc/web
```

### 4) Configure storage

Preferred: Supabase. Apply the SQL in `supabase/schema.sql` inside the Supabase SQL editor, then set:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Legacy option: bootstrap Google Sheets tabs once credentials are set.

```bash
npm run sheets:bootstrap --workspace @syc/web
```

Storage selection order is `Supabase -> Google Sheets -> local file fallback`. If neither Supabase nor Sheets credentials are set in development, `apps/web` falls back to `.local/web-storage.json` (or `LOCAL_STORAGE_FILE`). This fallback is disabled in production.

### 5) Enable local git hooks

```bash
git init
git config core.hooksPath .githooks
```

## Current Status

- Phases `P0` to `P8` implemented in code:
  - auth + protected admin shell
  - Sycamore sync intake and roster linking
  - policy versioning and intervention engine
  - notification config/queue/dispatch with override audit
  - dashboard, students timeline, and audit explorer
- Phase `P9` engineering hardening pass completed in code:
  - security checks (RBAC review, secrets validation, PII log scrubbing)
  - reliability simulations (email failure, Sheets rate limit handling)
  - performance smoke test for medium ingestion batch
- Operational runbooks added in `docs/runbooks/`.
- Direct Sycamore sync is the active discipline source:
  - manual admin sync via `/api/sycamore/sync`
  - nightly production sync via `vercel.json` cron
  - imported SIS rows land in `sycamore_discipline_logs` and `sycamore_sync_log`
  - normalized SIS fields include `points`, `level`, `violation`, `violation_raw`, `resolution`, and `author_name`
  - these rows now drive the active discipline workflows across the app

## Runbooks

- `docs/runbooks/sheets-quota-issue.md`
- `docs/runbooks/notification-outage.md`
- `docs/runbooks/policy-rollback.md`
- `docs/runbooks/sycamore-integration.md`
- `docs/uat-checklist.md`
- `docs/engineering-validation.md`
