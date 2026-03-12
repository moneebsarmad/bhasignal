import type { IngestionSourceType, Policy, Student } from "@syc/domain";
import type { StorageRepositories } from "@syc/storage";

import { listDisciplineEvents, type DisciplineEventRecord } from "@/lib/discipline-events";
import { buildTriggerLevels, parseRunStatusSummary } from "@/lib/policies";

export interface DashboardFilters {
  grade?: string;
  from?: string;
  to?: string;
  sourceType?: IngestionSourceType;
}

export interface DashboardSnapshot {
  filters: {
    grade: string;
    from: string;
    to: string;
    sourceType: string;
  };
  latestPolicy: Policy | null;
  metrics: {
    totalStudents: number;
    incidentsInRange: number;
    countAtX: number;
    countAtX10: number;
    countAtX20: number;
    countAtX30: number;
    nearThresholdCount: number;
  };
  countsByLabel: Record<string, number>;
  interventionCounts: Record<string, number>;
  notificationCounts: Record<string, number>;
  parseRunStatus: Record<string, number>;
  parseRunSourceCounts: Record<string, number>;
  incidentSourceCounts: Record<string, number>;
  topStudents: Array<{
    studentId: string;
    fullName: string;
    grade: string;
    totalPoints: number;
  }>;
}

interface DateWindow {
  fromEpoch: number;
  toEpoch: number;
}

const DEFAULT_SOURCE_TYPE: IngestionSourceType = "sycamore_api";

function normalizeFilterValue(value: string | undefined): string {
  return value?.trim() || "";
}

function normalizeSourceType(value: string | undefined): IngestionSourceType {
  return value === "manual_pdf" ? value : DEFAULT_SOURCE_TYPE;
}

function parseBoundary(value: string | undefined, boundary: "start" | "end"): number {
  if (!value) {
    return Number.NaN;
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return Date.parse(`${trimmed}T${boundary === "start" ? "00:00:00.000" : "23:59:59.999"}Z`);
  }
  return Date.parse(trimmed);
}

function parseWindow(filters: DashboardFilters): DateWindow {
  return {
    fromEpoch: parseBoundary(filters.from, "start"),
    toEpoch: parseBoundary(filters.to, "end")
  };
}

