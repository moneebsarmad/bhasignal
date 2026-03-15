import type {
  AuditEvent,
  IngestionSourceType,
  Intervention,
  Notification,
  Student
} from "@syc/domain";
import type { StorageRepositories } from "@syc/storage";

import { type DisciplineEventRecord, listDisciplineEvents } from "@/lib/discipline-events";

export interface StudentDirectoryFilters {
  search?: string;
  grade?: string;
  sourceType?: IngestionSourceType;
}

export interface StudentDirectoryRow {
  id: string;
  fullName: string;
  grade: string;
  totalPoints: number;
  incidentCount: number;
  interventionCount: number;
  lastIncidentAt: string | null;
}

export interface StudentIncidentRow {
  id: string;
  occurredAt: string;
  incidentDate: string | null;
  points: number;
  reason: string;
  comment: string;
  teacherName: string;
  authorName: string | null;
  resolution: string | null;
  sourceType: IngestionSourceType;
  level: number | null;
  violation: string | null;
}

export interface StudentDetailSnapshot {
  student: {
    id: string;
    fullName: string;
    grade: string;
    externalId: string | null;
  };
  guardianContacts: Array<{
    id: string;
    guardianName: string | null;
    relationship: string | null;
    email: string | null;
    phone: string | null;
    isPrimary: boolean;
    allowEmail: boolean;
    sourceType: string;
    isActive: boolean;
  }>;
  incidents: StudentIncidentRow[];
  interventions: Array<{
    id: string;
    milestoneLabel: string;
    status: string;
    dueDate: string;
    notes: string;
    assignedTo: string | null;
  }>;
  notifications: Array<{
    id: string;
    status: string;
    recipient: string;
    sentAt: string | null;
    kind: string;
    bandId: string | null;
    draftSubject: string | null;
    draftBody: string | null;
    approvedBy: string | null;
    approvedAt: string | null;
    suppressedReason: string | null;
    guardianContactId: string | null;
  }>;
  auditEvents: Array<{
    id: string;
    eventType: string;
    createdAt: string;
    actor: string;
  }>;
}

export const DEFAULT_STUDENT_SOURCE_TYPE: IngestionSourceType = "sycamore_api";

export function normalizeStudentSourceType(value: string | undefined): IngestionSourceType {
  return DEFAULT_STUDENT_SOURCE_TYPE;
}

function normalizeFilterValue(value: string | undefined): string {
  return value?.trim() || "";
}

function eventTimestamp(event: DisciplineEventRecord): string | null {
  return event.occurredAt ?? event.incidentDate;
}

function normalizeEventReason(event: DisciplineEventRecord): string {
  return event.violation ?? event.violationRaw ?? event.reason ?? "Unspecified incident";
}

function normalizeEventComment(event: DisciplineEventRecord): string {
  return event.description ?? event.resolution ?? "";
}

function normalizeEventTeacher(event: DisciplineEventRecord): string {
  return event.authorName ?? "Sycamore sync";
}

function sortByNewestTimestamp<T extends { occurredAt: string }>(left: T, right: T): number {
  return Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
}

function mapIncidentRow(event: DisciplineEventRecord): StudentIncidentRow {
  const occurredAt = eventTimestamp(event) ?? "1970-01-01T00:00:00.000Z";

  return {
    id: event.eventKey,
    occurredAt,
    incidentDate: event.incidentDate,
    points: event.points,
    reason: normalizeEventReason(event),
    comment: normalizeEventComment(event),
    teacherName: normalizeEventTeacher(event),
    authorName: event.authorName,
    resolution: event.resolution,
    sourceType: event.sourceType,
    level: event.level,
    violation: event.violation ?? event.violationRaw ?? event.reason
  };
}

function buildRelevantAuditEvents(
  auditEvents: AuditEvent[],
  student: Pick<Student, "id" | "externalId">
): StudentDetailSnapshot["auditEvents"] {
  return auditEvents
    .filter((event) => {
      if (event.entityType === "student" && event.entityId === student.id) {
        return true;
      }

      if (event.payloadJson.includes(student.id)) {
        return true;
      }

      return Boolean(student.externalId && event.payloadJson.includes(student.externalId));
    })
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 100)
    .map((event) => ({
      id: event.id,
      eventType: event.eventType,
      createdAt: event.createdAt,
      actor: event.actor
    }));
}

function mapInterventions(interventions: Intervention[]): StudentDetailSnapshot["interventions"] {
  return interventions
    .sort((left, right) => Date.parse(right.dueDate) - Date.parse(left.dueDate))
    .map((intervention) => ({
      id: intervention.id,
      milestoneLabel: intervention.milestoneLabel,
      status: intervention.status,
      dueDate: intervention.dueDate,
      notes: intervention.notes,
      assignedTo: intervention.assignedTo
    }));
}

function mapNotifications(notifications: Notification[]): StudentDetailSnapshot["notifications"] {
  return notifications
    .sort((left, right) => {
      const leftEpoch = Date.parse(left.sentAt ?? left.approvedAt ?? "1970-01-01T00:00:00.000Z");
      const rightEpoch = Date.parse(right.sentAt ?? right.approvedAt ?? "1970-01-01T00:00:00.000Z");
      return rightEpoch - leftEpoch;
    })
    .map((notification) => ({
      id: notification.id,
      status: notification.status,
      recipient: notification.recipient,
      sentAt: notification.sentAt,
      kind: notification.kind ?? "policy",
      bandId: notification.bandId ?? null,
      draftSubject: notification.draftSubject ?? null,
      draftBody: notification.draftBody ?? null,
      approvedBy: notification.approvedBy ?? null,
      approvedAt: notification.approvedAt ?? null,
      suppressedReason: notification.suppressedReason ?? null,
      guardianContactId: notification.guardianContactId ?? null
    }));
}

