import type { IngestionSourceType } from "@syc/domain";
import type { StorageRepositories } from "@syc/storage";

import { listDisciplineEvents, type DisciplineEventRecord } from "@/lib/discipline-events";
import {
  escalationBandOptions,
  getDemeritEscalationBand,
  type DemeritEscalationBandId
} from "@/lib/demerit-escalation";

export interface AnalyticsFilters {
  grade?: string;
  from?: string;
  to?: string;
  sourceType?: IngestionSourceType;
  student?: string;
  violation?: string;
  author?: string;
  thresholdBand?: DemeritEscalationBandId;
}

export interface AnalyticsSummaryMetric {
  label: string;
  value: number;
  description: string;
}

export interface AnalyticsTrendRow {
  period: string;
  incidentCount: number;
  totalPoints: number;
}

export interface AnalyticsGradeRow {
  grade: string;
  studentCount: number;
  incidentCount: number;
  totalPoints: number;
  escalatedCount: number;
  criticalCount: number;
}

export interface AnalyticsViolationRow {
  violation: string;
  incidentCount: number;
  totalPoints: number;
  uniqueStudents: number;
}

export interface AnalyticsAuthorRow {
  author: string;
  incidentCount: number;
  totalPoints: number;
  uniqueStudents: number;
}

export interface AnalyticsStudentRow {
  studentId: string;
  fullName: string;
  grade: string;
  incidentCount: number;
  totalPoints: number;
  currentTotalPoints: number;
  currentBandId: DemeritEscalationBandId;
  currentBandLabel: string;
  latestIncidentAt: string | null;
  activeInterventions: number;
  queuedNotifications: number;
  failedNotifications: number;
}

export interface AnalyticsSnapshot {
  generatedAt: string;
  filters: {
    grade: string;
    from: string;
    to: string;
    sourceType: string;
    student: string;
    violation: string;
    author: string;
    thresholdBand: string;
  };
  availableFilters: {
    grades: string[];
    violations: string[];
    authors: string[];
    thresholdBands: Array<{ id: string; label: string }>;
  };
  summary: AnalyticsSummaryMetric[];
  trend: AnalyticsTrendRow[];
  gradeRows: AnalyticsGradeRow[];
  violationRows: AnalyticsViolationRow[];
  authorRows: AnalyticsAuthorRow[];
  studentRows: AnalyticsStudentRow[];
  interventionStatus: Record<string, number>;
  notificationStatus: Record<string, number>;
  narrative: string;
}

