# Google Sheets Quota Runbook

## Symptoms
- 429 or 5xx errors on ingestion/review/policy APIs.
- Writes stall while reads still work intermittently.

## Immediate Actions
1. Pause manual bulk uploads.
2. Retry using normal API retry/backoff (already enabled for parser path).
3. Check Google Cloud project quotas for Sheets API.

## Recovery
1. Reduce batch frequency temporarily.
2. Re-run failed jobs once quota recovers.
3. Validate idempotency:
   - Parse runs should not duplicate `incidents_raw` or `incidents_approved` entries.
4. Verify with:
   - `npm run sheets:verify --workspace @syc/web`

## Prevention
- Keep ingestion to planned cadence (3-5 times/week).
- Batch operational actions into fewer large writes rather than many tiny writes.
