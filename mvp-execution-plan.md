# MVP Execution Plan (Manual Ingestion First)

Product: Signal  
Stack: Next.js (web + API) + Python FastAPI parser service  
Primary data source: Admin-uploaded discipline PDFs  
Primary storage (MVP): Google Sheets  
Notifications (MVP): Email to staff and parents

## 1) Purpose and Operating Constraints

This document is the detailed step-by-step implementation plan for delivering the MVP when Sycamore API access is unavailable.

Constraints this plan assumes:
- All source reports are digitally generated PDFs.
- Ingestion frequency is low (3-5 times per week).
- Parent-facing notifications are required in MVP.
- Manual human review is required for low-confidence parser output.
- Storage starts in Google Sheets and must be migration-ready for Supabase.

## 2) MVP Success Criteria (Go/No-Go Targets)

The MVP is launch-ready only if all of the following are true:

1. Data ingestion reliability:
- At least 95% of uploaded PDFs complete processing without system error.
- Failed jobs are visible, diagnosable, and retryable.

2. Parsing quality:
- Critical fields (`student`, `date`, `points`) are correct at least 99.5% after review workflow.
- All low-confidence rows are reviewable in UI before policy decisions.

3. Workflow completeness:
- End-to-end path works: upload -> parse -> review -> policy evaluation -> notifications -> intervention tracking.

4. Notification safety:
- Parent emails are never sent from unreviewed low-confidence critical records.
- Notification history is fully auditable.

5. Operational readiness:
- Basic monitoring, structured logs, and alerting are in place.
- Runbook exists for parser failure, email outage, and Google Sheets quota errors.

## 3) Team Roles and Ownership

Recommended minimum delivery team:
- Full-stack engineer (Next.js): web UI, API routes, policy engine, dashboard.
- Python engineer (parser): extraction pipeline, confidence scoring, parser tests.
- Shared platform owner: CI/CD, secrets, monitoring, deploy automation.
- Product/ops reviewer (part-time): policy validation, UAT, notification wording.

Ownership boundaries:
- Web team owns domain logic and orchestration.
- Parser team owns extraction accuracy and parser contract stability.
- Platform owns environment reliability and security baseline.

## 4) Repository and Service Layout

Target monorepo layout:

```text
apps/
  web/                      # Next.js app (UI + API routes)
services/
  parser/                   # FastAPI parser microservice
packages/
  domain/                   # Shared domain schemas and enums
  storage/                  # Repository interfaces + adapters
  config/                   # Environment validation and shared config
docs/
  (optional future docs folder)
mvp-execution-plan.md
```

Required boundaries:
- Business logic in `apps/web` must call repository interfaces only.
- `packages/storage` owns Sheets-specific implementation details.
- Parser service returns normalized records; it does not write to Sheets directly.

## 5) Phase Plan Overview

Execution is organized into 10 phases:

1. Phase 0: Project Initialization
2. Phase 1: Foundations (Auth, Config, Base Data Access)
3. Phase 2: Domain Model and Storage Contracts
4. Phase 3: Parser Service and Confidence Pipeline
5. Phase 4: Ingestion Orchestration
6. Phase 5: Human Review Workflow
7. Phase 6: Policy Engine and Interventions
8. Phase 7: Notifications (Staff + Parent)
9. Phase 8: Dashboard and Auditability
10. Phase 9: Hardening, UAT, and Pilot Launch

Each phase has:
- concrete build steps
- deliverables
- acceptance criteria
- failure conditions that block next phase

---

## 6) Detailed Step-by-Step Execution

### Phase 0: Project Initialization (Day 0-2)

Step 0.1: Create monorepo scaffold
- Tasks:
  - Initialize workspace package manager and project conventions.
  - Create `apps/web`, `services/parser`, `packages/domain`, `packages/storage`.
  - Add linting, formatting, and pre-commit hooks.
- Deliverables:
  - Bootstrapped repo with reproducible local setup.
- Acceptance criteria:
  - `install`, `lint`, and `test` scripts run successfully in CI.

