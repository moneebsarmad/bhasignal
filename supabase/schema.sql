create extension if not exists pgcrypto;

create table if not exists public.students (
  id text primary key,
  external_id text null,
  full_name text not null,
  grade text not null,
  active boolean not null default true,
  created_at text not null,
  updated_at text not null
);

create table if not exists public.guardian_contacts (
  id text primary key,
  student_id text not null references public.students (id),
  guardian_name text null,
  relationship text null,
  email text null,
  phone text null,
  is_primary boolean not null default false,
  allow_email boolean not null default true,
  source_type text not null default 'manual',
  source_record_id text null,
  last_synced_at text null,
  is_active boolean not null default true,
  notes text not null default ''
);

create index if not exists guardian_contacts_student_idx on public.guardian_contacts (student_id);
create index if not exists guardian_contacts_email_idx on public.guardian_contacts (email);
create index if not exists guardian_contacts_active_idx on public.guardian_contacts (is_active, allow_email);

create table if not exists public.incidents_raw (
  id text primary key,
  parse_run_id text not null,
  source_type text not null default 'manual_pdf',
  source_record_id text not null default 'legacy_raw',
  student_reference text not null,
  external_student_id text null,
  grade_at_event text null,
  event_type text null,
  occurred_at text not null,
  writeup_date date null,
  points integer not null default 0,
  reason text not null,
  violation text null,
  violation_raw text null,
  level integer null,
  comment text not null,
  description text null,
  resolution text null,
  teacher_name text not null,
  author_name text null,
  author_name_raw text null,
  source_payload_json text not null default '{}',
  mapping_warnings_json text not null default '[]',
  confidence_json text not null,
  status text not null
);

alter table public.incidents_raw add column if not exists source_type text not null default 'manual_pdf';
alter table public.incidents_raw add column if not exists source_record_id text not null default 'legacy_raw';
alter table public.incidents_raw add column if not exists external_student_id text null;
alter table public.incidents_raw add column if not exists grade_at_event text null;
alter table public.incidents_raw add column if not exists event_type text null;
alter table public.incidents_raw add column if not exists writeup_date date null;
alter table public.incidents_raw add column if not exists violation text null;
alter table public.incidents_raw add column if not exists violation_raw text null;
alter table public.incidents_raw add column if not exists level integer null;
alter table public.incidents_raw add column if not exists description text null;
alter table public.incidents_raw add column if not exists resolution text null;
alter table public.incidents_raw add column if not exists author_name text null;
alter table public.incidents_raw add column if not exists author_name_raw text null;
alter table public.incidents_raw add column if not exists source_payload_json text not null default '{}';
alter table public.incidents_raw add column if not exists mapping_warnings_json text not null default '[]';

create index if not exists incidents_raw_parse_run_idx on public.incidents_raw (parse_run_id);
create index if not exists incidents_raw_status_idx on public.incidents_raw (status);
create index if not exists incidents_raw_source_type_idx on public.incidents_raw (source_type);
create index if not exists incidents_raw_source_record_idx on public.incidents_raw (source_type, source_record_id);
create index if not exists incidents_raw_writeup_date_idx on public.incidents_raw (writeup_date);
create index if not exists incidents_raw_level_idx on public.incidents_raw (level);
create index if not exists incidents_raw_violation_idx on public.incidents_raw (violation);

create table if not exists public.incidents_approved (
  id text primary key,
  student_id text not null,
  source_type text not null default 'manual_pdf',
  source_record_id text not null default 'legacy_approved',
  external_student_id text null,
  grade_at_event text null,
  event_type text null,
  occurred_at text not null,
  writeup_date date null,
  points integer not null default 0,
  reason text not null,
  violation text null,
  violation_raw text null,
  level integer null,
  comment text not null,
  description text null,
  resolution text null,
  teacher_name text not null,
  author_name text null,
  author_name_raw text null,
  source_job_id text not null,
  fingerprint text not null unique,
  reviewed_by text not null,
  reviewed_at text not null
);

alter table public.incidents_approved add column if not exists source_type text not null default 'manual_pdf';
alter table public.incidents_approved add column if not exists source_record_id text not null default 'legacy_approved';
alter table public.incidents_approved add column if not exists external_student_id text null;
alter table public.incidents_approved add column if not exists grade_at_event text null;
alter table public.incidents_approved add column if not exists event_type text null;
alter table public.incidents_approved add column if not exists writeup_date date null;
alter table public.incidents_approved add column if not exists violation text null;
alter table public.incidents_approved add column if not exists violation_raw text null;
alter table public.incidents_approved add column if not exists level integer null;
alter table public.incidents_approved add column if not exists description text null;
alter table public.incidents_approved add column if not exists resolution text null;
alter table public.incidents_approved add column if not exists author_name text null;
alter table public.incidents_approved add column if not exists author_name_raw text null;

