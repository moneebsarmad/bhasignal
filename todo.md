# MVP Execution Board (Manual Ingestion First)

Source of truth: `mvp-execution-plan.md`  
Execution rule: complete tasks in order; do not skip phase gates.

---

## 0) Global Preconditions

- [ ] G0.1 Policy sign-off received from school stakeholders:
  - [ ] Base threshold `X`
  - [ ] Milestones (`X+5`, `X+10`, `X+20`, `X+30`)
  - [ ] Warning offsets (`X-3`, `X-1`)
  - [ ] Intervention actions per milestone
- [ ] G0.2 Parent/staff notification recipients and approval rules finalized.
- [ ] G0.3 Data handling/compliance expectations documented for MVP.
- [ ] G0.4 Real sample PDFs collected and anonymized for testing corpus.

Gate `G0` pass criteria:
- [ ] Written product/policy sign-off document exists.
- [ ] At least 20 representative PDFs available for parser QA.

---

## 1) Phase 0: Initialization (Day 0-2)

- [x] P0.1 Create monorepo structure:
  - [x] `apps/web`
  - [x] `services/parser`
  - [x] `packages/domain`
  - [x] `packages/storage`
  - [x] `packages/config`
- [x] P0.2 Set up tooling:
  - [x] lint
  - [x] format
  - [x] typecheck
  - [x] test runner
  - [x] pre-commit hooks
- [x] P0.3 Set up CI for lint/typecheck/tests.
- [x] P0.4 Add `.env.example` and runtime env validation for each service.
- [x] P0.5 Add PR template + definition-of-done checklist.

Gate `P0` pass criteria:
- [x] Fresh clone can run install/lint/typecheck/tests successfully.
- [ ] CI passes on a baseline PR.

---

## 2) Phase 1: App Foundations (Week 1)

- [x] P1.1 Implement admin auth shell and protected routing.
- [x] P1.2 Implement roles: `admin`, `reviewer`.
- [x] P1.3 Build base layout + navigation:
  - [x] Dashboard
  - [x] Ingestion
  - [x] Review
  - [x] Students
  - [x] Policies
  - [x] Notifications
  - [x] Audit
- [x] P1.4 Add error boundaries and empty/loading states.
- [x] P1.5 Configure Google Sheets service account access.
- [x] P1.6 Create tab bootstrap script for MVP schema:
  - [x] `students`
  - [x] `incidents_raw`
  - [x] `incidents_approved`
  - [x] `parse_runs`
  - [x] `review_tasks`
  - [x] `policies`
  - [x] `interventions`
  - [x] `notifications`
  - [x] `audit_events`

Gate `P1` pass criteria:
- [x] Unauthorized users cannot access protected pages.
- [ ] Sheets integration test can write/read sample rows across tabs.

---

## 3) Phase 2: Domain + Repository Layer (Week 1-2)

- [x] P2.1 Define canonical domain schemas:
  - [x] Student
  - [x] Incident (raw + approved)
  - [x] ParseRun
  - [x] ReviewTask
  - [x] Policy
  - [x] Intervention
  - [x] Notification
  - [x] AuditEvent
- [x] P2.2 Create repository interfaces for each entity.
- [x] P2.3 Enforce rule: no direct Sheets SDK calls in business logic.
- [x] P2.4 Implement `SheetsAdapter` for repositories.
- [x] P2.5 Implement deterministic dedupe fingerprinting for incidents.
- [x] P2.6 Add idempotent upsert patterns.

Gate `P2` pass criteria:
- [x] Repository integration tests pass for create/read/update/query.
- [x] Duplicate ingestion test proves idempotency.

---

## 4) Phase 3: Parser Service (Week 2-3)

- [x] P3.1 Define parser API contract `v1`:
  - [x] request shape
  - [x] normalized records
  - [x] per-field confidence
  - [x] parse warnings
  - [x] raw snippet references
- [x] P3.2 Implement PDF extraction + segmentation pipeline.
- [x] P3.3 Implement field extraction:
  - [x] student identity
  - [x] date/time
  - [x] points
  - [x] reason/violation
  - [x] teacher/author
  - [x] comment text
- [x] P3.4 Implement confidence scoring and low-confidence reason codes.
- [x] P3.5 Build parser regression corpus from sample PDFs.
- [x] P3.6 Add parser benchmark tests to CI.

Gate `P3` pass criteria:
- [x] Parser contract tests pass from Next.js orchestrator.
- [x] Quality metrics tracked for critical fields.

---

## 5) Phase 4: Ingestion Orchestration (Week 3)

- [x] P4.1 Build PDF upload endpoint + validation (type/size/page limits).
- [x] P4.2 Create ingestion job lifecycle:
  - [x] `pending`
  - [x] `processing`
  - [x] `review_required`
  - [x] `completed`
  - [x] `failed`
- [x] P4.3 Invoke parser service and persist staging rows to `incidents_raw`.
- [x] P4.4 Persist job-level issues and parser warnings.
- [x] P4.5 Add retry/backoff for transient parser/network failures.
- [x] P4.6 Add safe re-run behavior for failed jobs.

Gate `P4` pass criteria:
- [x] Upload -> parse -> staging path works end-to-end.
- [x] Failed jobs are diagnosable and retryable without duplication.

---

## 6) Phase 5: Human Review Workflow (Week 3-4)