Step 0.2: Define environment and secrets strategy
- Tasks:
  - Create `.env.example` for each service.
  - Add env validation in startup path.
  - Document secret storage for dev/staging/prod.
- Deliverables:
  - Environment variable contract document.
- Acceptance criteria:
  - App fails fast with clear errors when required env vars are missing.

Step 0.3: Set coding standards and branch policy
- Tasks:
  - Add PR template, issue template, and code review checklist.
  - Define release branch and tagging strategy.
- Deliverables:
  - Team workflow docs.
- Acceptance criteria:
  - Every PR includes testing evidence and acceptance criteria mapping.

### Phase 1: Foundations (Week 1)

Step 1.1: Implement authentication and roles
- Tasks:
  - Add secure admin login.
  - Support roles: `admin`, `reviewer`.
  - Add route guards for admin-only settings.
- Deliverables:
  - Authenticated shell app with role checks.
- Acceptance criteria:
  - Unauthorized users cannot access ingestion, policy, or notifications pages.

Step 1.2: Build base UI shell and navigation
- Tasks:
  - Create app layout, sidebar, top nav, and error boundary.
  - Add placeholder routes: Dashboard, Ingestion, Review, Students, Policies, Notifications, Audit.
- Deliverables:
  - Navigable admin shell.
- Acceptance criteria:
  - All core routes render with auth guard and skeleton states.

Step 1.3: Integrate Google Sheets connectivity baseline
- Tasks:
  - Configure service account credentials.
  - Build minimal read/write utility with retries and backoff.
  - Create workbook and required tabs.
- Deliverables:
  - Verified Sheets connection and tab bootstrap script.
- Acceptance criteria:
  - Integration test writes and reads a sample row from each required tab.

Blocking condition:
- Do not proceed to parser/ingestion until auth and Sheets connectivity are stable.

### Phase 2: Domain Model and Storage Contracts (Week 1-2)

Step 2.1: Define canonical domain schema
- Tasks:
  - Define entities: student, incident, parse_run, review_task, policy, intervention, notification, audit_event.
  - Add strict runtime validation schemas.
- Deliverables:
  - Shared domain package with type-safe schemas.
- Acceptance criteria:
  - Invalid payloads fail validation with actionable errors.

Step 2.2: Define repository interfaces
- Tasks:
  - Create interfaces for all domain entities.
  - Ensure no business logic imports Sheets SDK directly.
- Deliverables:
  - Contract-first storage layer (`packages/storage`).
- Acceptance criteria:
  - Web business services compile against interfaces only.

Step 2.3: Implement `SheetsAdapter` for repositories
- Tasks:
  - Map canonical entities to sheet tab rows.
  - Implement idempotent upsert patterns.
  - Implement pagination utility for large tabs.
- Deliverables:
  - Production-ready Sheets adapter.
- Acceptance criteria:
  - Repository integration tests pass for create/read/update/query operations.

Step 2.4: Add deterministic dedupe fingerprint strategy
- Tasks:
  - Define fingerprint fields for incidents (student key + date/time + reason + points + source reference).
  - Enforce duplicate prevention on ingestion.
- Deliverables:
  - Dedupe helper + tests with collision scenarios.
- Acceptance criteria:
  - Same source record ingested twice does not create duplicates.

### Phase 3: Parser Service and Confidence Pipeline (Week 2-3)

Step 3.1: Build parser API contract
- Tasks:
  - Define parser request and response payloads.
  - Include per-record and per-field confidence values.
  - Include parse warnings and raw snippet references.
- Deliverables:
  - Versioned parser contract (`v1`).
- Acceptance criteria:
  - Contract tests pass between web service and parser service.

Step 3.2: Implement extraction pipeline
- Tasks:
  - Text extraction from PDF pages.
  - Row segmentation into student incident candidates.
  - Field extraction for student, date, points, violation, comments, author.
- Deliverables:
  - Working parser with normalized outputs.
- Acceptance criteria:
  - Parser returns structured results for representative sample PDFs.

Step 3.3: Implement confidence scoring rules
- Tasks:
  - Add field-level confidence heuristics.
  - Add hard-fail checks for missing critical fields.
  - Add explainability flags (why confidence is low).
