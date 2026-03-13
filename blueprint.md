# Technical Blueprint
## Signal

This blueprint translates the PRD into implementable architecture, delivery phases, and engineering decisions.

---

## 1) Architecture Principles
- **MVP-first:** Build for fast school deployment using Google Sheets + robust ingestion.
- **Migration-ready:** Keep domain model and services decoupled from data storage provider.
- **Audit-first:** Every ingestion, policy decision, and notification is traceable.
- **Human-in-the-loop:** Parsing confidence and review UX are mandatory for data quality.
- **Policy-driven:** Intervention behavior lives in configurable policy metadata, not hardcoded logic.

---

## 2) Stack Recommendations (Top 2)

## Option A (Recommended): Next.js + TypeScript (Full-stack JavaScript)
**Why recommended:**
- Single framework for frontend + backend routes.
- Strong React ecosystem for dashboard UI.
- Good fit for file upload, admin interfaces, cron/background jobs (via serverless or worker pattern).
- Shared TypeScript types across UI, parser service wrappers, policy engine, and notification service.

**Suggested stack components:**
- Frontend: Next.js App Router + React + TypeScript + Tailwind + component library (e.g., shadcn/ui)
- Backend: Next.js Route Handlers or separate Node worker for long-running parsing
- Validation: Zod
- ORM/Data access abstraction: Custom repository layer (MVP sheets adapter, v1 Supabase adapter)
- Job queue (optional MVP): Upstash/Redis queue or simple DB-backed job polling
- Email: Resend / SendGrid / SES
- Auth: NextAuth or Clerk

## Option B: React Frontend + FastAPI Backend (Python for ingestion-heavy path)
**Why this is a strong alternative:**
- Python has best-in-class PDF/text parsing and NLP tooling.
- FastAPI provides clean API contracts and async performance.
- React frontend remains familiar and modern.

**Tradeoff:**
- Two-codebase overhead vs Next.js single codebase.
- Added infra complexity for deployment and CI/CD.

**When to choose Option B:**
- If PDF parsing complexity is very high and requires advanced NLP/ML sooner.
- If team has strong Python backend expertise.

---

## 3) Frontend Architecture

## 3.1 Core Screens
1. **Login / Access**
2. **Dashboard**
   - milestone counters
   - near-threshold alerts
   - intervention queue
3. **Ingestion Center**
   - upload PDFs
   - processing status
   - parse review table (low-confidence rows)
4. **Students**
   - searchable list
   - filters (grade, risk band, intervention status)
5. **Student Profile**
   - demerit/merit timeline
   - teacher comments stream
   - intervention history
6. **Policy Settings**
   - threshold and intervention rule editor
7. **Notifications Settings**
   - recipients
   - templates
   - digest settings
8. **Audit Logs**
   - ingestion/notification/policy evaluation events

## 3.2 UI State Strategy
- Server components for initial data fetch (if Next.js).
- Client components for interactive filters and review edits.
- Use URL query params for filter persistence.
- Optimistic UI only where audit risk is low.

## 3.3 Design Priorities
- Clear “at-risk students now” panel above fold.
- Color-coded threshold bands.
- One-click path from alert → student profile → mark intervention complete.

---

## 4) Backend Architecture

## 4.1 Services
1. **Ingestion Service**
   - accepts file upload metadata
   - orchestrates parser
   - writes staging + canonical records
2. **Parser Service**
   - PDF text extraction
   - section segmentation by student
   - event line parsing and confidence scoring
3. **Policy Engine Service**
   - computes cumulative demerits per student
   - determines warning/reached states
   - maps to intervention templates
4. **Notification Service**
   - sends emails
   - retries transient failures
   - logs outcomes
5. **Analytics Service**
   - computes dashboard aggregates
   - trend summaries
   - comment keyword/topic stats (basic MVP)

## 4.2 Storage Abstraction
Implement repository interfaces:
- `StudentRepository`
- `DisciplineEventRepository`
- `PolicyRepository`
- `InterventionRepository`
- `NotificationRepository`
- `IngestionRepository`

Adapters:
- **MVP:** Google Sheets adapter
- **v1+:** Supabase adapter

This prevents rewrite of business logic during migration.

---

## 5) Data Pipeline (MVP)
1. Admin uploads PDF(s).
2. File stored (temporary object storage/local dev storage).
3. Parsing job created (`IngestionJob: pending`).
4. Parser extracts candidate rows + confidence scores.
5. Low-confidence rows surfaced for human review.
6. Confirmed rows normalized into canonical event objects.
7. Upsert to Google Sheets tabs.
8. Policy engine executes for impacted students.
9. New warning/milestone states create intervention records.
10. Notification service sends emails and logs events.
11. Dashboard cache/materialized views refreshed.

---

## 6) Google Sheets MVP Schema Design
Use one spreadsheet with multiple tabs:

1. `students`
   - `student_id`, `external_id`, `full_name`, `grade`, `active`, `created_at`, `updated_at`
2. `discipline_events`
   - `event_id`, `student_id`, `event_type`, `points`, `reason`, `comment`, `teacher_name`, `occurred_at`, `source_job_id`, `fingerprint`
3. `policy_thresholds`
   - `threshold_id`, `label`, `base_threshold`, `offset`, `effective_value`, `intervention_template_id`, `is_warning`