create index if not exists incidents_approved_student_idx on public.incidents_approved (student_id);
create index if not exists incidents_approved_source_job_idx on public.incidents_approved (source_job_id);
create index if not exists incidents_approved_source_type_idx on public.incidents_approved (source_type);
create index if not exists incidents_approved_source_record_idx on public.incidents_approved (source_type, source_record_id);
create index if not exists incidents_approved_writeup_date_idx on public.incidents_approved (writeup_date);
create index if not exists incidents_approved_level_idx on public.incidents_approved (level);
create index if not exists incidents_approved_violation_idx on public.incidents_approved (violation);
create index if not exists incidents_approved_external_student_id_idx on public.incidents_approved (external_student_id);

create table if not exists public.parse_runs (
  id text primary key,
  source_type text not null default 'manual_pdf',
  file_name text not null,
  uploaded_by text not null,
  triggered_by text not null default 'system',
  metadata_json text not null default '{}',
  cursor_json text null,
  status text not null,
  rows_extracted integer not null default 0,
  rows_flagged integer not null default 0,
  started_at text not null,
  completed_at text null
);

alter table public.parse_runs add column if not exists source_type text not null default 'manual_pdf';
alter table public.parse_runs add column if not exists triggered_by text not null default 'system';
alter table public.parse_runs add column if not exists metadata_json text not null default '{}';
alter table public.parse_runs add column if not exists cursor_json text null;

create index if not exists parse_runs_status_idx on public.parse_runs (status);
create index if not exists parse_runs_source_type_idx on public.parse_runs (source_type);

create table if not exists public.review_tasks (
  id text primary key,
  parse_run_id text not null,
  raw_incident_id text not null,
  assignee text null,
  status text not null,
  resolution text not null,
  created_at text not null,
  resolved_at text null
);

create index if not exists review_tasks_parse_run_idx on public.review_tasks (parse_run_id);
create index if not exists review_tasks_status_idx on public.review_tasks (status);

create table if not exists public.policies (
  version integer primary key,
  base_threshold integer not null,
  warning_offsets jsonb not null default '[]'::jsonb,
  milestones jsonb not null default '[]'::jsonb,
  intervention_templates text not null,
  created_by text not null,
  created_at text not null
);

create table if not exists public.interventions (
  id text primary key,
  student_id text not null,
  policy_version integer not null,
  milestone_label text not null,
  status text not null,
  due_date text not null,
  completed_at text null,
  assigned_to text null,
  notes text not null default ''
);

create index if not exists interventions_student_idx on public.interventions (student_id);
create index if not exists interventions_status_idx on public.interventions (status);

create table if not exists public.notifications (
  id text primary key,
  student_id text not null,
  intervention_id text not null,
  channel text not null,
  recipient text not null,
  status text not null,
  provider_id text not null,
  sent_at text null,
  error text not null default ''
);

alter table public.notifications add column if not exists kind text null default 'policy';
alter table public.notifications add column if not exists band_id text null;
alter table public.notifications add column if not exists template_key text null;
alter table public.notifications add column if not exists draft_subject text null;
alter table public.notifications add column if not exists draft_body text null;
alter table public.notifications add column if not exists approved_by text null;
alter table public.notifications add column if not exists approved_at text null;
alter table public.notifications add column if not exists suppressed_at text null;
alter table public.notifications add column if not exists suppressed_reason text null;
alter table public.notifications add column if not exists guardian_contact_id text null references public.guardian_contacts (id);
alter table public.notifications add column if not exists metadata_json text not null default '{}';

create index if not exists notifications_student_idx on public.notifications (student_id);
create index if not exists notifications_status_idx on public.notifications (status);
create index if not exists notifications_kind_idx on public.notifications (kind);
create index if not exists notifications_guardian_contact_idx on public.notifications (guardian_contact_id);

create table if not exists public.audit_events (
  id text primary key,
  event_type text not null,
  entity_type text not null,
  entity_id text not null,
  actor text not null,
  payload_json text not null,
  created_at text not null
);