- Deliverables:
  - Transparent confidence subsystem.
- Acceptance criteria:
  - Low-confidence reason appears in review UI.

Step 3.4: Create parser regression test corpus
- Tasks:
  - Build anonymized fixture set from actual school PDFs.
  - Add golden output tests.
  - Track parser precision and recall on key fields.
- Deliverables:
  - Parser benchmark suite in CI.
- Acceptance criteria:
  - Parser quality trend is measurable and non-regressive.

Blocking condition:
- Do not enable parent notifications before parser confidence workflow is enforced.

### Phase 4: Ingestion Orchestration (Week 3)

Step 4.1: Build upload and job creation flow
- Tasks:
  - PDF upload UI and backend endpoint.
  - Create ingestion job status lifecycle: `pending`, `processing`, `review_required`, `completed`, `failed`.
  - Capture metadata (uploaded_by, filename, timestamp).
- Deliverables:
  - Ingestion center with job history.
- Acceptance criteria:
  - Upload creates visible job with real-time status updates.

Step 4.2: Add parser invocation and staging persistence
- Tasks:
  - Send uploaded file to parser service.
  - Persist raw parsed records to `incidents_raw` staging.
  - Persist parse warnings/issues.
- Deliverables:
  - Parsed output stored before approval.
- Acceptance criteria:
  - Every parsed row is traceable to job ID and source file.

Step 4.3: Add retry and failure handling
- Tasks:
  - Implement retry on transient parser/network failures.
  - Move irrecoverable errors to failed state with support diagnostics.
- Deliverables:
  - Resilient job execution pipeline.
- Acceptance criteria:
  - Failed jobs are retryable without duplicate writes.

### Phase 5: Human Review Workflow (Week 3-4)

Step 5.1: Build review queue page
- Tasks:
  - Filter by job, confidence band, grade, assignee, status.
  - Display raw snippet and parsed fields side-by-side.
- Deliverables:
  - Reviewer cockpit.
- Acceptance criteria:
  - Reviewers can find and process all low-confidence records quickly.

Step 5.2: Implement approve/edit/reject actions
- Tasks:
  - Approve unchanged row.
  - Edit fields and approve.
  - Reject row with reason.
  - Track reviewer attribution and timestamp.
- Deliverables:
  - Full human-in-the-loop controls.
- Acceptance criteria:
  - No low-confidence critical row reaches policy engine without explicit disposition.

Step 5.3: Write approved rows into canonical store
- Tasks:
  - Move approved rows from staging to `incidents_approved`.
  - Preserve provenance links to raw parse rows.
- Deliverables:
  - Canonical incident dataset.
- Acceptance criteria:
  - Canonical row includes reviewer metadata and provenance IDs.

Step 5.4: Capture correction dataset for parser improvement
- Tasks:
  - Record before/after values when reviewer edits fields.
  - Store correction class labels for future parser tuning.
- Deliverables:
  - Feedback loop dataset.
- Acceptance criteria:
  - Corrections are queryable by field and error category.

### Phase 6: Policy Engine and Interventions (Week 4-5)

Step 6.1: Build policy settings UI and data model
- Tasks:
  - Configure base threshold X.
  - Configure warning offsets (`-3`, `-1`).
  - Configure milestone increments (`+5`, `+10`, `+20`, etc.).
  - Define required intervention templates per milestone.
- Deliverables:
  - Policy configuration admin page.
- Acceptance criteria:
  - Policy updates are versioned and auditable.

Step 6.2: Implement policy evaluation engine
- Tasks:
  - Recompute student totals when approved incidents change.
  - Detect state transitions only (avoid repeat triggers).
  - Handle corrections that reduce totals.
- Deliverables:
  - Deterministic policy engine service.
- Acceptance criteria:
  - Engine results are reproducible for same input dataset.

Step 6.3: Implement intervention records and workflow states
- Tasks:
  - Create interventions on milestone transitions.
  - Track states: `open`, `in_progress`, `completed`, `overdue`.
  - Support notes and due dates.
- Deliverables:
  - Intervention tracking module.
