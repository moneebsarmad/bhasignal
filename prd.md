# Product Requirements Document (PRD)
## Product: School Discipline Intelligence & Intervention Dashboard (MVP → v1)

## 1) Overview
The product is a web application for school administrators to monitor student discipline trends and intervene early based on policy-defined demerit milestones.

The system ingests discipline data (demerits, merits, reasons, teacher comments/notes, timestamps, grade levels, student metadata), stores it in a structured data model, evaluates policy thresholds, and notifies administrators when students are approaching or reaching intervention milestones.

### MVP Data Source
- **Primary MVP source:** Admin-uploaded PDF discipline reports by grade level (Grades 6–12).
- **MVP storage:** Google Sheets (used as operational data store).
- **MVP notifications:** Email-first notifications.

### Post-MVP / v1+
- Direct API integration with Sycamore SIS.
- Migration from Google Sheets to Supabase (Postgres).
- Expanded analytics and qualitative insight extraction from teacher comments.

---

## 2) Product Goals
1. Provide a single source of truth for discipline metrics and intervention status.
2. Automate milestone monitoring based on school demerit policy.
3. Trigger actionable alerts before and at milestone crossings.
4. Enable quantitative and qualitative analysis of discipline behavior over time.
5. Reduce manual effort from fragmented reports and ad hoc spreadsheets.

---

## 3) Problem Statement
Schools often receive discipline data in fragmented formats (SIS exports, PDF reports, comments embedded in narrative text). This makes it difficult to:
- Identify students nearing intervention thresholds.
- Enforce consistent intervention workflows.
- Track historical interventions and outcomes.
- Use teacher comments for pattern analysis.

The app solves this by standardizing ingestion, storing structured records, and applying policy logic to generate dashboard insights and alerts.

---

## 4) Users & Stakeholders
### Primary Users
- School administrators
- Principals / vice principals
- Student affairs / discipline coordinators

### Secondary Users (future)
- Counselors
- Grade-level leaders
- Deans

### Stakeholders
- School leadership
- IT/data operations team
- Compliance / safeguarding stakeholders

---

## 5) Scope

## In Scope (MVP)
- Secure admin login.
- PDF upload flow for discipline reports (grade-based, multi-page, semi-structured).
- Parsing and normalization of discipline records.
- Storage in Google Sheets with defined tab schema.
- Policy configuration for demerit intervention thresholds (e.g., X, X+5, X+10, X+20, etc.).
- Trigger logic for approaching milestones (e.g., X-3, X-1) and reached milestones.
- Email notifications to configured admin recipients.
- Dashboard with key counters and drill-down lists:
  - students at X
  - students at X+10/X+20/X+30
  - students near thresholds
  - grade-level breakdown
- Basic searchable student profile view including teacher comments.

## Out of Scope (MVP)
- Bi-directional SIS sync.
- Direct parent/student messaging.
- Complex role-based access beyond admin roles.
- Mobile native app.
- Fully automated NLP recommendations (manual review remains required).

## Future Scope (v1+)
- Sycamore API ingestion.
- Supabase migration and advanced relational analytics.
- SMS notifications.
- Advanced qualitative analytics (topic clustering, sentiment trends).
- Intervention effectiveness reporting over time.

---

## 6) Functional Requirements

### FR-1 Authentication & Access
- Admin users can sign in securely.
- Admin can manage notification recipients and school policy settings.

### FR-2 Data Ingestion (MVP PDF)
- Admin uploads one or multiple PDF reports.
- System extracts student-level records:
  - student name / identifier
  - grade
  - event type (merit/demerit)
  - infraction/reason
  - teacher comment/note
  - event date/time (if available)
- System flags low-confidence parsing rows for manual review.

### FR-3 Data Normalization & Storage
- Parsed records are transformed into normalized tables (represented in Google Sheets tabs for MVP):
  - Students
  - Discipline Events
  - Policies
  - Interventions
  - Notifications Log
  - Ingestion Jobs
- Prevent duplicate records via deterministic fingerprinting where possible.

### FR-4 Policy Engine
- Configurable threshold model:
  - Base threshold X
  - Additional thresholds (X+5, X+10, X+20, X+30...)
  - Near-threshold warnings (X-3, X-1)