create index if not exists audit_events_entity_idx on public.audit_events (entity_type, entity_id);
create index if not exists audit_events_created_idx on public.audit_events (created_at);

create table if not exists public.sycamore_discipline_logs (
  id uuid primary key default gen_random_uuid(),
  sycamore_log_id text unique not null,
  student_id text not null,
  student_record_id text null references public.students (id),
  student_name text null,
  grade text null,
  school_id text not null,
  incident_date date null,
  points integer not null default 0,
  level integer null,
  violation text null,
  violation_raw text null,
  incident_type text null,
  description text null,
  resolution text null,
  consequence text null,
  author_name text null,
  author_name_raw text null,
  assigned_by text null,
  quarter text null,
  created_at_sycamore timestamptz null,
  manager_notified boolean null,
  family_notified boolean null,
  student_notified boolean null,
  detention_id text null,
  raw_payload jsonb not null default '{}'::jsonb,
  detention_payload jsonb null,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.sycamore_discipline_logs add column if not exists student_record_id text null references public.students (id);
alter table public.sycamore_discipline_logs add column if not exists points integer not null default 0;
alter table public.sycamore_discipline_logs add column if not exists level integer null;
alter table public.sycamore_discipline_logs add column if not exists violation text null;
alter table public.sycamore_discipline_logs add column if not exists violation_raw text null;
alter table public.sycamore_discipline_logs add column if not exists resolution text null;
alter table public.sycamore_discipline_logs add column if not exists author_name text null;
alter table public.sycamore_discipline_logs add column if not exists author_name_raw text null;
alter table public.sycamore_discipline_logs add column if not exists quarter text null;
alter table public.sycamore_discipline_logs add column if not exists created_at_sycamore timestamptz null;
alter table public.sycamore_discipline_logs add column if not exists manager_notified boolean null;
alter table public.sycamore_discipline_logs add column if not exists family_notified boolean null;
alter table public.sycamore_discipline_logs add column if not exists student_notified boolean null;
alter table public.sycamore_discipline_logs add column if not exists detention_payload jsonb null;
alter table public.sycamore_discipline_logs add column if not exists raw_payload jsonb not null default '{}'::jsonb;
alter table public.sycamore_discipline_logs add column if not exists synced_at timestamptz not null default now();
alter table public.sycamore_discipline_logs add column if not exists created_at timestamptz not null default now();

with sycamore_backfill_source as (
  select
    id,
    coalesce(
      nullif(raw_payload -> 'disciplineDetail' ->> 'Violation', ''),
      nullif(raw_payload -> 'listEntry' ->> 'Violation', ''),
      nullif(incident_type, '')
    ) as violation_raw_source,
    coalesce(
      nullif(raw_payload -> 'disciplineDetail' ->> 'Resolution', ''),
      nullif(raw_payload -> 'disciplineDetail' ->> 'Consequence', ''),
      nullif(raw_payload -> 'listEntry' ->> 'Resolution', ''),
      nullif(raw_payload -> 'listEntry' ->> 'Consequence', ''),
      nullif(consequence, '')
    ) as resolution_source,
    coalesce(
      nullif(raw_payload -> 'disciplineDetail' ->> 'Author', ''),
      nullif(raw_payload -> 'disciplineDetail' ->> 'AssignedBy', ''),
      nullif(raw_payload -> 'listEntry' ->> 'Author', ''),
      nullif(raw_payload -> 'listEntry' ->> 'AssignedBy', ''),
      nullif(assigned_by, '')
    ) as author_raw_source,
    coalesce(
      nullif(raw_payload -> 'disciplineDetail' ->> 'Quarter', ''),
      nullif(raw_payload -> 'listEntry' ->> 'Quarter', ''),
      nullif(quarter, '')
    ) as quarter_source,
    case
      when regexp_replace(
        coalesce(raw_payload -> 'disciplineDetail' ->> 'Points', raw_payload -> 'listEntry' ->> 'Points', ''),
        '[^0-9+-]',
        '',
        'g'
      ) ~ '^[+-]?\d+$'
        then regexp_replace(
          coalesce(raw_payload -> 'disciplineDetail' ->> 'Points', raw_payload -> 'listEntry' ->> 'Points', ''),
          '[^0-9+-]',
          '',
          'g'
        )::integer
      else null
    end as points_source
  from public.sycamore_discipline_logs
),
sycamore_backfill_normalized as (
  select
    id,
    violation_raw_source,
    case
      when violation_raw_source ~* '^\s*level\s*[+-]?\d+\s*[:\-]\s*.+$'
        then ((regexp_match(violation_raw_source, '^\s*level\s*([+-]?\d+)\s*[:\-]\s*(.+)$', 'i'))[1])::integer
      else null
    end as level_source,
    case
      when violation_raw_source ~* '^\s*level\s*[+-]?\d+\s*[:\-]\s*.+$'
        then btrim((regexp_match(violation_raw_source, '^\s*level\s*([+-]?\d+)\s*[:\-]\s*(.+)$', 'i'))[2])
      else violation_raw_source
    end as violation_source,
    resolution_source,
    author_raw_source,
    case
      when author_raw_source is null then null
      when author_raw_source ~ ','
        then btrim(regexp_replace(author_raw_source, '^\s*([^,]+),\s*(.+?)\s*$', '\2 \1'))
      else author_raw_source
    end as author_name_source,
    quarter_source,
    points_source
  from sycamore_backfill_source
)
update public.sycamore_discipline_logs as logs
set
  points = case
    when logs.points = 0 and normalized.points_source is not null then normalized.points_source
    else logs.points
  end,
  level = coalesce(logs.level, normalized.level_source),
  violation = coalesce(logs.violation, normalized.violation_source),
  violation_raw = coalesce(logs.violation_raw, normalized.violation_raw_source),
  incident_type = coalesce(logs.incident_type, normalized.violation_raw_source, normalized.violation_source),
  resolution = coalesce(logs.resolution, normalized.resolution_source),
  consequence = coalesce(logs.consequence, normalized.resolution_source),
  author_name = coalesce(logs.author_name, normalized.author_name_source, normalized.author_raw_source),
  author_name_raw = coalesce(logs.author_name_raw, normalized.author_raw_source),
  assigned_by = coalesce(logs.assigned_by, normalized.author_name_source, normalized.author_raw_source),
  quarter = coalesce(logs.quarter, normalized.quarter_source)
from sycamore_backfill_normalized as normalized
where logs.id = normalized.id;

create index if not exists sycamore_discipline_logs_log_idx on public.sycamore_discipline_logs (sycamore_log_id);
create index if not exists sycamore_discipline_logs_student_idx on public.sycamore_discipline_logs (student_id);
create index if not exists sycamore_discipline_logs_student_record_idx on public.sycamore_discipline_logs (student_record_id);
create index if not exists sycamore_discipline_logs_incident_date_idx on public.sycamore_discipline_logs (incident_date);
create index if not exists sycamore_discipline_logs_level_idx on public.sycamore_discipline_logs (level);
create index if not exists sycamore_discipline_logs_violation_idx on public.sycamore_discipline_logs (violation);
create index if not exists sycamore_discipline_logs_author_name_idx on public.sycamore_discipline_logs (author_name);
create index if not exists sycamore_discipline_logs_school_idx on public.sycamore_discipline_logs (school_id);
create index if not exists sycamore_discipline_logs_created_at_sycamore_idx on public.sycamore_discipline_logs (created_at_sycamore);
create index if not exists sycamore_discipline_logs_synced_at_idx on public.sycamore_discipline_logs (synced_at);
create index if not exists sycamore_discipline_logs_match_idx
  on public.sycamore_discipline_logs (student_id, incident_date, points, level);

create table if not exists public.sycamore_sync_log (
  id uuid primary key default gen_random_uuid(),
  triggered_by text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  records_synced integer not null default 0,
  records_discovered integer not null default 0,
  records_upserted integer not null default 0,
  status text not null,
  sync_mode text null,
  window_start_date date null,
  window_end_date date null,
  error_message text null
);

alter table public.sycamore_sync_log add column if not exists records_discovered integer not null default 0;
alter table public.sycamore_sync_log add column if not exists records_upserted integer not null default 0;
alter table public.sycamore_sync_log add column if not exists sync_mode text null;
alter table public.sycamore_sync_log add column if not exists window_start_date date null;
alter table public.sycamore_sync_log add column if not exists window_end_date date null;

create index if not exists sycamore_sync_log_started_at_idx on public.sycamore_sync_log (started_at);
create index if not exists sycamore_sync_log_completed_at_idx on public.sycamore_sync_log (completed_at);
create index if not exists sycamore_sync_log_status_idx on public.sycamore_sync_log (status);
create index if not exists sycamore_sync_log_window_idx on public.sycamore_sync_log (window_start_date, window_end_date);

create table if not exists public.sycamore_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id text not null,
  sequence_index integer not null default 0,
  total_jobs integer not null default 1,
  triggered_by text not null,
  request_payload jsonb not null default '{}'::jsonb,
  sync_mode text not null,
  window_start_date date not null,
  window_end_date date not null,
  status text not null,
  result_status text null,
  sync_log_id uuid null references public.sycamore_sync_log (id),
  progress_payload jsonb null,
  records_discovered integer not null default 0,
  records_upserted integer not null default 0,
  warnings_json jsonb not null default '[]'::jsonb,
  warnings_count integer not null default 0,
  attempt_count integer not null default 0,
  started_at timestamptz null,
  completed_at timestamptz null,
  last_heartbeat_at timestamptz null,
  error_message text null,
  created_at timestamptz not null default now()
);

