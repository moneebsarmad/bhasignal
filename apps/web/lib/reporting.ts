import type { IngestionSourceType, Notification, Student } from "@syc/domain";
import type { StorageRepositories } from "@syc/storage";

import { listDisciplineEvents, type DisciplineEventRecord } from "@/lib/discipline-events";

export interface ReportFilters {
  grade?: string;
  from?: string;
  to?: string;
  sourceType?: IngestionSourceType;
}

export interface ReportSummaryMetric {
  label: string;
  value: number;
  description: string;
}

export interface GradeRollupRow {
  grade: string;
  studentCount: number;
  incidentCount: number;
  totalPoints: number;
  activeInterventions: number;
}

export interface ReasonRollupRow {
  reason: string;
  incidentCount: number;
  totalPoints: number;
}

export interface StudentReportRow {
  studentId: string;
  fullName: string;
  grade: string;
  incidentCount: number;
  totalPoints: number;
  activeInterventions: number;
  notificationCount: number;
  latestIncidentAt: string | null;
}

export interface ReportSnapshot {
  generatedAt: string;
  filters: {
    grade: string;
    from: string;
    to: string;
    sourceType: string;
  };
  summary: ReportSummaryMetric[];
  incidentsByGrade: GradeRollupRow[];
  topReasons: ReasonRollupRow[];
  studentRows: StudentReportRow[];
  interventionStatus: Record<string, number>;
  notificationStatus: Record<string, number>;
  sourceBreakdown: Record<string, number>;
  narrative: string;
}

interface DateWindow {
  fromEpoch: number;
  toEpoch: number;
}

function normalizeFilterValue(value: string | undefined): string {
  return value?.trim() || "";
}