- Policy links each threshold to required intervention action(s).
- Engine recalculates status after each ingestion run.

### FR-5 Notification System
- Trigger email notifications when student status changes into:
  - near-threshold states
  - threshold-reached states
- Include student summary, current count, threshold crossed, required intervention.
- Log all notifications and outcomes (sent/failed/retry).

### FR-6 Dashboard & Reports
- Summary cards for milestone counts.
- Filters by grade, timeframe, event type.
- Drill-down table of students with current demerit totals and latest comments.
- Student detail timeline of merits/demerits and notes.

### FR-7 Intervention Tracking
- Admin marks interventions as completed/pending/overdue.
- System stores timestamps and user attribution.
- Dashboard reflects intervention completion rate.

### FR-8 Auditability
- Track ingestion source file, parsing status, and row-level issues.
- Keep immutable event logs for notifications and policy evaluations.

---

## 7) Non-Functional Requirements
- **Security:** Encrypted data in transit; secure credential handling.
- **Reliability:** Graceful handling of malformed PDFs and parser fallbacks.
- **Performance:** MVP target for parsing + ingestion under 5 minutes for typical weekly batch.
- **Usability:** Minimal clicks to see “who needs intervention now.”
- **Maintainability:** Clear modular services for ingestion, policy engine, notifications.
- **Scalability:** Schema and service boundaries should ease migration to Supabase.

---

## 8) Data Model (Conceptual)
- **Student** (id, external_id, name, grade, status)
- **DisciplineEvent** (id, student_id, type, points, reason, comment, teacher, occurred_at, source_job_id)
- **PolicyThreshold** (id, label, threshold_value, trigger_offset, intervention_template_id)
- **InterventionTemplate** (id, name, description, owner_role, SLA_days)
- **StudentIntervention** (id, student_id, threshold_id, status, due_date, completed_at, assigned_to)
- **Notification** (id, student_id, threshold_id, channel, recipient, status, sent_at)
- **IngestionJob** (id, source_type, file_name, started_at, completed_at, status)
- **IngestionIssue** (id, job_id, severity, row_ref, message)

---

## 9) API Integration Requirements (Post-MVP)
When enabled, the Sycamore integration should:
- Pull discipline records incrementally.
- Support mapping of Sycamore entities to local canonical schema.
- Handle rate limiting and retries.
- Support idempotent upserts to avoid duplication.

Reference to evaluate during implementation:
- Sycamore School API repository: https://github.com/SycamoreEducation/SycamoreSchoolAPI

---

## 10) Key Workflows
1. **Upload reports:** Admin uploads grade-level PDFs.
2. **Parse + review:** System extracts records and surfaces ambiguous lines.
3. **Ingest:** Approved records are written to sheets.
4. **Evaluate policy:** Demerit totals and threshold statuses recalculated.
5. **Notify:** Email alerts are sent for warning/reached milestones.
6. **Act:** Admin performs intervention and marks completion.
7. **Monitor:** Dashboard displays live status and trends.

---

## 11) Success Metrics
- % of records parsed without manual correction.
- Time from report upload to intervention-ready dashboard.
- Notification delivery success rate.
- Reduction in missed intervention deadlines.
- Admin-reported usefulness of qualitative comment insights.

---

## 12) Risks & Mitigations
- **Semi-structured PDF variability:** Use confidence scoring + review queue.
- **Data quality inconsistencies:** Build dedupe rules and validation checks.
- **Policy ambiguity:** Provide configurable policy UI with versioning.
- **Notification fatigue:** Bundle alerts and allow digest options.

---

## 13) Open Questions
1. What exact demerit math should be used (net vs cumulative, expiration windows)?
2. Are merits subtractive, additive, or separate from demerits?
3. What is the canonical student ID source in MVP (name+grade fallback?)
4. Who receives alerts by default, and what cadence is acceptable?
5. Which interventions are mandatory at each milestone (from handbook)?

---

## 14) MVP Acceptance Criteria
- Admin can upload multiple PDF files and ingest parsed discipline events.
- Students’ demerit totals are visible and accurate in dashboard views.
- Policy thresholds can be configured and applied.
- Email alerts are sent for near-threshold and reached-threshold conditions.
- Admin can view and update intervention status per student.
- All core actions are logged (ingestion, policy trigger, notification).