- [x] P5.1 Build review queue with filters (job/confidence/grade/status/assignee).
- [x] P5.2 Show raw snippet alongside parsed fields.
- [x] P5.3 Implement review actions:
  - [x] approve
  - [x] edit + approve
  - [x] reject (with reason)
- [x] P5.4 Persist reviewer attribution and timestamps.
- [x] P5.5 Promote approved rows into `incidents_approved`.
- [x] P5.6 Capture before/after correction data for parser tuning.

Gate `P5` pass criteria:
- [x] No low-confidence critical record can bypass review.
- [x] Review action trail is fully auditable.

---

## 7) Phase 6: Policy Engine + Interventions (Week 4-5)

- [x] P6.1 Build policy configuration UI:
  - [x] base `X`
  - [x] warnings (`-3`, `-1`)
  - [x] milestone increments (`+5`, `+10`, `+20`, ...)
  - [x] intervention templates
- [x] P6.2 Add policy versioning and change history.
- [x] P6.3 Implement demerit aggregation per student.
- [x] P6.4 Implement transition-only trigger logic.
- [x] P6.5 Handle downward corrections safely (recompute/adjust states).
- [x] P6.6 Auto-create intervention records on triggered milestones.
- [x] P6.7 Add intervention state machine:
  - [x] `open`
  - [x] `in_progress`
  - [x] `completed`
  - [x] `overdue`

Gate `P6` pass criteria:
- [x] Threshold transitions trigger exactly once per crossing.
- [x] Interventions are created and traceable to policy events.

---

## 8) Phase 7: Notifications (Week 5)

- [x] P7.1 Integrate email provider.
- [x] P7.2 Build template and recipient configuration UI.
- [x] P7.3 Implement notification dispatch on policy transitions.
- [x] P7.4 Add idempotency key for send dedupe.
- [x] P7.5 Log send attempts, provider IDs, outcomes, and errors.
- [x] P7.6 Add retry and dead-letter handling.
- [x] P7.7 Add parent safety gates:
  - [x] parent sends require approved critical data
  - [x] override events require explicit audit record

Gate `P7` pass criteria:
- [x] Staff and parent emails send correctly on valid transitions.
- [x] Duplicate sends are prevented for same state transition.

---

## 9) Phase 8: Dashboard + Auditability (Week 5-6)

- [x] P8.1 Build dashboard KPI cards:
  - [x] count at `X`
  - [x] count at `X+10`
  - [x] count at `X+20`
  - [x] count at `X+30`
  - [x] near-threshold count
- [x] P8.2 Add grade/time filters and drill-down tables.
- [x] P8.3 Build student list and searchable student profile.
- [x] P8.4 Build student timeline:
  - [x] incidents
  - [x] comments
  - [x] interventions
- [x] P8.5 Build audit explorer for:
  - [x] ingestion events
  - [x] review decisions
  - [x] policy transitions
  - [x] notification actions

Gate `P8` pass criteria:
- [x] Dashboard numbers match canonical approved dataset.
- [x] Admin can trace alert -> student -> intervention -> audit history.

---

## 10) Phase 9: Hardening + UAT + Pilot (Week 6)

- [x] P9.1 Security pass:
  - [x] RBAC review on all sensitive routes/actions
  - [x] PII scrubbed from logs
  - [x] secrets handling validated
- [x] P9.2 Reliability pass:
  - [x] parser outage simulation
  - [x] email outage simulation
  - [x] Sheets quota/rate limit simulation
- [x] P9.3 Performance pass:
  - [x] measure upload->dashboard latency on realistic batches
  - [x] verify weekly workflow SLA
- [ ] P9.4 UAT run with school admins.
- [ ] P9.5 Fix critical defects from UAT.
- [x] P9.6 Create pilot runbooks:
  - [x] parser failure
  - [x] Sheets quota issue
  - [x] notification outage
  - [x] bad policy deployment rollback
- [ ] P9.7 Launch pilot cohort.

Gate `P9` pass criteria:
- [ ] UAT sign-off captured.
- [ ] Pilot support and rollback plan approved.

---

## 11) Continuous Test Matrix (Run Throughout)

- [x] T1 Unit tests: parser helpers, policy logic, state transitions.
- [x] T2 Integration tests: repository adapters, parser contract, notification service.
- [x] T3 E2E tests: upload -> review -> policy -> notify -> intervention complete.
- [x] T4 Data quality tests: missing fields, duplicate detection, out-of-range points.
- [x] T5 Security tests: auth boundaries and permission checks.
- [x] T6 Regression suite for parser changes using golden fixtures.

---

## 12) MVP Done Definition

- [x] D1 Admin can upload PDFs and process records with human review controls.
- [x] D2 Policy engine triggers correct warning/milestone transitions.
- [x] D3 Staff and parent notifications are reliable, deduplicated, and auditable.
- [x] D4 Intervention workflow supports completion and audit traceability.
- [x] D5 Dashboard is accurate and usable for daily admin operations.
- [ ] D6 Core flows pass UAT and production smoke tests.

---

## 13) Post-MVP Queue (Do Not Start Before MVP Gate)

- [ ] N1 Add `SycamoreSource` ingestion adapter behind feature flag.
- [ ] N2 Add `SupabaseAdapter` and dual-write migration mode.
- [ ] N3 Add advanced qualitative analytics pipeline for comment clustering/theming.