interface DateWindow {
  fromEpoch: number;
  toEpoch: number;
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

type TrendBucketMode = "day" | "week" | "month";

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

function parseWindow(filters: AnalyticsFilters): DateWindow {
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

function eventTimestamp(event: DisciplineEventRecord): string | null {
  return event.incidentDate ?? event.occurredAt;
}

function normalizeCompareValue(value: string | null): string {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") || "";
}

function prettifyKey(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function incrementCounter(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function sortCounts(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort((left, right) => right[1] - left[1]));
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

function normalizeBucketLabel(input: Date, mode: TrendBucketMode): string {
  if (mode === "month") {
    return input.toISOString().slice(0, 7);
  }
  return input.toISOString().slice(0, 10);
}

function bucketModeForEvents(events: DisciplineEventRecord[], filters: AnalyticsFilters): TrendBucketMode {
  if (filters.from && filters.to) {
    const spanDays = Math.max(
      1,
      Math.ceil((parseBoundary(filters.to, "end") - parseBoundary(filters.from, "start")) / (1000 * 60 * 60 * 24))
    );
    if (spanDays <= 21) {
      return "day";
    }
    if (spanDays <= 120) {
      return "week";
    }
    return "month";
  }

  const datedEvents = events
    .map((event) => Date.parse(eventTimestamp(event) ?? ""))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (datedEvents.length <= 1) {
    return "week";
  }

  const spanDays = Math.ceil(
    ((datedEvents[datedEvents.length - 1] ?? 0) - (datedEvents[0] ?? 0)) / (1000 * 60 * 60 * 24)
  );
  if (spanDays <= 21) {
    return "day";
  }
  if (spanDays <= 120) {
    return "week";
  }
  return "month";
}

function bucketDateLabel(dateOnly: string | null, mode: TrendBucketMode): string {
  if (!dateOnly) {
    return "Unknown";
  }
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  if (mode === "day") {
    return normalizeBucketLabel(date, "day");
  }

  if (mode === "week") {
    const weekdayOffset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - weekdayOffset);
    return normalizeBucketLabel(date, "week");
  }

  date.setUTCDate(1);
  return normalizeBucketLabel(date, "month");
}

function matchesStudentSearch(
  search: string,
  event: DisciplineEventRecord,
  fallbackName: string,
  fallbackGrade: string
): boolean {
  if (!search) {
    return true;
  }

  const normalizedSearch = normalizeCompareValue(search);
  return [
    event.studentId,
    event.localStudentId,
    event.studentExternalId,
    event.studentName,
    fallbackName,
    fallbackGrade
  ]
    .filter(Boolean)
    .some((candidate) => normalizeCompareValue(candidate as string).includes(normalizedSearch));
}

export function readAnalyticsFilters(searchParams: URLSearchParams): AnalyticsFilters {
  return {
    grade: normalizeFilterValue(searchParams.get("grade") || undefined) || undefined,
    from: normalizeFilterValue(searchParams.get("from") || undefined) || undefined,
    to: normalizeFilterValue(searchParams.get("to") || undefined) || undefined,
    sourceType: normalizeSourceType(searchParams.get("sourceType") || undefined),
    student: normalizeFilterValue(searchParams.get("student") || undefined) || undefined,
    violation: normalizeFilterValue(searchParams.get("violation") || undefined) || undefined,
    author: normalizeFilterValue(searchParams.get("author") || undefined) || undefined,
    thresholdBand: (normalizeFilterValue(searchParams.get("thresholdBand") || undefined) || undefined) as
      | DemeritEscalationBandId
      | undefined
  };
}

export async function buildAnalyticsSnapshot(
  storage: StorageRepositories,
  filters: AnalyticsFilters
): Promise<AnalyticsSnapshot> {
  const [students, interventions, notifications, disciplineEvents] = await Promise.all([
    storage.students.list(),
    storage.interventions.list(),
    storage.notifications.list(),
    listDisciplineEvents(storage)
  ]);

  const normalizedFilters = {
    grade: normalizeFilterValue(filters.grade),
    from: normalizeFilterValue(filters.from),
    to: normalizeFilterValue(filters.to),
    sourceType: filters.sourceType ?? DEFAULT_SOURCE_TYPE,
    student: normalizeFilterValue(filters.student),
    violation: normalizeFilterValue(filters.violation),
    author: normalizeFilterValue(filters.author),
    thresholdBand: normalizeFilterValue(filters.thresholdBand)
  };

  const studentsById = new Map(students.map((student) => [student.id, student] as const));
  const window = parseWindow(filters);

  const sourceScopedEvents = disciplineEvents.filter((event) => event.sourceType === normalizedFilters.sourceType);

  const filteredForLiveBands = sourceScopedEvents.filter((event) => {
    const fallbackStudent = event.localStudentId ? studentsById.get(event.localStudentId) : undefined;
    const fallbackGrade = event.grade ?? fallbackStudent?.grade ?? "unknown";
    const fallbackName = event.studentName ?? fallbackStudent?.fullName ?? event.studentId;
    if (normalizedFilters.grade && fallbackGrade !== normalizedFilters.grade) {
      return false;
    }
    return matchesStudentSearch(normalizedFilters.student, event, fallbackName, fallbackGrade);
  });

  const currentTotalsByStudent = new Map<string, number>();
  const currentBandByStudent = new Map<string, ReturnType<typeof getDemeritEscalationBand>>();
  for (const event of filteredForLiveBands) {
    currentTotalsByStudent.set(event.studentId, (currentTotalsByStudent.get(event.studentId) ?? 0) + event.points);
  }
  for (const [studentId, totalPoints] of currentTotalsByStudent.entries()) {
    currentBandByStudent.set(studentId, getDemeritEscalationBand(totalPoints));
  }

  const filteredEvents = sourceScopedEvents.filter((event) => {
    const fallbackStudent = event.localStudentId ? studentsById.get(event.localStudentId) : undefined;
    const fallbackGrade = event.grade ?? fallbackStudent?.grade ?? "unknown";
    const fallbackName = event.studentName ?? fallbackStudent?.fullName ?? event.studentId;
    const eventViolation = event.violation ?? event.violationRaw ?? event.reason ?? "";
    const eventAuthor = event.authorName ?? "";

    if (normalizedFilters.grade && fallbackGrade !== normalizedFilters.grade) {
      return false;
    }
    if (!matchesStudentSearch(normalizedFilters.student, event, fallbackName, fallbackGrade)) {
      return false;
    }
    if (
      normalizedFilters.violation &&
      normalizeCompareValue(eventViolation) !== normalizeCompareValue(normalizedFilters.violation)
    ) {
      return false;
    }
    if (normalizedFilters.author && normalizeCompareValue(eventAuthor) !== normalizeCompareValue(normalizedFilters.author)) {
      return false;
    }
    if (
      normalizedFilters.thresholdBand &&
      currentBandByStudent.get(event.studentId)?.id !== normalizedFilters.thresholdBand
    ) {
      return false;
    }
    return isWithinWindow(eventTimestamp(event), window);
  });

  const scopedStudents = new Map<string, StudentAggregate>();
  for (const event of filteredEvents) {
    const fallbackStudent = event.localStudentId ? studentsById.get(event.localStudentId) : undefined;
    const fullName = event.studentName ?? fallbackStudent?.fullName ?? event.studentId;
    const grade = event.grade ?? fallbackStudent?.grade ?? "unknown";
    const aggregate =
      scopedStudents.get(event.studentId) ??
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
    scopedStudents.set(event.studentId, aggregate);
  }

  const scopedLocalStudentIds = new Set(
    [...scopedStudents.values()].map((student) => student.localStudentId).filter((value): value is string => Boolean(value))
  );

  const interventionStatus: Record<string, number> = {};
  const activeInterventionCountByStudent = new Map<string, number>();
  for (const intervention of interventions) {
    if (!scopedLocalStudentIds.has(intervention.studentId)) {
      continue;
    }
    if (!isWithinWindow(intervention.dueDate, window) && (normalizedFilters.from || normalizedFilters.to)) {
      continue;
    }
    incrementCounter(interventionStatus, intervention.status);
    if (["open", "in_progress", "overdue"].includes(intervention.status)) {
      activeInterventionCountByStudent.set(
        intervention.studentId,
        (activeInterventionCountByStudent.get(intervention.studentId) ?? 0) + 1
      );
    }
  }

  const notificationStatus: Record<string, number> = {};
  const queuedNotificationsByStudent = new Map<string, number>();
  const failedNotificationsByStudent = new Map<string, number>();
  for (const notification of notifications) {
    if (!scopedLocalStudentIds.has(notification.studentId)) {
      continue;
    }
    if (!isWithinWindow(notification.sentAt, window) && (normalizedFilters.from || normalizedFilters.to)) {
      continue;
    }
    incrementCounter(notificationStatus, notification.status);
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
  }

  const trendMode = bucketModeForEvents(filteredEvents, filters);
  const trendMap = new Map<string, AnalyticsTrendRow>();
  const gradeMap = new Map<string, AnalyticsGradeRow>();
  const violationMap = new Map<
    string,
    AnalyticsViolationRow & {
      uniqueStudentIds: Set<string>;
    }
  >();
  const authorMap = new Map<
    string,
    AnalyticsAuthorRow & {
      uniqueStudentIds: Set<string>;
    }
  >();

  for (const aggregate of scopedStudents.values()) {
    const gradeRow =
      gradeMap.get(aggregate.grade) ??
      {
        grade: aggregate.grade,
        studentCount: 0,
        incidentCount: 0,
        totalPoints: 0,
        escalatedCount: 0,
        criticalCount: 0
      };
    gradeRow.studentCount += 1;
    gradeRow.incidentCount += aggregate.incidentCount;
    gradeRow.totalPoints += aggregate.totalPoints;
    const currentBand = currentBandByStudent.get(aggregate.studentId) ?? getDemeritEscalationBand(0);
    if (currentBand.priority > 0) {
      gradeRow.escalatedCount += 1;
    }
    if (currentBand.minPoints >= 35) {
      gradeRow.criticalCount += 1;
    }
    gradeMap.set(aggregate.grade, gradeRow);
  }

  for (const event of filteredEvents) {
    const dateOnly = toDateOnly(eventTimestamp(event));
    const bucket = bucketDateLabel(dateOnly, trendMode);
    const trendRow =
      trendMap.get(bucket) ??
      {
        period: bucket,
        incidentCount: 0,
        totalPoints: 0
      };
    trendRow.incidentCount += 1;
    trendRow.totalPoints += event.points;
    trendMap.set(bucket, trendRow);

    const violationKey = (event.violation ?? event.violationRaw ?? event.reason ?? "Unspecified").trim() || "Unspecified";
    const violationRow =
      violationMap.get(violationKey) ??
      {
        violation: violationKey,
        incidentCount: 0,
        totalPoints: 0,
        uniqueStudents: 0,
        uniqueStudentIds: new Set<string>()
      };
    violationRow.incidentCount += 1;
    violationRow.totalPoints += event.points;
    violationRow.uniqueStudentIds.add(event.studentId);
    violationMap.set(violationKey, violationRow);

    const authorKey = (event.authorName ?? "Unassigned").trim() || "Unassigned";
    const authorRow =
      authorMap.get(authorKey) ??
      {
        author: authorKey,
        incidentCount: 0,
        totalPoints: 0,
        uniqueStudents: 0,
        uniqueStudentIds: new Set<string>()
      };
    authorRow.incidentCount += 1;
    authorRow.totalPoints += event.points;
    authorRow.uniqueStudentIds.add(event.studentId);
    authorMap.set(authorKey, authorRow);
  }

  const studentRows = [...scopedStudents.values()]
    .map((student): AnalyticsStudentRow => {
      const currentTotalPoints = currentTotalsByStudent.get(student.studentId) ?? student.totalPoints;
      const currentBand = currentBandByStudent.get(student.studentId) ?? getDemeritEscalationBand(currentTotalPoints);
      return {
        studentId: student.studentId,
        fullName: student.fullName,
        grade: student.grade,
        incidentCount: student.incidentCount,
        totalPoints: student.totalPoints,
        currentTotalPoints,
        currentBandId: currentBand.id,
        currentBandLabel: currentBand.label,
        latestIncidentAt: student.latestIncidentAt,
        activeInterventions: student.localStudentId
          ? activeInterventionCountByStudent.get(student.localStudentId) ?? 0
          : 0,
        queuedNotifications: student.localStudentId
          ? queuedNotificationsByStudent.get(student.localStudentId) ?? 0
          : 0,
        failedNotifications: student.localStudentId
          ? failedNotificationsByStudent.get(student.localStudentId) ?? 0
          : 0
      };
    })
    .sort((left, right) => {
      if (right.currentTotalPoints !== left.currentTotalPoints) {
        return right.currentTotalPoints - left.currentTotalPoints;
      }
      if (right.totalPoints !== left.totalPoints) {
        return right.totalPoints - left.totalPoints;
      }
      return right.incidentCount - left.incidentCount;
    });

  const criticalStudents = studentRows.filter((student) => student.currentTotalPoints >= 35).length;
  const escalatedStudents = studentRows.filter((student) => student.currentTotalPoints >= 10).length;
  const totalPointsInSlice = filteredEvents.reduce((sum, event) => sum + event.points, 0);

  const summary: AnalyticsSummaryMetric[] = [
    {
      label: "Students in slice",
      value: studentRows.length,
      description: "Students represented by the active deep analytics filter set."
    },
    {
      label: "Incidents in slice",
      value: filteredEvents.length,
      description: "Stored discipline events matching the active filter set."
    },
    {
      label: "Points in slice",
      value: totalPointsInSlice,
      description: "Total demerit points inside the current analysis frame."
    },
    {
      label: "Escalated students",
      value: escalatedStudents,
      description: "Students in this slice currently sitting at 10 or more total points."
    },
    {
      label: "Critical students",
      value: criticalStudents,
      description: "Students in this slice currently sitting at 35 or more total points."
    }
  ];

  const gradeRows = [...gradeMap.values()].sort((left, right) => {
    if (right.totalPoints !== left.totalPoints) {
      return right.totalPoints - left.totalPoints;
    }
    return left.grade.localeCompare(right.grade);
  });

  const violationRows = [...violationMap.values()]
    .map((row) => ({
      violation: row.violation,
      incidentCount: row.incidentCount,
      totalPoints: row.totalPoints,
      uniqueStudents: row.uniqueStudentIds.size
    }))
    .sort((left, right) => {
      if (right.incidentCount !== left.incidentCount) {
        return right.incidentCount - left.incidentCount;
      }
      return right.totalPoints - left.totalPoints;
    })
    .slice(0, 12);

  const authorRows = [...authorMap.values()]
    .map((row) => ({
      author: row.author,
      incidentCount: row.incidentCount,
      totalPoints: row.totalPoints,
      uniqueStudents: row.uniqueStudentIds.size
    }))
    .sort((left, right) => {
      if (right.incidentCount !== left.incidentCount) {
        return right.incidentCount - left.incidentCount;
      }
      return right.totalPoints - left.totalPoints;
    })
    .slice(0, 10);

  const trend = [...trendMap.values()].sort((left, right) => left.period.localeCompare(right.period));

  const topGrade = gradeRows[0];
  const topViolation = violationRows[0];
  const topAuthor = authorRows[0];
  const narrativeParts = [
    normalizedFilters.sourceType === "manual_pdf"
      ? "Deep analytics is currently scoped to PDF exception data."
      : "Deep analytics is currently scoped to Sycamore-backed discipline data.",
    topGrade
      ? `Grade ${topGrade.grade} carries the heaviest current load with ${topGrade.totalPoints} points.`
      : "No grade concentration is visible in the current slice.",
    topViolation
      ? `${topViolation.violation} is the leading behavior driver in this slice.`
      : "No dominant behavior pattern is visible in the current slice.",
    topAuthor
      ? `${topAuthor.author} appears most frequently in the stored records returned here.`
      : "No author trend is visible in the current slice."
  ];

  const availableGrades = [...new Set(sourceScopedEvents.map((event) => event.grade).filter((value): value is string => Boolean(value)))].sort(
    (left, right) => left.localeCompare(right)
  );
  const availableViolations = [
    ...new Set(
      sourceScopedEvents
        .map((event) => (event.violation ?? event.violationRaw ?? event.reason ?? "").trim())
        .filter(Boolean)
    )
  ].sort((left, right) => left.localeCompare(right));
  const availableAuthors = [
    ...new Set(sourceScopedEvents.map((event) => (event.authorName ?? "").trim()).filter(Boolean))
  ].sort((left, right) => left.localeCompare(right));

  return {
    generatedAt: new Date().toISOString(),
    filters: normalizedFilters,
    availableFilters: {
      grades: availableGrades,
      violations: availableViolations,
      authors: availableAuthors,
      thresholdBands: escalationBandOptions()
    },
    summary,
    trend,
    gradeRows,
    violationRows,
    authorRows,
    studentRows,
    interventionStatus: sortCounts(interventionStatus),
    notificationStatus: sortCounts(notificationStatus),
    narrative: narrativeParts.join(" ")
  };
}

export function analyticsStatusRows(record: Record<string, number>): Array<{ key: string; label: string; count: number }> {
  return Object.entries(record)
    .map(([key, count]) => ({
      key,
      label: prettifyKey(key),
      count
    }))
    .sort((left, right) => right.count - left.count);
}
