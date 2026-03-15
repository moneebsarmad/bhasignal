import type { IngestionSourceType } from "@syc/domain";
import type { StorageRepositories } from "@syc/storage";

import { type DisciplineEventRecord, listDisciplineEvents } from "@/lib/discipline-events";
import {
  demeritEscalationBands,
  getDemeritEscalationBand,
  type DemeritEscalationBandId
} from "@/lib/demerit-escalation";
import { parseRunStatusSummary } from "@/lib/policies";

export interface DashboardFilters {
  grade?: string;
  sourceType?: IngestionSourceType;
}

export interface DashboardSnapshot {
  filters: {
    grade: string;
    sourceType: string;
  };
  metrics: {
    studentsTracked: number;
    incidentsTracked: number;
    totalPoints: number;
    studentsAt10Plus: number;
    studentsAt35Plus: number;
    openInterventions: number;
    queuedNotifications: number;
    failedNotifications: number;
    parentOutreachDraftsPending: number;
    approvedParentOutreach: number;
    studentsMissingParentEmailAt10To19: number;
  };
  bandCounts: Array<{
    id: DemeritEscalationBandId;
    label: string;
    shortLabel: string;
    tone: "neutral" | "info" | "success" | "warning" | "danger";
    count: number;
    parentCommunication: string;
    adminAction: string;
  }>;
  actionQueue: Array<{
    studentId: string;
    fullName: string;
    grade: string;
    totalPoints: number;
    currentBandId: DemeritEscalationBandId;
    currentBandLabel: string;
    currentBandTone: "neutral" | "info" | "success" | "warning" | "danger";
    parentCommunication: string;
    adminAction: string;
    adminMessage: string;
    policyImpact: string;
    latestIncidentAt: string | null;
    activeInterventions: number;
    queuedNotifications: number;
    failedNotifications: number;
  }>;
  gradePressure: Array<{
    grade: string;
    studentCount: number;
    incidentCount: number;
    totalPoints: number;
    escalatedCount: number;
    criticalCount: number;
  }>;
  violationHotspots: Array<{
    label: string;
    incidentCount: number;
    totalPoints: number;
  }>;
  recentTrend: Array<{
    period: string;
    incidentCount: number;
    totalPoints: number;
  }>;
  interventionCounts: Record<string, number>;
  notificationCounts: Record<string, number>;
  parseRunStatus: Record<string, number>;
  parseRunSourceCounts: Record<string, number>;
}

interface StudentAggregate {
  studentId: string;
  localStudentId: string | null;
  fullName: string;
  grade: string;
  incidentCount: number;
  totalPoints: number;
  latestIncidentAt: string | null;
}

const DEFAULT_SOURCE_TYPE: IngestionSourceType = "sycamore_api";

function normalizeFilterValue(value: string | undefined): string {
  return value?.trim() || "";
}

function normalizeSourceType(value: string | undefined): IngestionSourceType {
  return DEFAULT_SOURCE_TYPE;
}

function incrementCounter(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function sortCounts(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort((left, right) => right[1] - left[1]));
}

function eventTimestamp(event: DisciplineEventRecord): string | null {
  return event.incidentDate ?? event.occurredAt;
}

function toDateOnly(value: string | null): string | null {
  if (!value) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString().slice(0, 10);
}

function weekBucketLabel(dateOnly: string | null): string {
  if (!dateOnly) {
    return "Unknown";
  }

  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  const weekdayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekdayOffset);
  return date.toISOString().slice(0, 10);
}

export function readDashboardFilters(searchParams: URLSearchParams): DashboardFilters {
  return {
    grade: normalizeFilterValue(searchParams.get("grade") || undefined) || undefined,
    sourceType: normalizeSourceType(searchParams.get("sourceType") || undefined)
  };
}