- Acceptance criteria:
  - Dashboard reflects intervention state accurately.

### Phase 7: Notifications (Staff + Parent) (Week 5)

Step 7.1: Build recipient and template management
- Tasks:
  - Configure staff recipient groups.
  - Configure parent email behavior and approval guardrails.
  - Create message templates with placeholders.
- Deliverables:
  - Notification settings module.
- Acceptance criteria:
  - Admin can manage recipients and templates without code changes.

Step 7.2: Implement notification dispatch service
- Tasks:
  - Trigger sends on policy transitions.
  - Log provider message IDs and status.
  - Prevent duplicate sends for same student+milestone state.
- Deliverables:
  - Reliable notification pipeline.
- Acceptance criteria:
  - Delivery status is visible for each notification attempt.

Step 7.3: Add safety gates for parent-facing notifications
- Tasks:
  - Require reviewed data for parent sends.
  - Add override and approval logging for exceptional cases.
  - Add dry-run mode in staging.
- Deliverables:
  - Parent communication safety controls.
- Acceptance criteria:
  - Parent emails cannot be sent from unapproved/unsafe states.

Step 7.4: Add retry and dead-letter handling
- Tasks:
  - Retry transient failures with exponential backoff.
  - Record permanent failures in dead-letter queue.
  - Provide resend action in admin UI.
- Deliverables:
  - Operationally robust notification subsystem.
- Acceptance criteria:
  - Operators can identify and recover failed notifications.

### Phase 8: Dashboard, Student Views, and Auditability (Week 5-6)

Step 8.1: Build dashboard cards and trend views
- Tasks:
  - Milestone counts by threshold band.
  - Near-threshold students.
  - Grade-level breakdown and trend over time.
- Deliverables:
  - Executive dashboard.
- Acceptance criteria:
  - Dashboard loads within acceptable latency for target data volume.

Step 8.2: Build student profile and timeline
- Tasks:
  - Incident timeline with comments.
  - Current demerit total and milestone status.
  - Intervention history.
- Deliverables:
  - Student detail view.
- Acceptance criteria:
  - Admin can trace from alert to student timeline to intervention action.

Step 8.3: Build audit log explorer
- Tasks:
  - Log ingestion, review decisions, policy transitions, notification attempts.
  - Filter by date range, student, job, actor, and event type.
- Deliverables:
  - Immutable audit log UI.
- Acceptance criteria:
  - Every decision in pipeline has a corresponding audit event.

### Phase 9: Hardening, UAT, and Pilot Launch (Week 6)

Step 9.1: Security and compliance baseline pass
- Tasks:
  - Enforce RBAC checks on all sensitive routes/actions.
  - Remove PII from application logs.
  - Verify encryption in transit and secret handling.
- Deliverables:
  - Security checklist evidence.
- Acceptance criteria:
  - No critical security findings remain unresolved.

Step 9.2: Performance and reliability testing
- Tasks:
  - Run ingestion load test for realistic batch size.
  - Measure parser latency and end-to-end processing time.
  - Simulate provider outages (parser and email).
- Deliverables:
  - Performance and resilience report.
- Acceptance criteria:
  - End-to-end target remains within agreed SLA for weekly workflow.

Step 9.3: User acceptance testing with school admins
- Tasks:
  - UAT scripts for upload, review, policy handling, notification, intervention completion.
  - Capture and triage defects.
  - Validate notification copy and escalation paths.
- Deliverables:
  - Signed UAT checklist.
- Acceptance criteria:
  - All P1 and P2 issues resolved before pilot.

Step 9.4: Pilot launch and support plan
- Tasks:
  - Enable pilot for designated admins.
  - Define support hours and escalation contact.
  - Prepare rollback and incident response steps.
- Deliverables:
  - Pilot runbook and launch approval.
- Acceptance criteria:
  - Team can recover from ingestion or notification incidents within defined response window.

---

## 7) Detailed Backlog by Priority

### P0 (Must Have Before Pilot)

