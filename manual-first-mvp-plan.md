# Manual-First MVP Plan (Next.js + Python Parser)

Assumption: no Sycamore API connectivity for MVP; ingestion is PDF upload only.

## 1. Architecture (Locked for MVP)
- `apps/web` (Next.js + TypeScript): UI, auth, policy engine, intervention workflows, dashboard, email triggers.
- `services/parser` (FastAPI + Python): PDF extraction, field confidence scoring, normalized JSON output.
- `packages/domain` (shared JSON schema + zod): canonical incident/intervention models used by both services.
- `packages/storage` (adapter pattern): `SheetsAdapter` now, `SupabaseAdapter` later.

## 2. Core Flow to Build
1. Admin uploads PDF.
2. Parser returns records + per-field confidence + parse warnings.
3. Low-confidence records go to human review queue.
4. Approved records are written to canonical store and mirrored to Google Sheets.
5. Policy engine evaluates thresholds (`X-3`, `X-1`, `X`, `X+5`, `X+10`, `X+20`).
6. Staff and parent emails are sent based on policy and approval rules.
7. Every action writes an audit log event.

## 3. Six-Week Delivery Plan
### Week 1: Foundations
- Monorepo setup, env/secrets, auth, role model (`admin`, `reviewer`).
- Google Sheets integration and tab creation.
- Basic parser service skeleton and health checks.

### Week 2: Ingestion + Parsing
- Upload UI and file storage.
- PDF parse endpoint with stable output schema.
- Parse run tracking (status, duration, errors).

### Week 3: Human Review
- Review queue, edit/approve/reject UI.
- Confidence thresholds and auto-approve rules.
- Correction capture for parser tuning dataset.

### Week 4: Policy + Notifications
- Configurable threshold rules.
- Intervention lifecycle states (`open`, `in_progress`, `completed`).
- Staff + parent email templates, send logs, retry handling.

### Week 5: Dashboard + Audit
- Milestone counts, grade-level trends, intervention funnel.
- Immutable audit log viewer with filters.
- Export CSV for admin reporting.

### Week 6: Hardening + Pilot
- Security pass (RBAC checks, PII-safe logs, rate limiting).
- End-to-end tests and UAT with real PDFs.
- Pilot launch checklist and rollback plan.

## 4. Google Sheets Schema (MVP Tabs)
- `students`
- `incidents_raw`
- `incidents_approved`
- `parse_runs`
- `review_tasks`
- `policies`
- `interventions`
- `notifications`
- `audit_events`

## 5. Design Now to Avoid Rework Later
- Keep all writes through repository interfaces; do not call Sheets directly from business logic.
- Store provenance on every incident: `source=manual_pdf`, `source_file_id`, `source_record_id`.
- Use stable internal IDs (UUIDs), not sheet row numbers.
- Add `IngestionSource` interface now so Sycamore API can plug in later without policy/dashboard rewrites.

## 6. Top MVP Risks and Mitigations
- Parser misses fields: enforce review queue + correction capture.
- Sheets contention/limits: batch writes + retries + nightly compaction.
- Parent-email errors: require approval gate for parent-facing sends in month one.
- Policy misfires: add dry-run mode and audit trail before enabling auto-send.

## 7. When to Start Sycamore API Integration
- As soon as superuser token is available, add `SycamoreSource` behind a feature flag.
- Run dual ingestion (PDF + API) for 2-3 weeks and compare incident counts before API-first switch.

## 8. Next Step
- Convert this plan into an implementation backlog with priorities, acceptance criteria, and owner roles.