export async function buildDashboardSnapshot(
  storage: StorageRepositories,
  filters: DashboardFilters
): Promise<DashboardSnapshot> {
  const [parseRuns, interventions, notifications, students, disciplineEvents, guardianContacts] = await Promise.all([
    storage.parseRuns.list(),
    storage.interventions.list(),
    storage.notifications.list(),
    storage.students.list(),
    listDisciplineEvents(storage),
    storage.guardianContacts.list()
  ]);

  const normalizedFilters = {
    grade: normalizeFilterValue(filters.grade),
    sourceType: filters.sourceType ?? DEFAULT_SOURCE_TYPE
  };

  const studentsById = new Map(students.map((student) => [student.id, student] as const));
  const filteredEvents = disciplineEvents.filter((event) => {
    const grade = event.grade ?? studentsById.get(event.localStudentId ?? "")?.grade ?? "unknown";
    if (normalizedFilters.grade && grade !== normalizedFilters.grade) {
      return false;
    }
    return event.sourceType === normalizedFilters.sourceType;
  });

  const studentAggregates = new Map<string, StudentAggregate>();
  const gradePressureMap = new Map<
    string,
    {
      grade: string;
      studentCount: number;
      incidentCount: number;
      totalPoints: number;
      escalatedCount: number;
      criticalCount: number;
    }
  >();
  const violationMap = new Map<
    string,
    {
      label: string;
      incidentCount: number;
      totalPoints: number;
    }
  >();
  const trendMap = new Map<
    string,
    {
      period: string;
      incidentCount: number;
      totalPoints: number;
    }
  >();
  const incidentSourceCounts: Record<string, number> = {};

  for (const event of filteredEvents) {
    const fallbackStudent = event.localStudentId ? studentsById.get(event.localStudentId) : undefined;
    const fullName = event.studentName ?? fallbackStudent?.fullName ?? event.studentId;
    const grade = event.grade ?? fallbackStudent?.grade ?? "unknown";
    const aggregate =
      studentAggregates.get(event.studentId) ??
      {
        studentId: event.studentId,
        localStudentId: event.localStudentId,
        fullName,
        grade,
        incidentCount: 0,
        totalPoints: 0,
        latestIncidentAt: null
      };
    aggregate.incidentCount += 1;
    aggregate.totalPoints += event.points;
    const timestamp = eventTimestamp(event);
    if (timestamp && (!aggregate.latestIncidentAt || Date.parse(timestamp) > Date.parse(aggregate.latestIncidentAt))) {
      aggregate.latestIncidentAt = timestamp;
    }
    studentAggregates.set(event.studentId, aggregate);

    const gradeRow =
      gradePressureMap.get(grade) ??
      {
        grade,
        studentCount: 0,
        incidentCount: 0,
        totalPoints: 0,
        escalatedCount: 0,
        criticalCount: 0
      };
    gradeRow.incidentCount += 1;
    gradeRow.totalPoints += event.points;
    gradePressureMap.set(grade, gradeRow);

    const violationKey = (event.violation ?? event.violationRaw ?? event.reason ?? "Unspecified").trim() || "Unspecified";
    const violationRow =
      violationMap.get(violationKey) ??
      {
        label: violationKey,
        incidentCount: 0,
        totalPoints: 0
      };
    violationRow.incidentCount += 1;
    violationRow.totalPoints += event.points;
    violationMap.set(violationKey, violationRow);

    const trendKey = weekBucketLabel(toDateOnly(eventTimestamp(event)));
    const trendRow =
      trendMap.get(trendKey) ??
      {
        period: trendKey,
        incidentCount: 0,
        totalPoints: 0
      };
    trendRow.incidentCount += 1;
    trendRow.totalPoints += event.points;
    trendMap.set(trendKey, trendRow);

    incrementCounter(incidentSourceCounts, event.sourceType);
  }

  const bandCountsMap = new Map<DemeritEscalationBandId, number>();
  const actionQueue = [...studentAggregates.values()]
    .map((student) => {
      const band = getDemeritEscalationBand(student.totalPoints);
      bandCountsMap.set(band.id, (bandCountsMap.get(band.id) ?? 0) + 1);
      return {
        studentId: student.studentId,
        fullName: student.fullName,
        grade: student.grade,
        totalPoints: student.totalPoints,
        currentBandId: band.id,
        currentBandLabel: band.label,
        currentBandTone: band.tone,
        parentCommunication: band.parentCommunication,
        adminAction: band.adminAction,
        adminMessage: band.adminMessage,
        policyImpact: band.policyImpact,
        latestIncidentAt: student.latestIncidentAt,
        localStudentId: student.localStudentId
      };
    })
    .filter((student) => student.currentBandId !== "below_10")
    .sort((left, right) => {
      const leftBand = getDemeritEscalationBand(left.totalPoints);
      const rightBand = getDemeritEscalationBand(right.totalPoints);
      if (rightBand.priority !== leftBand.priority) {
        return rightBand.priority - leftBand.priority;
      }
      if (right.totalPoints !== left.totalPoints) {
        return right.totalPoints - left.totalPoints;
      }
      return left.fullName.localeCompare(right.fullName);
    });

  const scopedLocalStudentIds = new Set(
    actionQueue.map((student) => student.localStudentId).filter((value): value is string => Boolean(value))
  );
  const emailEnabledGuardianStudentIds = new Set(
    guardianContacts
      .filter((contact) => contact.isActive && contact.allowEmail && Boolean(contact.email))
      .map((contact) => contact.studentId)
  );

  const interventionCounts: Record<string, number> = {};
  const activeInterventionCountByStudent = new Map<string, number>();
  for (const intervention of interventions) {
    if (!scopedLocalStudentIds.has(intervention.studentId)) {
      continue;
    }
    incrementCounter(interventionCounts, intervention.status);
    if (["open", "in_progress", "overdue"].includes(intervention.status)) {
      activeInterventionCountByStudent.set(
        intervention.studentId,
        (activeInterventionCountByStudent.get(intervention.studentId) ?? 0) + 1
      );
    }
  }

  const notificationCounts: Record<string, number> = {};
  const queuedNotificationsByStudent = new Map<string, number>();
  const failedNotificationsByStudent = new Map<string, number>();
  let parentOutreachDraftsPending = 0;
  let approvedParentOutreach = 0;
  for (const notification of notifications) {
    if (!scopedLocalStudentIds.has(notification.studentId)) {
      continue;
    }
    incrementCounter(notificationCounts, notification.status);
    if (notification.status === "queued") {
      queuedNotificationsByStudent.set(
        notification.studentId,
        (queuedNotificationsByStudent.get(notification.studentId) ?? 0) + 1
      );
    }
    if (notification.status === "failed") {
      failedNotificationsByStudent.set(
        notification.studentId,
        (failedNotificationsByStudent.get(notification.studentId) ?? 0) + 1
      );
    }
    if ((notification.kind ?? "policy") === "parent_outreach" && notification.status === "draft") {
      parentOutreachDraftsPending += 1;
    }
    if ((notification.kind ?? "policy") === "parent_outreach" && notification.status === "approved") {
      approvedParentOutreach += 1;
    }
  }

  const actionQueueWithPosture = actionQueue.slice(0, 18).map((student) => ({
    ...student,
    activeInterventions: student.localStudentId ? activeInterventionCountByStudent.get(student.localStudentId) ?? 0 : 0,
    queuedNotifications: student.localStudentId ? queuedNotificationsByStudent.get(student.localStudentId) ?? 0 : 0,
    failedNotifications: student.localStudentId ? failedNotificationsByStudent.get(student.localStudentId) ?? 0 : 0
  }));

  for (const aggregate of studentAggregates.values()) {
    const row =
      gradePressureMap.get(aggregate.grade) ??
      {
        grade: aggregate.grade,
        studentCount: 0,
        incidentCount: 0,
        totalPoints: 0,
        escalatedCount: 0,
        criticalCount: 0
      };
    row.studentCount += 1;
    if (aggregate.totalPoints >= 10) {
      row.escalatedCount += 1;
    }
    if (aggregate.totalPoints >= 35) {
      row.criticalCount += 1;
    }
    gradePressureMap.set(aggregate.grade, row);
  }

  const bandCounts = demeritEscalationBands
    .filter((band) => band.id !== "below_10")
    .map((band) => ({
      id: band.id,
      label: band.label,
      shortLabel: band.shortLabel,
      tone: band.tone,
      count: bandCountsMap.get(band.id) ?? 0,
      parentCommunication: band.parentCommunication,
      adminAction: band.adminAction
    }));

  const gradePressure = [...gradePressureMap.values()].sort((left, right) => {
    if (right.totalPoints !== left.totalPoints) {
      return right.totalPoints - left.totalPoints;
    }
    return left.grade.localeCompare(right.grade);
  });

  const violationHotspots = [...violationMap.values()]
    .sort((left, right) => {
      if (right.incidentCount !== left.incidentCount) {
        return right.incidentCount - left.incidentCount;
      }
      return right.totalPoints - left.totalPoints;
    })
    .slice(0, 8);

  const recentTrend = [...trendMap.values()]
    .sort((left, right) => right.period.localeCompare(left.period))
    .slice(0, 8)
    .reverse();

  const filteredParseRuns = parseRuns.filter((parseRun) => parseRun.sourceType === normalizedFilters.sourceType);
  const parseRunSourceCounts = filteredParseRuns.reduce<Record<string, number>>((acc, parseRun) => {
    acc[parseRun.sourceType] = (acc[parseRun.sourceType] ?? 0) + 1;
    return acc;
  }, {});

  return {
    filters: normalizedFilters,
    metrics: {
      studentsTracked: studentAggregates.size,
      incidentsTracked: filteredEvents.length,
      totalPoints: filteredEvents.reduce((sum, event) => sum + event.points, 0),
      studentsAt10Plus: [...studentAggregates.values()].filter((student) => student.totalPoints >= 10).length,
      studentsAt35Plus: [...studentAggregates.values()].filter((student) => student.totalPoints >= 35).length,
      openInterventions: Object.entries(interventionCounts)
        .filter(([status]) => ["open", "in_progress", "overdue"].includes(status))
        .reduce((sum, [, count]) => sum + count, 0),
      queuedNotifications: notificationCounts.queued ?? 0,
      failedNotifications: notificationCounts.failed ?? 0,
      parentOutreachDraftsPending,
      approvedParentOutreach,
      studentsMissingParentEmailAt10To19: actionQueue.filter(
        (student) =>
          student.currentBandId === "points_10_19" &&
          student.localStudentId &&
          !emailEnabledGuardianStudentIds.has(student.localStudentId)
      ).length
    },
    bandCounts,
    actionQueue: actionQueueWithPosture,
    gradePressure,
    violationHotspots,
    recentTrend,
    interventionCounts: sortCounts(interventionCounts),
    notificationCounts: sortCounts(notificationCounts),
    parseRunStatus: parseRunStatusSummary(filteredParseRuns),
    parseRunSourceCounts: sortCounts(parseRunSourceCounts)
  };
}