4. `intervention_templates`
   - `template_id`, `name`, `description`, `sla_days`, `owner_role`
5. `student_interventions`
   - `student_intervention_id`, `student_id`, `threshold_id`, `status`, `due_date`, `completed_at`, `notes`
6. `notifications`
   - `notification_id`, `student_id`, `threshold_id`, `channel`, `recipient`, `status`, `provider_id`, `sent_at`, `error`
7. `ingestion_jobs`
   - `job_id`, `file_name`, `grade_hint`, `status`, `started_at`, `completed_at`, `rows_extracted`, `rows_flagged`
8. `ingestion_issues`
   - `issue_id`, `job_id`, `severity`, `context`, `message`, `resolved`

---

## 7) Policy Engine Design

## 7.1 Threshold Logic
- Let `D` = current demerit total for a student.
- Configurable base threshold `X`.
- Milestones: `X`, `X+5`, `X+10`, `X+20`, `X+30` (customizable array).
- Warning triggers per milestone: e.g., `milestone - 3`, `milestone - 1`.

## 7.2 State Transition Rules
- Trigger notification only on state transition (to avoid duplicates).
- Store last triggered state per student + milestone.
- If data corrections lower totals, engine should close/adjust open pending interventions based on policy.

## 7.3 Intervention Mapping
Each milestone links to intervention template(s), e.g.:
- `X`: parent call + counselor check-in
- `X+10`: formal behavior contract
- `X+20`: disciplinary hearing

(Exact actions configured from handbook once provided.)

---

## 8) Notification Blueprint
- Channel priority: Email (MVP), SMS optional future.
- Message template fields:
  - student name, grade, current demerits, milestone, required action, due date, dashboard link.
- Delivery rules:
  - immediate on transition, optional daily digest toggle.
- Reliability:
  - retry up to N times for transient failures.
  - dead-letter log for permanent failures.

---

## 9) PDF Parsing Strategy

## 9.1 Parsing Layers
1. **Text extraction layer:** extract page text blocks.
2. **Segmentation layer:** identify student headers and associated event lines.
3. **Entity extraction layer:** infer event type, reason, comment, points.
4. **Confidence scoring layer:** assign confidence per extracted field and row.
5. **Validation layer:** ensure required fields and dedupe fingerprint.

## 9.2 Human Review UX
- Show raw snippet + parsed fields side by side.
- Highlight uncertain tokens.
- Allow quick approve/edit/reject.
- Save correction feedback for parser improvements.

---

## 10) Security & Compliance
- Role-based auth for admin access.
- Encrypt credentials and API tokens.
- Avoid storing unnecessary sensitive student data.
- Keep audit logs immutable and timestamped.
- Align with local school data governance requirements.

---

## 11) Observability & Operations
- Structured logs with correlation IDs (job_id, student_id).
- Metrics:
  - parsing success/flag rates
  - ingestion throughput
  - policy trigger counts
  - notification send/failure rates
- Alerting on:
  - ingestion failures
  - notification provider outage
  - abnormal parse confidence drops

---

## 12) Release Plan

## Phase 0: Foundation
- repo setup, auth skeleton, UI shell, sheet adapter, env management.

## Phase 1: Ingestion MVP
- PDF upload + parsing + review + canonical ingest.

## Phase 2: Policy & Notifications
- threshold config UI + policy engine + email alerts.

## Phase 3: Dashboard & Intervention Tracking
- summary cards, drill-downs, intervention workflows.

## Phase 4: Hardening
- observability, QA, role refinement, performance tuning.

## Phase 5: Sycamore API + Supabase Migration (v1+)
- add SIS connector and swap storage adapter.

---

## 13) Migration Plan: Google Sheets → Supabase
1. Freeze schema contract at repository level.
2. Implement Supabase adapter behind same interfaces.
3. Build migration scripts to move tabs to relational tables.
4. Run dual-write (optional short period).
5. Verify record parity and dashboard parity.
6. Cutover reads to Supabase.

---

## 14) Technical Risks & Mitigations
- **Parser drift with report format changes:** version parser rules + fallback manual queue.
- **Google Sheets scaling constraints:** pagination, batched writes, and early adapter abstraction.
- **Duplicate notifications:** strict state transition checks + idempotency keys.
- **Ambiguous student identity:** enforce deterministic identity strategy (external ID preferred).

---

## 15) Suggested Initial Project Structure (Option A)

```text
/apps/web
  /app
    /dashboard
    /ingestion
    /students
    /settings
  /components
  /lib
    /domain
    /repositories
      /interfaces
      /sheets
      /supabase
    /services
      ingestion.service.ts
      parser.service.ts
      policy-engine.service.ts
      notification.service.ts
  /api
    /upload
    /jobs
    /notifications
/packages/shared
  /types
  /validation
```

---

## 16) Build/Buy Suggestions
- Buy: email delivery provider, authentication provider.
- Build: policy engine, parsing review UX, intervention workflow logic.

---

## 17) Final Recommendation
Start with **Option A (Next.js + TypeScript)** to maximize delivery speed and keep one JavaScript codebase. If parsing complexity becomes a bottleneck, isolate parser into a Python microservice (hybrid model) while keeping the main app in Next.js.