1. Authentication and role-based access.
2. PDF upload and ingestion job tracking.
3. Parser contract with confidence scoring.
4. Human review queue with approve/edit/reject.
5. Dedupe and canonical approved incident storage.
6. Policy engine with transition-only triggers.
7. Intervention creation and status tracking.
8. Staff and parent email notifications with safety gate.
9. Full audit log coverage.
10. Basic monitoring and on-call runbook.

### P1 (Strongly Recommended for Pilot Stability)

1. Batch retry management and dead-letter queue.
2. Admin tools for resend and manual intervention close/reopen.
3. Confidence threshold tuning dashboard.
4. CSV export for leadership reporting.
5. Parser correction analytics.

### P2 (Post-Pilot / Early v1)

1. Sycamore ingestion adapter behind feature flag.
2. Supabase adapter and dual-write migration mode.
3. Advanced qualitative analytics pipeline.

---

## 8) Acceptance Criteria by Feature Area

### Ingestion
- Uploading valid PDF creates ingestion job.
- Corrupt PDF fails gracefully with visible error.
- Reprocessing same file does not duplicate canonical incidents.

### Review
- Reviewers can edit and approve low-confidence rows.
- Review actions are fully audited.

### Policy
- Threshold transitions trigger exactly once per crossing.
- Policy changes are versioned and traceable.

### Notifications
- Staff notifications sent on valid transitions.
- Parent notifications require approved critical fields.
- Failure and retry history visible in UI.

### Dashboard
- Metrics match canonical approved dataset.
- Drill-down paths are consistent and actionable.

---

## 9) Testing Strategy

Automated tests:
- Unit tests for parser field extraction helpers.
- Unit tests for policy transition logic.
- Integration tests for repository interfaces against Sheets adapter.
- Contract tests for web-parser API payload compatibility.
- End-to-end tests for full ingestion-to-notification workflow.

Manual test packs:
- Real PDF variability set by grade level.
- Notification copy review with school operations.
- Role/permission regression checks.

Release gates:
- No open critical defects.
- End-to-end happy path tested in staging with production-like config.
- Audit log completeness verified.

---

## 10) Operational Runbooks (Required Before Pilot)

Runbook A: Parser failure
- Symptoms, likely causes, immediate mitigation, retry sequence, escalation owner.

Runbook B: Sheets quota/rate limit issue
- Backoff behavior, queue pausing, replay procedure, duplicate safety checks.

Runbook C: Email provider outage
- Disable sends, queue messages, recovery and replay process.

Runbook D: Incorrect policy deployment
- Roll back to previous policy version, re-evaluate impacted students, communicate corrections.

---

## 11) Key Risks and Active Mitigations

Risk: Parser output quality drifts with new PDF formats.
- Mitigation: correction dataset, regression corpus, confidence gating, rapid tuning loop.

Risk: Google Sheets becomes operational bottleneck.
- Mitigation: batching, repository abstraction, early Supabase adapter skeleton.

Risk: Parent communication errors.
- Mitigation: approval gates, dry-run mode, explicit notification audit and resend controls.

Risk: Policy ambiguity across grade levels.
- Mitigation: policy versioning, explicit rule display in UI, stakeholder sign-off workflow.

---

## 12) Exit Criteria for MVP Completion

MVP is complete when:

1. All P0 backlog items are shipped and verified.
2. Pilot users complete end-to-end workflow without engineering intervention.
3. Incident, policy, notification, and intervention data are auditable.
4. Team has operational runbooks and on-call response process.
5. Migration-ready boundaries are in place (`IngestionSource`, repository adapters).

---

## 13) Immediate Next Actions (First 5 Working Days)

Day 1:
1. Finalize repo scaffold and CI.
2. Define env contracts and secrets setup.

Day 2:
1. Implement auth shell and protected routes.
2. Bootstrap Google Sheets tabs and connectivity tests.

Day 3:
1. Finalize canonical schemas and repository interfaces.
2. Stub parser contract and integration tests.

Day 4:
1. Build ingestion job model and upload endpoint.
2. Implement initial parser call + staging persistence.

Day 5:
1. Build review queue v1 with approve/reject.
2. Demo internal end-to-end path with one sample PDF.