create index if not exists sycamore_sync_jobs_batch_idx on public.sycamore_sync_jobs (batch_id, sequence_index);
create index if not exists sycamore_sync_jobs_status_idx on public.sycamore_sync_jobs (status);
create index if not exists sycamore_sync_jobs_created_at_idx on public.sycamore_sync_jobs (created_at);
create index if not exists sycamore_sync_jobs_heartbeat_idx on public.sycamore_sync_jobs (last_heartbeat_at);
create index if not exists sycamore_sync_jobs_window_idx on public.sycamore_sync_jobs (window_start_date, window_end_date);

create index if not exists students_external_id_idx on public.students (external_id);

create or replace function public.normalize_discipline_token(value text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(lower(btrim(coalesce(value, ''))), '\s+', ' ', 'g'), '');
$$;

drop view if exists public.discipline_events;

create view public.discipline_events as
with sycamore_source as (
  select
    md5(concat_ws('|', 'sycamore_api', logs.sycamore_log_id)) as event_key,
    'sycamore_api'::text as source_type,
    1::integer as source_priority,
    logs.sycamore_log_id as source_record_id,
    coalesce(logs.student_record_id, 'sycamore:' || logs.student_id) as student_id,
    logs.student_record_id as local_student_id,
    logs.student_id as student_external_id,
    coalesce(logs.student_name, students.full_name) as student_name,
    coalesce(logs.grade, students.grade) as grade,
    logs.incident_date::text as incident_date,
    coalesce(logs.created_at_sycamore, logs.synced_at, logs.created_at)::text as occurred_at,
    logs.points,
    logs.level,
    logs.violation,
    coalesce(logs.violation_raw, logs.incident_type, logs.violation) as violation_raw,
    coalesce(logs.violation, logs.violation_raw, logs.incident_type) as reason,
    logs.description,
    coalesce(logs.resolution, logs.consequence) as resolution,
    coalesce(logs.author_name, logs.author_name_raw, logs.assigned_by) as author_name,
    'sycamore_discipline_logs'::text as source_table,
    logs.synced_at::text as source_synced_at,
    false as is_fallback,
    public.normalize_discipline_token(logs.student_record_id) as match_local_student_id,
    public.normalize_discipline_token(logs.student_id) as match_external_student_id,
    public.normalize_discipline_token(coalesce(logs.student_name, students.full_name)) as match_student_name,
    coalesce(logs.incident_date::text, substring(coalesce(logs.created_at_sycamore, logs.synced_at, logs.created_at)::text from 1 for 10), '') as match_incident_date,
    logs.points as match_points,
    logs.level as match_level,
    coalesce(
      public.normalize_discipline_token(logs.violation),
      public.normalize_discipline_token(logs.violation_raw),
      public.normalize_discipline_token(logs.incident_type)
    ) as match_violation_key
  from public.sycamore_discipline_logs as logs
  left join public.students as students on students.id = logs.student_record_id
),
pdf_source as (
  select
    md5(concat_ws('|', 'manual_pdf', approved.source_record_id)) as event_key,
    'manual_pdf'::text as source_type,
    2::integer as source_priority,
    approved.source_record_id as source_record_id,
    approved.student_id as student_id,
    approved.student_id as local_student_id,
    coalesce(approved.external_student_id, students.external_id) as student_external_id,
    students.full_name as student_name,
    coalesce(approved.grade_at_event, students.grade) as grade,
    coalesce(approved.writeup_date::text, substring(approved.occurred_at from 1 for 10)) as incident_date,
    approved.occurred_at as occurred_at,
    approved.points,
    approved.level,
    approved.violation,
    coalesce(approved.violation_raw, approved.violation, approved.reason) as violation_raw,
    coalesce(approved.violation, approved.reason, approved.violation_raw) as reason,
    coalesce(approved.description, nullif(approved.comment, '')) as description,
    approved.resolution,
    coalesce(approved.author_name, approved.author_name_raw, nullif(approved.teacher_name, '')) as author_name,
    'incidents_approved'::text as source_table,
    approved.reviewed_at as source_synced_at,
    true as is_fallback,
    public.normalize_discipline_token(approved.student_id) as match_local_student_id,
    coalesce(
      public.normalize_discipline_token(approved.external_student_id),
      public.normalize_discipline_token(students.external_id)
    ) as match_external_student_id,
    public.normalize_discipline_token(students.full_name) as match_student_name,
    coalesce(approved.writeup_date::text, substring(approved.occurred_at from 1 for 10), '') as match_incident_date,
    approved.points as match_points,
    approved.level as match_level,
    coalesce(
      public.normalize_discipline_token(approved.violation),
      public.normalize_discipline_token(approved.violation_raw),
      public.normalize_discipline_token(approved.reason)
    ) as match_violation_key
  from public.incidents_approved as approved
  left join public.students as students on students.id = approved.student_id
  where approved.source_type = 'manual_pdf'
),
sycamore_canonical as (
  select
    source.*,
    exists(
      select 1
      from pdf_source
      where pdf_source.match_incident_date = source.match_incident_date
        and pdf_source.match_points = source.match_points
        and pdf_source.match_level is not distinct from source.match_level
        and pdf_source.match_violation_key is not distinct from source.match_violation_key
        and (
          (pdf_source.match_local_student_id is not null and pdf_source.match_local_student_id = source.match_local_student_id) or
          (pdf_source.match_external_student_id is not null and pdf_source.match_external_student_id = source.match_external_student_id) or
          (pdf_source.match_student_name is not null and pdf_source.match_student_name = source.match_student_name)
        )
    ) as has_source_conflict
  from sycamore_source as source
),
pdf_fallback as (
  select
    source.*,
    false as has_source_conflict
  from pdf_source as source
  where not exists (
    select 1
    from sycamore_source
    where sycamore_source.match_incident_date = source.match_incident_date
      and sycamore_source.match_points = source.match_points
      and sycamore_source.match_level is not distinct from source.match_level
      and sycamore_source.match_violation_key is not distinct from source.match_violation_key
      and (
        (sycamore_source.match_local_student_id is not null and sycamore_source.match_local_student_id = source.match_local_student_id) or
        (sycamore_source.match_external_student_id is not null and sycamore_source.match_external_student_id = source.match_external_student_id) or
        (sycamore_source.match_student_name is not null and sycamore_source.match_student_name = source.match_student_name)
      )
  )
)
select
  event_key,
  source_type,
  source_priority,
  source_record_id,
  student_id,
  local_student_id,
  student_external_id,
  student_name,
  grade,
  incident_date,
  occurred_at,
  points,
  level,
  violation,
  violation_raw,
  reason,
  description,
  resolution,
  author_name,
  source_table,
  source_synced_at,
  is_fallback,
  has_source_conflict