function normalizeSourceType(value: string | undefined): IngestionSourceType | undefined {
  return value === "manual_pdf" || value === "sycamore_api" ? value : undefined;
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

function parseWindow(filters: ReportFilters): DateWindow {
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

function activeNotificationCount(notifications: Notification[]): number {
  return notifications.filter((notification) => notification.status === "queued").length;
}

function eventTimestamp(event: DisciplineEventRecord): string | null {
  return event.incidentDate ?? event.occurredAt;
}

export function readReportFilters(searchParams: URLSearchParams): ReportFilters {
  const grade = normalizeFilterValue(searchParams.get("grade") || undefined);
  const from = normalizeFilterValue(searchParams.get("from") || undefined);
  const to = normalizeFilterValue(searchParams.get("to") || undefined);
  const sourceType = normalizeSourceType(searchParams.get("sourceType") || undefined);

  return {
    grade: grade || undefined,
    from: from || undefined,
    to: to || undefined,
    sourceType
  };
}

export async function buildReportSnapshot(
  storage: StorageRepositories,
  filters: ReportFilters
): Promise<ReportSnapshot> {
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
    sourceType: filters.sourceType ?? ""
  };
  const window = parseWindow(filters);
  const studentById = new Map(students.map((student) => [student.id, student] as const));

  const filteredEvents = disciplineEvents.filter((event) => {
    const eventGrade = event.grade ?? studentById.get(event.localStudentId ?? "")?.grade ?? null;
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
      const localStudent = event.localStudentId ? studentById.get(event.localStudentId) : undefined;
      scopedStudents.set(event.studentId, {
        studentId: event.studentId,
        localStudentId: event.localStudentId,
        fullName: event.studentName ?? localStudent?.fullName ?? event.studentId,
        grade: event.grade ?? localStudent?.grade ?? "unknown"
      });
    }
  }

  const filteredLocalStudentIds = new Set(
    [...scopedStudents.values()].map((student) => student.localStudentId).filter((value): value is string => Boolean(value))
  );

  const filteredInterventions = interventions.filter((intervention) => {
    if (!filteredLocalStudentIds.has(intervention.studentId)) {
      return false;
    }
    if (!normalizedFilters.from && !normalizedFilters.to) {
      return true;
    }
    return isWithinWindow(intervention.dueDate, window);
  });

  const filteredNotifications = notifications.filter((notification) => {
    if (!filteredLocalStudentIds.has(notification.studentId)) {
      return false;
    }
    if (!normalizedFilters.from && !normalizedFilters.to) {
      return true;
    }
    return isWithinWindow(notification.sentAt, window);
  });

  const incidentsByStudent = new Map<string, number>();
  const pointsByStudent = new Map<string, number>();
  const latestIncidentByStudent = new Map<string, string>();
  const gradeRollupMap = new Map<string, GradeRollupRow>();
  const reasonRollupMap = new Map<string, ReasonRollupRow>();
  const sourceBreakdown: Record<string, number> = {};

  for (const student of scopedStudents.values()) {
    gradeRollupMap.set(student.grade, {
      grade: student.grade,
      studentCount: 0,
      incidentCount: 0,
      totalPoints: 0,
      activeInterventions: 0
    });
  }

  for (const student of scopedStudents.values()) {
    const gradeRow = gradeRollupMap.get(student.grade);
    if (gradeRow) {
      gradeRow.studentCount += 1;
    }
  }

  for (const event of filteredEvents) {
    const grade = event.grade ?? studentById.get(event.localStudentId ?? "")?.grade ?? "unknown";
    incidentsByStudent.set(event.studentId, (incidentsByStudent.get(event.studentId) ?? 0) + 1);
    pointsByStudent.set(event.studentId, (pointsByStudent.get(event.studentId) ?? 0) + event.points);

    const latestTimestamp = eventTimestamp(event);
    const latest = latestIncidentByStudent.get(event.studentId);
    if (latestTimestamp && (!latest || Date.parse(latestTimestamp) > Date.parse(latest))) {
      latestIncidentByStudent.set(event.studentId, latestTimestamp);
    }

    const gradeRow =
      gradeRollupMap.get(grade) ??
      {
        grade,
        studentCount: 0,
        incidentCount: 0,
        totalPoints: 0,
        activeInterventions: 0
      };
    gradeRow.incidentCount += 1;
    gradeRow.totalPoints += event.points;
    gradeRollupMap.set(grade, gradeRow);

    const reasonKey = (event.reason ?? event.violation ?? event.violationRaw ?? "Unspecified").trim() || "Unspecified";
    const reasonRow =
      reasonRollupMap.get(reasonKey) ??
      {
        reason: reasonKey,
        incidentCount: 0,
        totalPoints: 0
      };
    reasonRow.incidentCount += 1;
    reasonRow.totalPoints += event.points;
    reasonRollupMap.set(reasonKey, reasonRow);
    incrementCounter(sourceBreakdown, event.sourceType);
  }

  const activeInterventionCountByStudent = new Map<string, number>();
  const interventionStatus: Record<string, number> = {};
  for (const intervention of filteredInterventions) {
    incrementCounter(interventionStatus, intervention.status);
    if (intervention.status === "open" || intervention.status === "in_progress" || intervention.status === "overdue") {
      activeInterventionCountByStudent.set(
        intervention.studentId,
        (activeInterventionCountByStudent.get(intervention.studentId) ?? 0) + 1
      );
      const student = studentById.get(intervention.studentId);
      if (student) {
        const gradeRow = gradeRollupMap.get(student.grade);
        if (gradeRow) {
          gradeRow.activeInterventions += 1;
        }
      }
    }
  }

  const notificationStatus: Record<string, number> = {};
  const notificationCountByStudent = new Map<string, number>();
  for (const notification of filteredNotifications) {
    incrementCounter(notificationStatus, notification.status);
    notificationCountByStudent.set(
      notification.studentId,
      (notificationCountByStudent.get(notification.studentId) ?? 0) + 1
    );
  }

  const studentRows = [...scopedStudents.values()]
    .map((student): StudentReportRow => ({
      studentId: student.studentId,
      fullName: student.fullName,
      grade: student.grade,
      incidentCount: incidentsByStudent.get(student.studentId) ?? 0,
      totalPoints: pointsByStudent.get(student.studentId) ?? 0,
      activeInterventions: student.localStudentId ? activeInterventionCountByStudent.get(student.localStudentId) ?? 0 : 0,
      notificationCount: student.localStudentId ? notificationCountByStudent.get(student.localStudentId) ?? 0 : 0,
      latestIncidentAt: latestIncidentByStudent.get(student.studentId) ?? null
    }))
    .filter((row) => row.incidentCount > 0 || row.activeInterventions > 0 || row.notificationCount > 0)
    .sort((left, right) => {
      if (right.totalPoints !== left.totalPoints) {
        return right.totalPoints - left.totalPoints;
      }
      return right.incidentCount - left.incidentCount;
    });

  const incidentsByGrade = [...gradeRollupMap.values()].sort((left, right) => {
    if (right.totalPoints !== left.totalPoints) {
      return right.totalPoints - left.totalPoints;
    }
    return left.grade.localeCompare(right.grade);
  });

  const topReasons = [...reasonRollupMap.values()]
    .sort((left, right) => {
      if (right.incidentCount !== left.incidentCount) {
        return right.incidentCount - left.incidentCount;
      }
      return right.totalPoints - left.totalPoints;
    })
    .slice(0, 8);

  const totalPoints = filteredEvents.reduce((sum, event) => sum + event.points, 0);
  const openInterventions = filteredInterventions.filter((intervention) =>
    ["open", "in_progress", "overdue"].includes(intervention.status)
  );
  const summary: ReportSummaryMetric[] = [
    {
      label: "Students in scope",
      value: scopedStudents.size,
      description: "Students represented by the current grade, date, and source slice."
    },
    {
      label: "Discipline events",
      value: filteredEvents.length,
      description: "Unified discipline events inside the active reporting window."
    },
    {
      label: "Total points",
      value: totalPoints,
      description: "Cumulative discipline points inside this reporting frame."
    },
    {
      label: "Active interventions",
      value: openInterventions.length,
      description: "Open, in-progress, or overdue interventions tied to students in scope."
    },
    {
      label: "Queued notifications",
      value: activeNotificationCount(filteredNotifications),
      description: "Messages still waiting for dispatch in the selected reporting scope."
    }
  ];

  const topGrade = incidentsByGrade[0];
  const topReason = topReasons[0];
  const narrativeParts = [
    normalizedFilters.sourceType
      ? `This view is scoped to ${normalizedFilters.sourceType === "sycamore_api" ? "Sycamore primary-source" : "PDF fallback"} events only.`
      : "This view uses unified discipline events with Sycamore as the primary source and PDF as fallback.",
    topGrade
      ? `Grade ${topGrade.grade} carries the heaviest load with ${topGrade.incidentCount} incidents and ${topGrade.totalPoints} points.`
      : "No discipline events fall inside the current reporting window.",
    topReason ? `${topReason.reason} is the most common driver in this slice.` : "No dominant discipline driver is available yet.",
    openInterventions.length > 0
      ? `${openInterventions.length} active interventions still need follow-through.`
      : "No active interventions are open in this slice."
  ];

  return {
    generatedAt: new Date().toISOString(),
    filters: normalizedFilters,
    summary,
    incidentsByGrade,
    topReasons,
    studentRows,
    interventionStatus: sortCounts(interventionStatus),
    notificationStatus: sortCounts(notificationStatus),
    sourceBreakdown: sortCounts(sourceBreakdown),
    narrative: narrativeParts.join(" ")
  };
}

export function toCsv(rows: Array<Record<string, string | number | null>>): string {
  if (rows.length === 0) {
    return "";
  }

  const headers = Object.keys(rows[0] ?? {});
  const escape = (value: string | number | null) => {
    const normalized = value === null ? "" : String(value);
    if (normalized.includes(",") || normalized.includes("\"") || normalized.includes("\n")) {
      return `"${normalized.replace(/"/g, "\"\"")}"`;
    }
    return normalized;
  };

  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escape(row[header] ?? "")).join(","))
  ];
  return lines.join("\n");
}

export function studentLabel(student: Student | undefined, fallbackId: string): string {
  return student?.fullName || fallbackId;
}
