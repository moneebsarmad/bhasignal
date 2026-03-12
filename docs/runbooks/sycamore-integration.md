# Sycamore Integration Runbook

## Purpose

Validate and operate the Sycamore discipline integration for the admin app.

## Prerequisites

- A Sycamore bearer token created from the Sycamore UI under `My Organizer -> Applications`
- The correct Sycamore `schoolId`
- Network reachability from the web app runtime to the Sycamore API host

## Required environment variables

```bash
SYCAMORE_API_ENABLED=true
SYCAMORE_ACCESS_TOKEN=...
SYCAMORE_SCHOOL_ID=...
SYCAMORE_API_BASE_URL=https://app.sycamoreschool.com/api/v1
SYCAMORE_DISCIPLINE_PATH_TEMPLATE=/School/{schoolId}/Discipline
CRON_SECRET=...
SYCAMORE_REQUEST_DELAY_MS=150
SYCAMORE_SCHOOL_YEAR_START_MONTH=8
SYCAMORE_SCHOOL_YEAR_START_DAY=1
SYCAMORE_INCREMENTAL_OVERLAP_DAYS=1
```

## Probe the connection

Run a live probe once the variables are present:

```bash
npm run sycamore:probe --workspace @syc/web -- --date=2026-03-10
```

Expected outcome:

- discipline fetch succeeds for the requested date
- sample keys are printed for the school list and detail response shapes

If the probe fails:

- `401` or `403`: verify the token and the permissions on the Sycamore user that created it
- `404`: verify the base URL and path template
- `204` on discipline: the date may simply have no discipline records
- If the school-level discipline feed stays empty while student discipline endpoints return data, the app will fall back to a roster scan using `/Student/{id}/Discipline`

## Operating modes

- Manual range sync: use the dashboard or ingestion page and submit `startDate` and `endDate`
- Default sync: use the dashboard button, the ingestion page action, or Vercel Cron against `GET /api/sycamore/sync`

Default sync behavior:

- first successful run: current school-year backfill
- later runs: incremental window from the last successful sync with the configured overlap

## Notes

- The integration is pull-only. It does not write data back to Sycamore.
- Imported rows are written directly to `sycamore_discipline_logs` and `sycamore_sync_log`.
- `sycamore_discipline_logs` stores normalized analytics fields alongside the raw payload, including `points`, `level`, `violation`, `violation_raw`, `resolution`, `author_name`, and `author_name_raw`.
- This dataset is read-only for dashboard/reporting in v1. It does not create review tasks, approved incidents, notifications, or interventions automatically.
- Local student linking is opportunistic through `students.external_id`.
- Idempotency is based on Sycamore `sycamore_log_id`.
- The app prefers the school-wide discipline feed first, then falls back to per-student discipline discovery if the school feed returns no rows for the requested window.