from sycamore_canonical
union all
select
  event_key,
  source_type,
  source_priority,
  source_record_id,
  student_id,
  local_student_id,
  student_external_id,
  student_name,
  grade,
  incident_date,
  occurred_at,
  points,
  level,
  violation,
  violation_raw,
  reason,
  description,
  resolution,
  author_name,
  source_table,
  source_synced_at,
  is_fallback,
  has_source_conflict
from pdf_fallback;

revoke all on public.discipline_events from anon, authenticated;
grant select on public.discipline_events to service_role;

alter table public.sycamore_discipline_logs enable row level security;
alter table public.sycamore_sync_log enable row level security;
alter table public.sycamore_sync_jobs enable row level security;

drop policy if exists sycamore_discipline_logs_deny_all on public.sycamore_discipline_logs;
create policy sycamore_discipline_logs_deny_all
  on public.sycamore_discipline_logs
  for all
  using (false)
  with check (false);

drop policy if exists sycamore_sync_log_deny_all on public.sycamore_sync_log;
create policy sycamore_sync_log_deny_all
  on public.sycamore_sync_log
  for all
  using (false)
  with check (false);

drop policy if exists sycamore_sync_jobs_deny_all on public.sycamore_sync_jobs;
create policy sycamore_sync_jobs_deny_all
  on public.sycamore_sync_jobs
  for all
  using (false)
  with check (false);