function isWithinWindow(value: string | null, window: DateWindow): boolean {
  if (!value) {
    return Number.isNaN(window.fromEpoch) && Number.isNaN(window.toEpoch);
  }

  const epoch = Date.parse(value);
  if (Number.isNaN(epoch)) {
    return false;
  }
  if (!Number.isNaN(window.fromEpoch) && epoch < window.fromEpoch) {
    return false;
  }
  if (!Number.isNaN(window.toEpoch) && epoch > window.toEpoch) {
    return false;
  }
  return true;
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

export function readDashboardFilters(searchParams: URLSearchParams): DashboardFilters {
  return {
    grade: normalizeFilterValue(searchParams.get("grade") || undefined) || undefined,
    from: normalizeFilterValue(searchParams.get("from") || undefined) || undefined,
    to: normalizeFilterValue(searchParams.get("to") || undefined) || undefined,
    sourceType: normalizeSourceType(searchParams.get("sourceType") || undefined)
  };
}

export async function buildDashboardSnapshot(
  storage: StorageRepositories,
  filters: DashboardFilters
): Promise<DashboardSnapshot> {
  const [latestPolicy, parseRuns, interventions, notifications, students, disciplineEvents] = await Promise.all([
    storage.policies.getLatest(),
    storage.parseRuns.list(),
    storage.interventions.list(),
    storage.notifications.list(),
    storage.students.list(),
    listDisciplineEvents(storage)
  ]);

  const normalizedFilters = {
    grade: normalizeFilterValue(filters.grade),
    from: normalizeFilterValue(filters.from),
    to: normalizeFilterValue(filters.to),
    sourceType: filters.sourceType ?? DEFAULT_SOURCE_TYPE
  };
  const window = parseWindow(filters);

  const studentsById = new Map(students.map((student) => [student.id, student] as const));

  const filteredEvents = disciplineEvents.filter((event) => {
    const eventGrade = event.grade ?? studentsById.get(event.localStudentId ?? "")?.grade ?? null;
    if (normalizedFilters.grade && eventGrade !== normalizedFilters.grade) {
      return false;
    }
    if (normalizedFilters.sourceType && event.sourceType !== normalizedFilters.sourceType) {
      return false;
    }
    return isWithinWindow(eventTimestamp(event), window);
  });

  const scopedStudents = new Map<
    string,
    {
      studentId: string;
      localStudentId: string | null;
      fullName: string;
      grade: string;
    }
  >();

  for (const event of filteredEvents) {
    if (!scopedStudents.has(event.studentId)) {
      const localStudent = event.localStudentId ? studentsById.get(event.localStudentId) : undefined;
      scopedStudents.set(event.studentId, {
        studentId: event.studentId,
        localStudentId: event.localStudentId,
        fullName: event.studentName ?? localStudent?.fullName ?? event.studentId,
        grade: event.grade ?? localStudent?.grade ?? "unknown"
      });
    }
  }

  const scopedLocalStudentIds = new Set(
    [...scopedStudents.values()].map((student) => student.localStudentId).filter((value): value is string => Boolean(value))
  );

  const scoreByStudent = new Map<string, number>();
  const incidentSourceCounts: Record<string, number> = {};
  for (const event of filteredEvents) {
    scoreByStudent.set(event.studentId, (scoreByStudent.get(event.studentId) ?? 0) + event.points);
    incrementCounter(incidentSourceCounts, event.sourceType);
  }

  const filteredScores = [...scopedStudents.values()]
    .map((student) => ({
      student,
      totalPoints: scoreByStudent.get(student.studentId) ?? 0
    }))
    .sort((left, right) => right.totalPoints - left.totalPoints);

  const baseThreshold = latestPolicy?.baseThreshold ?? 10;
  const triggerLevels = latestPolicy ? buildTriggerLevels(latestPolicy) : [];
  const countsByLabel: Record<string, number> = {};
  for (const trigger of triggerLevels) {
    countsByLabel[trigger.label] = filteredScores.filter(
      (score) => score.totalPoints >= trigger.threshold
    ).length;
  }

  const nearThresholdCount = filteredScores.filter(
    (score) => score.totalPoints >= baseThreshold - 3 && score.totalPoints < baseThreshold
  ).length;

  const countAtX = filteredScores.filter((score) => score.totalPoints >= baseThreshold).length;
  const countAtX10 = filteredScores.filter((score) => score.totalPoints >= baseThreshold + 10).length;
  const countAtX20 = filteredScores.filter((score) => score.totalPoints >= baseThreshold + 20).length;
  const countAtX30 = filteredScores.filter((score) => score.totalPoints >= baseThreshold + 30).length;

  const filteredInterventions = interventions.filter((intervention) => {
    if (!scopedLocalStudentIds.has(intervention.studentId)) {
      return false;
    }
    if (!normalizedFilters.from && !normalizedFilters.to) {
      return true;
    }
    return isWithinWindow(intervention.dueDate, window);
  });
  const filteredNotifications = notifications.filter((notification) => {
    if (!scopedLocalStudentIds.has(notification.studentId)) {
      return false;
    }
    if (!normalizedFilters.from && !normalizedFilters.to) {
      return true;
    }
    return isWithinWindow(notification.sentAt, window);
  });

  const interventionCounts = filteredInterventions.reduce<Record<string, number>>((acc, intervention) => {
    acc[intervention.status] = (acc[intervention.status] ?? 0) + 1;
    return acc;
  }, {});
  const notificationCounts = filteredNotifications.reduce<Record<string, number>>((acc, notification) => {
    acc[notification.status] = (acc[notification.status] ?? 0) + 1;
    return acc;
  }, {});

  const filteredParseRuns = parseRuns.filter((parseRun) => {
    if (normalizedFilters.sourceType && parseRun.sourceType !== normalizedFilters.sourceType) {
      return false;
    }
    if (!normalizedFilters.from && !normalizedFilters.to) {
      return true;
    }
    return isWithinWindow(parseRun.startedAt, window);
  });
  const parseRunSourceCounts = filteredParseRuns.reduce<Record<string, number>>((acc, parseRun) => {
    acc[parseRun.sourceType] = (acc[parseRun.sourceType] ?? 0) + 1;
    return acc;
  }, {});

  return {
    filters: normalizedFilters,
    latestPolicy,
    metrics: {
      totalStudents: filteredScores.length,
      incidentsInRange: filteredEvents.length,
      countAtX,
      countAtX10,
      countAtX20,
      countAtX30,
      nearThresholdCount
    },
    countsByLabel: sortCounts(countsByLabel),
    interventionCounts: sortCounts(interventionCounts),
    notificationCounts: sortCounts(notificationCounts),
    parseRunStatus: parseRunStatusSummary(filteredParseRuns),
    parseRunSourceCounts: sortCounts(parseRunSourceCounts),
    incidentSourceCounts: sortCounts(incidentSourceCounts),
    topStudents: filteredScores
      .filter((score) => score.totalPoints > 0)
      .slice(0, 20)
      .map((score) => ({
        studentId: score.student.studentId,
        fullName: score.student.fullName,
        grade: score.student.grade,
        totalPoints: score.totalPoints
      }))
  };
}

export function studentLabel(student: Student | undefined, fallbackId: string): string {
  return student?.fullName || fallbackId;
}
