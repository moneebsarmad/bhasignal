# Parser Failure Runbook

## Symptoms
- Upload jobs move to `failed` in ingestion.
- `/api/parser/health` returns non-200 or timeout.
- Parser warnings show `no_text_extracted` or parser upstream errors.

## Immediate Actions
1. Check parser process:
   - `uvicorn parser_service.main:app --host 127.0.0.1 --port 8000`
2. Verify health endpoint:
   - `curl -sS http://127.0.0.1:8000/health`
3. Confirm `PARSER_BASE_URL` in `apps/web/.env.local`.
4. Retry failed run from ingestion UI by re-uploading with `parseRunId` if needed.

## Recovery
1. Re-run parser regression suite:
   - `.venv/bin/python -m pytest services/parser/tests`
2. Validate one known-good PDF through ingestion.
3. Monitor audit events for `ingestion_job_completed` and parser warnings.

## Escalation
- If parser is healthy but extraction quality drops, review `services/parser/tests/fixtures/corpus.json` and update heuristics in `pipeline.py`.
