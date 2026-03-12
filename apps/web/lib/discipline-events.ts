import type { ApprovedIncident, IngestionSourceType, Student } from "@syc/domain";
import type { StorageRepositories } from "@syc/storage";

import { createSupabaseServerClient } from "@/lib/supabase-server-client";

export interface DisciplineEventRecord {
  eventKey: string;
  sourceType: IngestionSourceType;
  sourcePriority: number;
  sourceRecordId: string;
  studentId: string;
  localStudentId: string | null;
  studentExternalId: string | null;
  studentName: string | null;
  grade: string | null;
  incidentDate: string | null;
  occurredAt: string | null;
  points: number;
  level: number | null;
  violation: string | null;
  violationRaw: string | null;
  reason: string | null;
  description: string | null;
  resolution: string | null;
  authorName: string | null;
  sourceTable: string;
  sourceSyncedAt: string | null;
  isFallback: boolean;
  hasSourceConflict: boolean;
}

function hasSupabaseServiceRoleEnv(): boolean {
  return Boolean(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function toNullableString(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function dateOnlyFromApprovedIncident(incident: ApprovedIncident): string | null {
  const writeupDate = toNullableString(incident.writeupDate ?? undefined);
  if (writeupDate) {
    return writeupDate;
  }

  const occurredAt = toNullableString(incident.occurredAt);
  if (!occurredAt) {
    return null;
  }

  const parsed = Date.parse(occurredAt);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString().slice(0, 10);
}

function eventKeyForFallback(input: { sourceType: IngestionSourceType; sourceRecordId: string }): string {
  return `${input.sourceType}:${input.sourceRecordId}`;
}

function normalizedIdentifier(value: string | null): string | null {
  return value ? normalizeToken(value) : null;
}

function normalizedViolation(event: Pick<DisciplineEventRecord, "violation" | "violationRaw" | "reason">): string | null {
  const rawValue = event.violation ?? event.violationRaw ?? event.reason ?? null;
  return rawValue ? normalizeToken(rawValue) : null;
}

function disciplineEventsMatch(left: DisciplineEventRecord, right: DisciplineEventRecord): boolean {
  const leftLocalStudentId = normalizedIdentifier(left.localStudentId);
  const rightLocalStudentId = normalizedIdentifier(right.localStudentId);
  const leftExternalStudentId = normalizedIdentifier(left.studentExternalId);
  const rightExternalStudentId = normalizedIdentifier(right.studentExternalId);
  const leftStudentName = normalizedIdentifier(left.studentName);
  const rightStudentName = normalizedIdentifier(right.studentName);

  const sharesStudentIdentity =
    Boolean(leftLocalStudentId && rightLocalStudentId && leftLocalStudentId === rightLocalStudentId) ||
    Boolean(leftExternalStudentId && rightExternalStudentId && leftExternalStudentId === rightExternalStudentId) ||
    Boolean(leftStudentName && rightStudentName && leftStudentName === rightStudentName);

  if (!sharesStudentIdentity) {
    return false;
  }

  return (
    left.incidentDate === right.incidentDate &&
    left.points === right.points &&
    (left.level ?? null) === (right.level ?? null) &&
    normalizedViolation(left) === normalizedViolation(right)
  );
}

function parseDisciplineEventRow(row: Record<string, unknown>): DisciplineEventRecord {
  const nullable = (key: string): string | null => {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    return null;
  };
  const integer = (key: string): number => {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
    }
    return 0;
  };
  const nullableInteger = (key: string): number | null => {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }
    return null;
  };
  const booleanCell = (key: string): boolean => {
    const value = row[key];
    return value === true || value === "true" || value === "1" || value === 1;
  };

  const sourceType = nullable("source_type");
  if (sourceType !== "manual_pdf" && sourceType !== "sycamore_api") {
    throw new Error(`Invalid discipline_events source_type: ${sourceType ?? "null"}`);
  }

  return {
    eventKey: nullable("event_key") ?? "",
    sourceType,
    sourcePriority: integer("source_priority"),
    sourceRecordId: nullable("source_record_id") ?? "",
    studentId: nullable("student_id") ?? "",
    localStudentId: nullable("local_student_id"),
    studentExternalId: nullable("student_external_id"),
    studentName: nullable("student_name"),
    grade: nullable("grade"),
    incidentDate: nullable("incident_date"),
    occurredAt: nullable("occurred_at"),
    points: integer("points"),
    level: nullableInteger("level"),
    violation: nullable("violation"),
    violationRaw: nullable("violation_raw"),
    reason: nullable("reason"),
    description: nullable("description"),
    resolution: nullable("resolution"),
    authorName: nullable("author_name"),
    sourceTable: nullable("source_table") ?? "",
    sourceSyncedAt: nullable("source_synced_at"),
    isFallback: booleanCell("is_fallback"),
    hasSourceConflict: booleanCell("has_source_conflict")
  };
}

async function listDisciplineEventsFromSupabase(): Promise<DisciplineEventRecord[]> {
  const client = createSupabaseServerClient();
  const { data, error } = await client
    .from("discipline_events")
    .select("*")
    .order("incident_date", { ascending: false, nullsFirst: false })
    .order("source_priority", { ascending: true });

  if (error) {
    throw new Error(
      `Supabase select failed for table "discipline_events": ${error.message}. Apply the SQL in supabase/schema.sql first.`
    );
  }

  return ((data as Record<string, unknown>[] | null) ?? []).map(parseDisciplineEventRow);
}

async function listDisciplineEventsFromStorage(
  storage: StorageRepositories,
  input?: {
    approvedIncidents?: ApprovedIncident[];
    students?: Student[];
  }
): Promise<DisciplineEventRecord[]> {
  const [approvedIncidents, students] = await Promise.all([
    input?.approvedIncidents ? Promise.resolve(input.approvedIncidents) : storage.approvedIncidents.list(),
    input?.students ? Promise.resolve(input.students) : storage.students.list()
  ]);

  const studentsById = new Map(students.map((student) => [student.id, student] as const));
  const sycamoreEvents: DisciplineEventRecord[] = [];
  const manualPdfEvents: DisciplineEventRecord[] = [];

  for (const incident of approvedIncidents) {
    const student = studentsById.get(incident.studentId);
    const incidentDate = dateOnlyFromApprovedIncident(incident);
    const event: DisciplineEventRecord = {
      eventKey: eventKeyForFallback({
        sourceType: incident.sourceType,
        sourceRecordId: incident.sourceRecordId
      }),
      sourceType: incident.sourceType,
      sourcePriority: incident.sourceType === "sycamore_api" ? 1 : 2,
      sourceRecordId: incident.sourceRecordId,
      studentId: incident.studentId,
      localStudentId: incident.studentId,
      studentExternalId: incident.externalStudentId ?? student?.externalId ?? null,
      studentName: student?.fullName ?? null,
      grade: toNullableString(incident.gradeAtEvent ?? student?.grade ?? null),
      incidentDate,
      occurredAt: toNullableString(incident.occurredAt),
      points: incident.points,
      level: incident.level ?? null,
      violation: incident.violation ?? incident.reason ?? null,
      violationRaw: incident.violationRaw ?? incident.violation ?? incident.reason ?? null,
      reason: incident.reason,
      description: incident.description ?? incident.comment,
      resolution: incident.resolution ?? null,
      authorName: incident.authorName ?? incident.authorNameRaw ?? incident.teacherName ?? null,
      sourceTable: "incidents_approved",
      sourceSyncedAt: incident.reviewedAt,
      isFallback: incident.sourceType === "manual_pdf",
      hasSourceConflict: false
    };

    if (incident.sourceType === "sycamore_api") {
      sycamoreEvents.push(event);
      continue;
    }

    manualPdfEvents.push(event);
  }

  for (const event of sycamoreEvents) {
    event.hasSourceConflict = manualPdfEvents.some((manualEvent) => disciplineEventsMatch(event, manualEvent));
  }

  const fallbackPdfEvents = manualPdfEvents.filter(
    (event) => !sycamoreEvents.some((sycamoreEvent) => disciplineEventsMatch(sycamoreEvent, event))
  );

  return [...sycamoreEvents, ...fallbackPdfEvents].sort((left, right) => {
    const dateComparison = (right.incidentDate ?? "").localeCompare(left.incidentDate ?? "");
    if (dateComparison !== 0) {
      return dateComparison;
    }

    if (left.sourcePriority !== right.sourcePriority) {
      return left.sourcePriority - right.sourcePriority;
    }

    return left.sourceRecordId.localeCompare(right.sourceRecordId);
  });
}

export async function listDisciplineEvents(
  storage: StorageRepositories,
  input?: {
    approvedIncidents?: ApprovedIncident[];
    students?: Student[];
  }
): Promise<DisciplineEventRecord[]> {
  if (hasSupabaseServiceRoleEnv()) {
    return listDisciplineEventsFromSupabase();
  }

  return listDisciplineEventsFromStorage(storage, input);
}
