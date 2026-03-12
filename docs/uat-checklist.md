# UAT Checklist

## Auth & Access
- Admin login succeeds.
- Reviewer login succeeds.
- Reviewer cannot access admin-only policy/notifications actions.

## Ingestion
- Upload valid PDF creates parse run.
- Parse run reaches `review_required` or `completed`.
- Failed parse run can be retried without duplicate approved incidents.

## Review Workflow
- Reviewer can approve row.
- Reviewer can edit and approve row.
- Reviewer can reject row.
- Approved rows appear in `incidents_approved`.

## Policy & Interventions
- Create policy version with `X`, warning offsets, milestones.
- Evaluate policy creates expected interventions.
- Re-evaluation does not duplicate interventions.
- Downward correction closes active interventions safely.

## Notifications
- Policy evaluation queues notifications.
- Dispatch sends queued notifications.
- Failed sends are retried and dead-lettered when attempts exhausted.
- Manual override queue creates explicit audit event.

## Dashboard & Auditability
- Dashboard KPI cards render with expected counts.
- Student profile shows incidents/interventions/notifications timeline.
- Audit explorer can filter by event/entity/actor/date.