function mapGuardianContacts(contacts: Awaited<ReturnType<StorageRepositories["guardianContacts"]["listByStudent"]>>) {
  return contacts
    .sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) {
        return left.isPrimary ? -1 : 1;
      }
      return (left.guardianName ?? "").localeCompare(right.guardianName ?? "");
    })
    .map((contact) => ({
      id: contact.id,
      guardianName: contact.guardianName ?? null,
      relationship: contact.relationship ?? null,
      email: contact.email ?? null,
      phone: contact.phone ?? null,
      isPrimary: contact.isPrimary,
      allowEmail: contact.allowEmail,
      sourceType: contact.sourceType,
      isActive: contact.isActive
    }));
}

export async function buildStudentDirectoryRows(
  storage: StorageRepositories,
  filters: StudentDirectoryFilters
): Promise<StudentDirectoryRow[]> {
  const normalizedFilters = {
    search: normalizeFilterValue(filters.search).toLowerCase(),
    grade: normalizeFilterValue(filters.grade),
    sourceType: filters.sourceType ?? DEFAULT_STUDENT_SOURCE_TYPE
  };

  const [students, interventions, disciplineEvents] = await Promise.all([
    storage.students.list(),
    storage.interventions.list(),
    listDisciplineEvents(storage, undefined, { sourceType: normalizedFilters.sourceType })
  ]);

  const studentIdByExternalId = new Map(
    students
      .filter((student) => Boolean(student.externalId))
      .map((student) => [student.externalId as string, student.id] as const)
  );

  const aggregateByStudentId = new Map<
    string,
    {
      totalPoints: number;
      incidentCount: number;
      lastIncidentAt: string | null;
    }
  >();

  for (const event of disciplineEvents) {
    const resolvedStudentId = event.localStudentId ?? (event.studentExternalId ? studentIdByExternalId.get(event.studentExternalId) : null);
    if (!resolvedStudentId) {
      continue;
    }

    const aggregate =
      aggregateByStudentId.get(resolvedStudentId) ??
      {
        totalPoints: 0,
        incidentCount: 0,
        lastIncidentAt: null
      };
    aggregate.totalPoints += event.points;
    aggregate.incidentCount += 1;

    const timestamp = eventTimestamp(event);
    if (timestamp && (!aggregate.lastIncidentAt || Date.parse(timestamp) > Date.parse(aggregate.lastIncidentAt))) {
      aggregate.lastIncidentAt = timestamp;
    }

    aggregateByStudentId.set(resolvedStudentId, aggregate);
  }

  const interventionCountByStudentId = new Map<string, number>();
  for (const intervention of interventions) {
    interventionCountByStudentId.set(
      intervention.studentId,
      (interventionCountByStudentId.get(intervention.studentId) ?? 0) + 1
    );
  }

  return students
    .filter((student) => {
      if (normalizedFilters.grade && student.grade !== normalizedFilters.grade) {
        return false;
      }

      if (normalizedFilters.search && !student.fullName.toLowerCase().includes(normalizedFilters.search)) {
        return false;
      }

      return true;
    })
    .map((student) => {
      const aggregate = aggregateByStudentId.get(student.id);
      return {
        id: student.id,
        fullName: student.fullName,
        grade: student.grade,
        totalPoints: aggregate?.totalPoints ?? 0,
        incidentCount: aggregate?.incidentCount ?? 0,
        interventionCount: interventionCountByStudentId.get(student.id) ?? 0,
        lastIncidentAt: aggregate?.lastIncidentAt ?? null
      };
    })
    .sort((left, right) => {
      if (right.totalPoints !== left.totalPoints) {
        return right.totalPoints - left.totalPoints;
      }

      if (right.incidentCount !== left.incidentCount) {
        return right.incidentCount - left.incidentCount;
      }

      const rightLastIncident = right.lastIncidentAt ? Date.parse(right.lastIncidentAt) : 0;
      const leftLastIncident = left.lastIncidentAt ? Date.parse(left.lastIncidentAt) : 0;
      if (rightLastIncident !== leftLastIncident) {
        return rightLastIncident - leftLastIncident;
      }

      return left.fullName.localeCompare(right.fullName);
    });
}

export async function buildStudentDetailSnapshot(
  storage: StorageRepositories,
  studentId: string,
  sourceType: IngestionSourceType = DEFAULT_STUDENT_SOURCE_TYPE
): Promise<StudentDetailSnapshot | null> {
  const student = await storage.students.getById(studentId);
  if (!student) {
    return null;
  }

  const [disciplineEvents, interventions, notifications, auditEvents, guardianContacts] = await Promise.all([
    listDisciplineEvents(storage, undefined, {
      sourceType,
      localStudentId: student.id,
      studentExternalId: student.externalId ?? undefined
    }),
    storage.interventions.listByStudent(student.id),
    storage.notifications.listByStudent(student.id),
    storage.auditEvents.list(),
    storage.guardianContacts.listByStudent(student.id)
  ]);

  const incidents = disciplineEvents
    .filter(
      (event) =>
        event.localStudentId === student.id || Boolean(student.externalId && event.studentExternalId === student.externalId)
    )
    .map(mapIncidentRow)
    .sort(sortByNewestTimestamp);

  return {
    student: {
      id: student.id,
      fullName: student.fullName,
      grade: student.grade,
      externalId: student.externalId
    },
    guardianContacts: mapGuardianContacts(guardianContacts),
    incidents,
    interventions: mapInterventions(interventions),
    notifications: mapNotifications(notifications),
    auditEvents: buildRelevantAuditEvents(auditEvents, student)
  };
}
