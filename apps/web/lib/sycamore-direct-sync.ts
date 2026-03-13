import { z } from "zod";

import { type AppStorageAdapter } from "@/lib/local-storage-adapter";
import { createSupabaseServerClient } from "@/lib/supabase-server-client";
import { createStorageAdapter } from "@/lib/storage";
import { upsertRosterStudent } from "@/lib/student-identity";
import {
  createSupabaseSycamoreStore,
  type SycamoreDisciplineLogRecord,
  type SycamoreStore,
  type SycamoreSyncLogRecord,
  type SycamoreSyncMode,
  type SycamoreSyncStatus
} from "@/lib/sycamore-direct-store";
import {
  fetchSycamoreDetentionDetail,
  fetchSycamoreDisciplineLogDetail,
  fetchSycamoreDisciplineRange,
  fetchSycamoreStudentDisciplineOverview,
  fetchSycamoreStudents,
  getSycamoreClientConfigFromEnv,
  isSycamoreSyncConfigured,
  type SycamoreClientConfig,
  type SycamoreClientDependencies
} from "@/lib/sycamore-client";
import {
  normalizeSycamoreGrade,
  normalizeSycamorePersonName,
  normalizeSycamoreStudentRecords,
  splitSycamoreViolation
} from "@/lib/sycamore-normalizer";

const isoDateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sycamoreGradeSchema = z.enum(["6", "7", "8", "9", "10", "11", "12"]);

export const sycamoreDirectSyncRequestSchema = z
  .object({
    startDate: isoDateOnlySchema.optional(),
    endDate: isoDateOnlySchema.optional(),
    incremental: z.boolean().optional(),
    grade: sycamoreGradeSchema.optional(),
    studentNames: z.array(z.string().trim().min(1)).max(50).optional(),
    studentIds: z.array(z.string().trim().min(1)).max(50).optional(),
    triggered_by: z.enum(["manual", "cron"]).optional()
  })
  .superRefine((value, context) => {
    if ((value.grade || value.studentNames?.length || value.studentIds?.length) && !(value.startDate && value.endDate)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startDate"],
        message: "Targeted student or grade sync requires both `startDate` and `endDate`."
      });
    }

    if ((value.startDate && !value.endDate) || (!value.startDate && value.endDate)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startDate"],
        message: "Both `startDate` and `endDate` are required for a manual range sync."
      });
    }

    if (value.startDate && value.endDate && value.startDate > value.endDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "`endDate` must be on or after `startDate`."
      });
    }

    if (value.incremental && (value.startDate || value.endDate)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["incremental"],
        message: "Incremental sync cannot be combined with an explicit date range."
      });
    }

    if (value.incremental && (value.studentNames?.length || value.studentIds?.length)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["incremental"],
        message: "Incremental sync cannot be combined with explicit student filters."
      });
    }

    if (value.incremental && value.grade) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["incremental"],
        message: "Incremental sync cannot be combined with a grade filter."
      });
    }
  });

export type SycamoreDirectSyncRequest = z.infer<typeof sycamoreDirectSyncRequestSchema>;

export interface SycamoreDirectSyncResult {
  syncLogId: string;
  status: SycamoreSyncStatus;
  syncMode: SycamoreSyncMode;
  window: {
    startDate: string;
    endDate: string;
  };
  recordsDiscovered: number;
  recordsUpserted: number;
  warnings: string[];
  rosterSync: Omit<SycamoreRosterSyncResult, "warnings">;
  startedAt: string;
  completedAt: string;
  triggeredBy: string;
}

export type SycamoreSyncStage = "roster" | "discovery" | "detail_fetch" | "upsert" | "complete" | "failed";
type SycamoreActiveSyncStage = Exclude<SycamoreSyncStage, "complete" | "failed">;

export interface SycamoreSyncProgressSnapshot {
  syncLogId: string;
  syncMode: SycamoreSyncMode;
  window: {
    startDate: string;
    endDate: string;
  };
  startedAt: string;
  updatedAt: string;
  stage: SycamoreSyncStage;
  stageIndex: number;
  stageCount: number;
  stageLabel: string;
  stageDescription: string;
  stageProgress: number | null;
  overallProgress: number;
  rosterStudentsFetched: number;
  rosterStudentsUpserted: number;
  rosterStudentsLinked: number;
  discoveryStudentsProcessed: number;
  discoveryStudentsTotal: number;
  discoveredRecords: number;
  detailRecordsProcessed: number;
  detailRecordsTotal: number;
  recordsUpserted: number;
  warningsCount: number;
  message: string;
}

export interface SycamoreDashboardSummary {
  configured: boolean;
  error?: string;
  totalLogs: number;
  linkedLogs: number;
  lastSync: SycamoreSyncLogRecord | null;
  recentLogs: Array<{
    sycamoreLogId: string;
    studentId: string;
    studentRecordId: string | null;
    studentName: string | null;
    grade: string | null;
    incidentDate: string | null;
    points: number;
    level: number | null;
    violation: string | null;
    violationRaw: string | null;
    incidentType: string | null;
    resolution: string | null;
    consequence: string | null;
    authorName: string | null;
    syncedAt: string;
  }>;
}

export interface SycamoreDataOpsSummary {
  configured: boolean;
  baseUrl: string;
  schoolId: string | null;
  pathTemplate: string;
  totalLogs: number;
  linkedLogs: number;
  totalSyncs: number;
  failedSyncs: number;
  lastCompletedAt: string | null;
  lastSuccessfulCompletedAt: string | null;
  lastFailedAt: string | null;
  lastWindow: {
    startDate: string;
    endDate: string;
  } | null;
  lastSuccessfulWindow: {
    startDate: string;
    endDate: string;
  } | null;
  lastRecordsDiscovered: number | null;
  lastRecordsUpserted: number | null;
  lastSyncMode: SycamoreSyncMode | null;
  error?: string;
}

export interface SycamoreDirectSyncPlan {
  syncMode: SycamoreSyncMode;
  window: {
    startDate: string;
    endDate: string;
  };
}

interface StudentSyncTargets {
  studentNames: string[];
  studentIds: string[];
  grade: string | null;
}

interface RunSycamoreDirectSyncInput {
  request?: SycamoreDirectSyncRequest;
  triggeredBy: "manual" | "cron";
  store?: SycamoreStore;
  storage?: AppStorageAdapter;
  config?: SycamoreClientConfig;
  dependencies?: SycamoreClientDependencies;
  onProgress?: (snapshot: SycamoreSyncProgressSnapshot) => void | Promise<void>;
}

export interface SycamoreRosterSyncResult {
  attempted: boolean;
  fetchedStudents: number;
  upsertedStudents: number;
  linkedStudents: number;
  linkedDisciplineLogs: number;
  warnings: string[];
}

const SYNC_STAGE_ORDER: SycamoreActiveSyncStage[] = ["roster", "discovery", "detail_fetch", "upsert"];
const SYNC_STAGE_WEIGHTS: Record<SycamoreActiveSyncStage, number> = {
  roster: 0.16,
  discovery: 0.18,
  detail_fetch: 0.56,
  upsert: 0.1
};
const SYCAMORE_LOG_ID_KEYS = [
  "LogID",
  "LogId",
  "logID",
  "logId",
  "ID",
  "Id",
  "id",
  "DisciplineLogID",
  "DisciplineLogId",
  "disciplineLogId",
  "DisciplineID",
  "DisciplineId",
  "disciplineId"
] as const;
const SYCAMORE_STUDENT_ID_KEYS = [
  "StudentID",
  "StudentId",
  "studentID",
  "studentId",
  "student_id",
  "StudentIDNumber",
  "studentIDNumber",
  "StudentNumber",
  "studentNumber"
] as const;
const SYCAMORE_STUDENT_NAME_KEYS = [
  "Student",
  "StudentName",
  "student",
  "studentName",
  "StudentFullName",
  "studentFullName",
  "FullName",
  "fullName",
  "Name",
  "name"
] as const;
const SYCAMORE_GRADE_KEYS = [
  "Grade",
  "GradeLevel",
  "CurrentGrade",
  "grade",
  "gradeLevel",
  "currentGrade"
] as const;
const SYCAMORE_VIOLATION_KEYS = [
  "Violation",
  "Type",
  "IncidentType",
  "Category",
  "Reason",
  "violation",
  "type",
  "incidentType",
  "category",
  "reason"
] as const;
const SYCAMORE_AUTHOR_KEYS = [
  "Author",
  "AssignedBy",
  "Staff",
  "EnteredBy",
  "Teacher",
  "TeacherName",
  "CreatedBy",
  "author",
  "assignedBy",
  "staff",
  "enteredBy",
  "teacher",
  "teacherName",
  "createdBy"
] as const;
const SYCAMORE_RESOLUTION_KEYS = [
  "Resolution",
  "Consequence",
  "Action",
  "Result",
  "resolution",
  "consequence",
  "action",
  "result"
] as const;
const SYCAMORE_POINTS_KEYS = ["Points", "PointValue", "points", "pointValue"] as const;
const SYCAMORE_DESCRIPTION_KEYS = [
  "Description",
  "Notes",
  "Comment",
  "Narrative",
  "Details",
  "description",
  "notes",
  "comment",
  "narrative",
  "details"
] as const;
const SYCAMORE_DATE_KEYS = [
  "Date",
  "IncidentDate",
  "OccurredOn",
  "CreatedDate",
  "date",
  "incidentDate",
  "occurredOn",
  "createdDate"
] as const;
const SYCAMORE_CREATED_AT_KEYS = ["Created", "created"] as const;
const SYCAMORE_DETENTION_ID_KEYS = [
  "DetentionID",
  "DetentionId",
  "detentionID",
  "detentionId",
  "detention_id",
  "LinkedDetentionID",
  "LinkedDetentionId",
  "linkedDetentionID",
  "linkedDetentionId"
] as const;
const SYCAMORE_QUARTER_KEYS = ["Quarter", "quarter"] as const;
const SYCAMORE_MANAGER_NOTIFIED_KEYS = ["ManagerNotified", "managerNotified"] as const;
const SYCAMORE_FAMILY_NOTIFIED_KEYS = ["FamilyNotified", "familyNotified"] as const;
const SYCAMORE_STUDENT_NOTIFIED_KEYS = ["StudentNotified", "studentNotified"] as const;

function normalizeLookupValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function resolveStudentSyncTargets(request: SycamoreDirectSyncRequest): StudentSyncTargets | null {
  const studentNames = [...new Set((request.studentNames ?? []).map((value) => value.trim()).filter(Boolean))];
  const studentIds = [...new Set((request.studentIds ?? []).map((value) => value.trim()).filter(Boolean))];
  const grade = request.grade?.trim() || null;
  return studentNames.length > 0 || studentIds.length > 0 || Boolean(grade)
    ? {
        studentNames,
        studentIds,
        grade
      }
    : null;
}

function hasSupabaseServiceRoleEnv(): boolean {
  return Boolean(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function envNumber(name: string, fallback: number, min = 0): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.trunc(parsed));
}

function trimText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function pickFirst(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in source) {
      const value = source[key];
      if (value !== null && value !== undefined && value !== "") {
        return value;
      }
    }
  }
  return null;
}

function toIsoDateOnly(value: unknown): string | null {
  const text = trimText(value);
  if (!text) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const mdyMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    const month = mdyMatch[1] ?? "1";
    const day = mdyMatch[2] ?? "1";
    const year = mdyMatch[3] ?? "1970";
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString().slice(0, 10);
}

function toIsoTimestamp(value: unknown): string | null {
  const text = trimText(value);
  if (!text) {
    return null;
  }

  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString();
}

function toInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  const text = trimText(value);
  if (!text) {
    return null;
  }

  const match = text.match(/[+-]?\d+/);
  if (!match?.[0]) {
    return null;
  }

  return Number(match[0]);
}

function toBooleanFlag(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value !== 0;
  }

  const text = trimText(value)?.toLowerCase();
  if (!text) {
    return null;
  }

  if (["true", "t", "yes", "y", "1", "on"].includes(text)) {
    return true;
  }
  if (["false", "f", "no", "n", "0", "off"].includes(text)) {
    return false;
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed !== 0 : null;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayIsoDate(): string {
  const configured = process.env.SYCAMORE_SYNC_TODAY?.trim();
  if (configured && /^\d{4}-\d{2}-\d{2}$/.test(configured)) {
    return configured;
  }
  return new Date().toISOString().slice(0, 10);
}

function currentSchoolYearStart(today: string): string {
  const month = envNumber("SYCAMORE_SCHOOL_YEAR_START_MONTH", 8, 1);
  const day = envNumber("SYCAMORE_SCHOOL_YEAR_START_DAY", 1, 1);
  const currentYear = Number(today.slice(0, 4));
  const currentMonthDay = today.slice(5);
  const schoolYearStartMonthDay = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const year = currentMonthDay >= schoolYearStartMonthDay ? currentYear : currentYear - 1;
  return `${year}-${schoolYearStartMonthDay}`;
}

function buildWarningSummary(warnings: string[]): string | null {
  if (warnings.length === 0) {
    return null;
  }

  const summary = warnings.join("\n");
  return summary.length > 4000 ? `${summary.slice(0, 3997)}...` : summary;
}

function isRosterSyncEnabled(): boolean {
  const raw = (process.env.SYCAMORE_ROSTER_SYNC_ENABLED ?? "true").trim().toLowerCase();
  return !(raw === "false" || raw === "0" || raw === "off");
}

function studentFallbackDiscoveryConcurrency(): number {
  return Math.min(envNumber("SYCAMORE_FALLBACK_DISCOVERY_CONCURRENCY", 4, 1), 12);
}

function isNonBlockingWarning(warning: string): boolean {
  return (
    warning.startsWith("sycamore_no_records:") ||
    warning.startsWith("sycamore_school_list_empty_fallback_used:") ||
    warning.startsWith("sycamore_school_rows_missing_ids_fallback_used:") ||
    warning.startsWith("sycamore_student_target_sync:")
  );
}

function listEntryLogId(entry: Record<string, unknown>): string | null {
  return trimText(pickFirst(entry, [...SYCAMORE_LOG_ID_KEYS]));
}

function listEntryStudentId(entry: Record<string, unknown>): string | null {
  return trimText(pickFirst(entry, [...SYCAMORE_STUDENT_ID_KEYS]));
}

function rosterStudentId(student: Record<string, unknown>): string | null {
  return trimText(pickFirst(student, ["ID", "Id", "id", ...SYCAMORE_STUDENT_ID_KEYS]));
}

function rosterStudentName(student: Record<string, unknown>): string | null {
  const direct = trimText(pickFirst(student, [...SYCAMORE_STUDENT_NAME_KEYS]));
  if (direct) {
    return direct;
  }

  const firstName = trimText(pickFirst(student, ["FirstName", "PreferredFirstName"])) ?? "";
  const lastName = trimText(pickFirst(student, ["LastName"])) ?? "";
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || null;
}

function rosterStudentGrade(student: Record<string, unknown>): string | null {
  return normalizeSycamoreGrade(trimText(pickFirst(student, [...SYCAMORE_GRADE_KEYS])));
}

function entryOccurredOn(entry: Record<string, unknown>): string | null {
  return toIsoDateOnly(pickFirst(entry, [...SYCAMORE_DATE_KEYS, ...SYCAMORE_CREATED_AT_KEYS, "__sycamoreOccurredOn"]));
}

function entryFallsWithinWindow(entry: Record<string, unknown>, window: { startDate: string; endDate: string }): boolean {
  const occurredOn = entryOccurredOn(entry);
  return Boolean(occurredOn && occurredOn >= window.startDate && occurredOn <= window.endDate);
}

function hasResolvableDisciplineEntry(entry: Record<string, unknown>): boolean {
  return Boolean(listEntryStudentId(entry) && listEntryLogId(entry));
}

interface DiscoveredDisciplineEntries {
  records: Array<Record<string, unknown>>;
  warnings: string[];
  source: "school" | "student_fallback";
}

interface StudentFallbackDiscoveryProgress {
  processedStudents: number;
  totalStudents: number;
  discoveredRecords: number;
  reason: "school_empty" | "school_rows_missing_ids" | "targeted";
}

function filterRosterStudents(
  students: Array<Record<string, unknown>>,
  targets: StudentSyncTargets | null
): {
  students: Array<Record<string, unknown>>;
  warnings: string[];
} {
  if (!targets) {
    return {
      students,
      warnings: []
    };
  }

  const warnings: string[] = [];
  const remainingNames = new Set(targets.studentNames.map(normalizeLookupValue));
  const remainingIds = new Set(targets.studentIds.map((value) => value.trim()));
  const hasIdentitySelectors = targets.studentNames.length > 0 || targets.studentIds.length > 0;
  const filtered = students.filter((student) => {
    const studentId = rosterStudentId(student);
    const normalizedName = normalizeLookupValue(rosterStudentName(student) ?? "");
    const grade = rosterStudentGrade(student);
    const matchesId = Boolean(studentId && remainingIds.has(studentId));
    const matchesName = Boolean(normalizedName && remainingNames.has(normalizedName));
    const matchesGrade = !targets.grade || grade === targets.grade;
    const matchesIdentity = hasIdentitySelectors ? matchesId || matchesName : true;

    if (matchesId && studentId && matchesGrade) {
      remainingIds.delete(studentId);
    }
    if (matchesName && normalizedName && matchesGrade) {
      remainingNames.delete(normalizedName);
    }

    return matchesIdentity && matchesGrade;
  });

  for (const missingId of remainingIds) {
    warnings.push(`sycamore_target_student_id_not_found:${missingId}`);
  }
  for (const missingName of remainingNames) {
    warnings.push(`sycamore_target_student_name_not_found:${missingName}`);
  }

  return {
    students: filtered,
    warnings
  };
}

async function fetchDisciplineEntriesByStudentFallback(
  window: { startDate: string; endDate: string },
  config: SycamoreClientConfig,
  dependencies: SycamoreClientDependencies,
  sleep: (ms: number) => Promise<void>,
  throttleDelayMs: number,
  targets: StudentSyncTargets | null,
  fallbackReason: "school_empty" | "school_rows_missing_ids" | "targeted",
  schoolRowCount?: number,
  onProgress?: (progress: StudentFallbackDiscoveryProgress) => void | Promise<void>
): Promise<DiscoveredDisciplineEntries> {
  const students = await fetchSycamoreStudents(config, dependencies);
  const filtered = filterRosterStudents(students, targets);
  const warnings = [
    fallbackReason === "targeted"
      ? `sycamore_student_target_sync:${window.startDate}:${window.endDate}:${filtered.students.length}`
      : fallbackReason === "school_rows_missing_ids"
        ? `sycamore_school_rows_missing_ids_fallback_used:${window.startDate}:${window.endDate}:${schoolRowCount ?? 0}`
        : `sycamore_school_list_empty_fallback_used:${window.startDate}:${window.endDate}:${students.length}`,
    ...filtered.warnings
  ];
  const records: Array<Record<string, unknown>> = [];
  const totalStudents = filtered.students.length;
  let processedStudents = 0;
  let nextStudentIndex = 0;
  const progressBatchSize = totalStudents > 250 ? 25 : 10;
  const emitProgress = async (force = false) => {
    if (!onProgress) {
      return;
    }

    if (
      !force &&
      processedStudents !== totalStudents &&
      processedStudents !== 1 &&
      processedStudents % progressBatchSize !== 0
    ) {
      return;
    }

    await onProgress({
      processedStudents,
      totalStudents,
      discoveredRecords: records.length,
      reason: fallbackReason
    });
  };

  await emitProgress(true);

  const workerCount = Math.min(studentFallbackDiscoveryConcurrency(), Math.max(totalStudents, 1));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextStudentIndex;
      nextStudentIndex += 1;
      if (index >= totalStudents) {
        return;
      }

      const student = filtered.students[index] as Record<string, unknown>;
      const studentId = rosterStudentId(student);

      if (!studentId) {
        warnings.push(`sycamore_student_scan_skipped_missing_id:${JSON.stringify(student)}`);
        processedStudents += 1;
        await emitProgress();
        continue;
      }

      try {
        const overview = await fetchSycamoreStudentDisciplineOverview(studentId, config, dependencies);
        for (const row of overview) {
          if (!entryFallsWithinWindow(row, window)) {
            continue;
          }

          records.push({
            ...row,
            StudentID: listEntryStudentId(row) ?? studentId,
            Student: trimText(pickFirst(row, [...SYCAMORE_STUDENT_NAME_KEYS])) ?? rosterStudentName(student),
            Grade: trimText(pickFirst(row, [...SYCAMORE_GRADE_KEYS])) ?? rosterStudentGrade(student),
            __sycamoreOccurredOn: entryOccurredOn(row)
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown student discipline scan error.";
        warnings.push(`sycamore_student_scan_failed:${studentId}:${message}`);
      }

      processedStudents += 1;
      await emitProgress();

      if (throttleDelayMs > 0 && nextStudentIndex < totalStudents) {
        await sleep(throttleDelayMs);
      }
    }
  });

  await Promise.all(workers);

  return { records, warnings, source: "student_fallback" };
}

async function discoverDisciplineEntries(
  window: { startDate: string; endDate: string },
  config: SycamoreClientConfig,
  dependencies: SycamoreClientDependencies,
  sleep: (ms: number) => Promise<void>,
  throttleDelayMs: number,
  targets: StudentSyncTargets | null,
  onProgress?: (progress: StudentFallbackDiscoveryProgress) => void | Promise<void>
): Promise<DiscoveredDisciplineEntries> {
  if (targets) {
    return fetchDisciplineEntriesByStudentFallback(
      window,
      config,
      dependencies,
      sleep,
      throttleDelayMs,
      targets,
      "targeted",
      undefined,
      onProgress
    );
  }

  const schoolLevel = await fetchSycamoreDisciplineRange(window, config, dependencies);
  const usableSchoolRecords = schoolLevel.records.filter(hasResolvableDisciplineEntry);
  const unusableSchoolRecords = schoolLevel.records.length - usableSchoolRecords.length;
  if (usableSchoolRecords.length > 0) {
    return {
      records: usableSchoolRecords,
      warnings:
        unusableSchoolRecords > 0
          ? [
              ...schoolLevel.warnings,
              `sycamore_school_rows_missing_ids_skipped:${window.startDate}:${window.endDate}:${unusableSchoolRecords}`
            ]
          : schoolLevel.warnings,
      source: "school"
    };
  }

  const fallback = await fetchDisciplineEntriesByStudentFallback(
    window,
    config,
    dependencies,
    sleep,
    throttleDelayMs,
    null,
    usableSchoolRecords.length === 0 && unusableSchoolRecords > 0 ? "school_rows_missing_ids" : "school_empty",
    unusableSchoolRecords,
    onProgress
  );
  if (fallback.records.length > 0) {
    return {
      records: fallback.records,
      warnings: [...schoolLevel.warnings, ...fallback.warnings],
      source: "student_fallback"
    };
  }

  return {
    records: [],
    warnings: [...schoolLevel.warnings, ...fallback.warnings],
    source: "student_fallback"
  };
}

function detailDetentionId(detail: Record<string, unknown>, entry: Record<string, unknown>): string | null {
  return trimText(pickFirst(detail, [...SYCAMORE_DETENTION_ID_KEYS]) ?? pickFirst(entry, [...SYCAMORE_DETENTION_ID_KEYS]));
}

function mapDisciplineLogRecord(input: {
  entry: Record<string, unknown>;
  detail: Record<string, unknown>;
  detentionPayload: Record<string, unknown> | null;
  schoolId: string;
  studentRecordId: string | null;
  syncedAt: string;
}): SycamoreDisciplineLogRecord {
  const studentId =
    listEntryStudentId(input.entry) ??
    trimText(pickFirst(input.detail, [...SYCAMORE_STUDENT_ID_KEYS])) ??
    "unknown_student";
  const logId =
    listEntryLogId(input.entry) ??
    trimText(pickFirst(input.detail, [...SYCAMORE_LOG_ID_KEYS])) ??
    "unknown_log";
  const violationRaw =
    trimText(pickFirst(input.detail, [...SYCAMORE_VIOLATION_KEYS]) ?? pickFirst(input.entry, [...SYCAMORE_VIOLATION_KEYS])) ??
    null;
  const violationParts = splitSycamoreViolation(violationRaw);
  const authorNameRaw =
    trimText(pickFirst(input.detail, [...SYCAMORE_AUTHOR_KEYS]) ?? pickFirst(input.entry, [...SYCAMORE_AUTHOR_KEYS])) ??
    null;
  const authorName = normalizeSycamorePersonName(authorNameRaw);
  const resolution =
    trimText(pickFirst(input.detail, [...SYCAMORE_RESOLUTION_KEYS]) ?? pickFirst(input.entry, [...SYCAMORE_RESOLUTION_KEYS])) ??
    null;
  const points = toInteger(pickFirst(input.detail, [...SYCAMORE_POINTS_KEYS]) ?? pickFirst(input.entry, [...SYCAMORE_POINTS_KEYS])) ?? 0;

  return {
    sycamoreLogId: logId,
    studentId,
    studentRecordId: input.studentRecordId,
    studentName:
      trimText(pickFirst(input.detail, [...SYCAMORE_STUDENT_NAME_KEYS]) ?? pickFirst(input.entry, [...SYCAMORE_STUDENT_NAME_KEYS])) ??
      null,
    grade:
      normalizeSycamoreGrade(trimText(pickFirst(input.detail, [...SYCAMORE_GRADE_KEYS]) ?? pickFirst(input.entry, [...SYCAMORE_GRADE_KEYS]))) ??
      null,
    schoolId: input.schoolId,
    incidentDate:
      toIsoDateOnly(pickFirst(input.detail, [...SYCAMORE_DATE_KEYS]) ?? pickFirst(input.entry, [...SYCAMORE_DATE_KEYS, "__sycamoreOccurredOn"])) ??
      null,
    points,
    level: violationParts.level,
    violation: violationParts.violation,
    violationRaw: violationParts.violationRaw,
    incidentType: violationParts.violationRaw ?? violationParts.violation,
    description:
      trimText(
        pickFirst(input.detail, [...SYCAMORE_DESCRIPTION_KEYS]) ?? pickFirst(input.entry, [...SYCAMORE_DESCRIPTION_KEYS])
      ) ?? null,
    resolution,
    consequence: resolution,
    authorName,
    authorNameRaw,
    assignedBy: authorName ?? authorNameRaw,
    quarter: trimText(pickFirst(input.detail, [...SYCAMORE_QUARTER_KEYS]) ?? pickFirst(input.entry, [...SYCAMORE_QUARTER_KEYS])) ?? null,
    createdAtSycamore:
      toIsoTimestamp(pickFirst(input.detail, [...SYCAMORE_CREATED_AT_KEYS]) ?? pickFirst(input.entry, [...SYCAMORE_CREATED_AT_KEYS])) ??
      null,
    managerNotified: toBooleanFlag(pickFirst(input.detail, [...SYCAMORE_MANAGER_NOTIFIED_KEYS])),
    familyNotified: toBooleanFlag(pickFirst(input.detail, [...SYCAMORE_FAMILY_NOTIFIED_KEYS])),
    studentNotified: toBooleanFlag(pickFirst(input.detail, [...SYCAMORE_STUDENT_NOTIFIED_KEYS])),
    detentionId: detailDetentionId(input.detail, input.entry),
    rawPayload: {
      listEntry: input.entry,
      disciplineDetail: input.detail
    },
    detentionPayload: input.detentionPayload,
    syncedAt: input.syncedAt
  };
}

function baseDataOpsSummary(): SycamoreDataOpsSummary {
  return {
    configured: isSycamoreSyncConfigured(),
    baseUrl: process.env.SYCAMORE_API_BASE_URL?.trim() || "https://app.sycamoreschool.com/api/v1",
    schoolId: process.env.SYCAMORE_SCHOOL_ID?.trim() || null,
    pathTemplate: process.env.SYCAMORE_DISCIPLINE_PATH_TEMPLATE?.trim() || "/School/{schoolId}/Discipline",
    totalLogs: 0,
    linkedLogs: 0,
    totalSyncs: 0,
    failedSyncs: 0,
    lastCompletedAt: null,
    lastSuccessfulCompletedAt: null,
    lastFailedAt: null,
    lastWindow: null,
    lastSuccessfulWindow: null,
    lastRecordsDiscovered: null,
    lastRecordsUpserted: null,
    lastSyncMode: null
  };
}

function baseDashboardSummary(): SycamoreDashboardSummary {
  return {
    configured: isSycamoreSyncConfigured(),
    totalLogs: 0,
    linkedLogs: 0,
    lastSync: null,
    recentLogs: []
  };
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function stageIndex(stage: SycamoreSyncStage): number {
  if (stage === "complete" || stage === "failed") {
    return SYNC_STAGE_ORDER.length;
  }

  const index = SYNC_STAGE_ORDER.indexOf(stage);
  return index >= 0 ? index : 0;
}

function overallProgressForStage(stage: SycamoreSyncStage, stageProgress: number | null): number {
  if (stage === "complete") {
    return 1;
  }

  const completedWeight = SYNC_STAGE_ORDER.slice(0, stageIndex(stage)).reduce(
    (sum, key) => sum + SYNC_STAGE_WEIGHTS[key],
    0
  );

  if (stage === "failed") {
    return clampProgress(completedWeight);
  }

  const currentWeight = SYNC_STAGE_WEIGHTS[stage as SycamoreActiveSyncStage] ?? 0;
  const normalizedStageProgress = stageProgress === null ? 0 : clampProgress(stageProgress);
  return clampProgress(completedWeight + currentWeight * normalizedStageProgress);
}

function stageLabel(stage: SycamoreSyncStage): string {
  switch (stage) {
    case "roster":
      return "Roster";
    case "discovery":
      return "Discovery";
    case "detail_fetch":
      return "Detail fetch";
    case "upsert":
      return "Upsert";
    case "complete":
      return "Complete";
    case "failed":
      return "Failed";
  }
}

async function emitSycamoreSyncProgress(
  callback: RunSycamoreDirectSyncInput["onProgress"],
  snapshot: SycamoreSyncProgressSnapshot
): Promise<void> {
  if (!callback) {
    return;
  }
  await callback(snapshot);
}

async function resolveSyncPlan(store: SycamoreStore, request: SycamoreDirectSyncRequest): Promise<SycamoreDirectSyncPlan> {
  if (request.startDate && request.endDate) {
    return {
      syncMode: "manual_range",
      window: {
        startDate: request.startDate,
        endDate: request.endDate
      }
    };
  }

  const latestSuccessfulSync = await store.getLatestSuccessfulSyncLog();
  if (!latestSuccessfulSync?.windowEndDate) {
    const endDate = todayIsoDate();
    return {
      syncMode: "initial_backfill",
      window: {
        startDate: currentSchoolYearStart(endDate),
        endDate
      }
    };
  }

  const overlapDays = envNumber("SYCAMORE_INCREMENTAL_OVERLAP_DAYS", 1, 1);
  const startDate = addDays(latestSuccessfulSync.windowEndDate, -(overlapDays - 1));
  return {
    syncMode: "incremental",
    window: {
      startDate,
      endDate: todayIsoDate()
    }
  };
}

export async function resolveSycamoreDirectSyncPlan(input?: {
  request?: SycamoreDirectSyncRequest;
  store?: SycamoreStore;
}): Promise<SycamoreDirectSyncPlan> {
  const request = sycamoreDirectSyncRequestSchema.parse(input?.request ?? {});
  const store = input?.store ?? createDefaultStore();
  await store.ensureSchema();
  return resolveSyncPlan(store, request);
}

function createDefaultStore(): SycamoreStore {
  return createSupabaseSycamoreStore(createSupabaseServerClient());
}

function emptyRosterSyncResult(): SycamoreRosterSyncResult {
  return {
    attempted: false,
    fetchedStudents: 0,
    upsertedStudents: 0,
    linkedStudents: 0,
    linkedDisciplineLogs: 0,
    warnings: []
  };
}

async function syncSycamoreRosterLinks(input: {
  storage: AppStorageAdapter | null;
  store: SycamoreStore;
  config: SycamoreClientConfig;
  dependencies?: SycamoreClientDependencies;
}): Promise<SycamoreRosterSyncResult> {
  if (!input.storage || !isRosterSyncEnabled()) {
    return emptyRosterSyncResult();
  }

  const nowIso = new Date().toISOString();

  try {
    const rosterRecords = await fetchSycamoreStudents(input.config, input.dependencies);
    const normalized = normalizeSycamoreStudentRecords(rosterRecords, nowIso);
    const externalStudentIds: string[] = [];

    for (const student of normalized.students) {
      const upserted = await upsertRosterStudent(input.storage, student, nowIso);
      if (upserted.externalId) {
        externalStudentIds.push(upserted.externalId);
      }
    }

    const studentLinks = await input.store.resolveStudentRecordLinks(externalStudentIds);
    const linkedDisciplineLogs = await input.store.backfillDisciplineLogLinks(studentLinks);

    return {
      attempted: true,
      fetchedStudents: rosterRecords.length,
      upsertedStudents: normalized.students.length,
      linkedStudents: studentLinks.size,
      linkedDisciplineLogs,
      warnings: normalized.warnings
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Sycamore roster sync failure.";
    return {
      attempted: true,
      fetchedStudents: 0,
      upsertedStudents: 0,
      linkedStudents: 0,
      linkedDisciplineLogs: 0,
      warnings: [`sycamore_roster_sync_failed:${message}`]
    };
  }
}

export async function backfillSycamoreStudentLinks(input?: {
  store?: SycamoreStore;
  storage?: AppStorageAdapter;
  config?: SycamoreClientConfig;
  dependencies?: SycamoreClientDependencies;
}): Promise<SycamoreRosterSyncResult> {
  if (!isSycamoreSyncConfigured()) {
    throw new Error("Sycamore sync is not configured in this environment.");
  }
  if (!hasSupabaseServiceRoleEnv() && !input?.store) {
    throw new Error("Supabase service-role credentials are required for Sycamore roster backfill.");
  }

  const store = input?.store ?? createDefaultStore();
  const storage = input?.storage ?? (hasSupabaseServiceRoleEnv() ? createStorageAdapter() : null);
  const config = input?.config ?? getSycamoreClientConfigFromEnv();

  await store.ensureSchema();
  if (storage) {
    await storage.ensureSchema();
  }

  return syncSycamoreRosterLinks({
    storage,
    store,
    config,
    dependencies: input?.dependencies
  });
}

export async function runSycamoreDirectSync(input: RunSycamoreDirectSyncInput): Promise<SycamoreDirectSyncResult> {
  if (!isSycamoreSyncConfigured()) {
    throw new Error("Sycamore sync is not configured in this environment.");
  }
  if (!hasSupabaseServiceRoleEnv() && !input.store) {
    throw new Error("Supabase service-role credentials are required for direct Sycamore sync.");
  }

  const request = sycamoreDirectSyncRequestSchema.parse(input.request ?? {});
  const store = input.store ?? createDefaultStore();
  const storage = input.storage ?? (hasSupabaseServiceRoleEnv() ? createStorageAdapter() : null);
  const config = input.config ?? getSycamoreClientConfigFromEnv();
  const dependencies = input.dependencies ?? {};
  const throttleDelayMs = envNumber("SYCAMORE_REQUEST_DELAY_MS", 150, 0);
  const sleep = dependencies.sleep ?? (async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const studentTargets = resolveStudentSyncTargets(request);

  await store.ensureSchema();
  if (storage) {
    await storage.ensureSchema();
  }

  const plan = await resolveSyncPlan(store, request);
  const syncLog = await store.createSyncLog({
    triggeredBy: input.triggeredBy,
    syncMode: plan.syncMode,
    windowStartDate: plan.window.startDate,
    windowEndDate: plan.window.endDate
  });

  const progressState = {
    rosterStudentsFetched: 0,
    rosterStudentsUpserted: 0,
    rosterStudentsLinked: 0,
    discoveryStudentsProcessed: 0,
    discoveryStudentsTotal: 0,
    discoveredRecords: 0,
    detailRecordsProcessed: 0,
    detailRecordsTotal: 0,
    recordsUpserted: 0,
    warningsCount: 0
  };

  const pushProgress = async (
    stage: SycamoreSyncStage,
    inputStage: {
      stageProgress: number | null;
      stageDescription: string;
      message: string;
    }
  ) => {
    progressState.warningsCount = warnings.length;

    await emitSycamoreSyncProgress(input.onProgress, {
      syncLogId: syncLog.id,
      syncMode: plan.syncMode,
      window: plan.window,
      startedAt: syncLog.startedAt,
      updatedAt: new Date().toISOString(),
      stage,
      stageIndex: stageIndex(stage),
      stageCount: SYNC_STAGE_ORDER.length,
      stageLabel: stageLabel(stage),
      stageDescription: inputStage.stageDescription,
      stageProgress: inputStage.stageProgress,
      overallProgress: overallProgressForStage(stage, inputStage.stageProgress),
      rosterStudentsFetched: progressState.rosterStudentsFetched,
      rosterStudentsUpserted: progressState.rosterStudentsUpserted,
      rosterStudentsLinked: progressState.rosterStudentsLinked,
      discoveryStudentsProcessed: progressState.discoveryStudentsProcessed,
      discoveryStudentsTotal: progressState.discoveryStudentsTotal,
      discoveredRecords: progressState.discoveredRecords,
      detailRecordsProcessed: progressState.detailRecordsProcessed,
      detailRecordsTotal: progressState.detailRecordsTotal,
      recordsUpserted: progressState.recordsUpserted,
      warningsCount: progressState.warningsCount,
      message: inputStage.message
    });
  };

  const warnings: string[] = [];
  await pushProgress("roster", {
    stageProgress: 0,
    stageDescription: "Refreshing the Sycamore roster and linking students before discipline import begins.",
    message: "Starting roster preparation."
  });
  const rosterSync = await syncSycamoreRosterLinks({
    storage,
    store,
    config,
    dependencies
  });
  progressState.rosterStudentsFetched = rosterSync.fetchedStudents;
  progressState.rosterStudentsUpserted = rosterSync.upsertedStudents;
  progressState.rosterStudentsLinked = rosterSync.linkedStudents;
  warnings.push(...rosterSync.warnings);
  await pushProgress("roster", {
    stageProgress: 1,
    stageDescription: "Refreshing the Sycamore roster and linking students before discipline import begins.",
    message: `Roster ready: ${rosterSync.upsertedStudents} students refreshed, ${rosterSync.linkedStudents} linked locally.`
  });

  try {
    await pushProgress("discovery", {
      stageProgress: null,
      stageDescription: "Collecting the set of discipline records that match this sync window.",
      message: "Discovering discipline records in Sycamore."
    });
    const fetched = await discoverDisciplineEntries(
      plan.window,
      config,
      dependencies,
      sleep,
      throttleDelayMs,
      studentTargets,
      async (discoveryProgress) => {
        progressState.discoveryStudentsProcessed = discoveryProgress.processedStudents;
        progressState.discoveryStudentsTotal = discoveryProgress.totalStudents;
        progressState.discoveredRecords = discoveryProgress.discoveredRecords;
        const stageProgress =
          discoveryProgress.totalStudents > 0 ? discoveryProgress.processedStudents / discoveryProgress.totalStudents : 0;
        const stageDescription =
          discoveryProgress.reason === "targeted"
            ? "Scanning the selected Sycamore student timelines for matching discipline records."
            : "Scanning individual Sycamore student timelines because the school-wide feed returned no usable rows.";
        const message =
          discoveryProgress.totalStudents > 0
            ? `Scanned ${discoveryProgress.processedStudents} of ${discoveryProgress.totalStudents} students and found ${discoveryProgress.discoveredRecords} record${discoveryProgress.discoveredRecords === 1 ? "" : "s"} so far.`
            : "No students matched the current fallback scan.";

        await pushProgress("discovery", {
          stageProgress,
          stageDescription,
          message
        });
      }
    );
    warnings.push(...fetched.warnings);
    if (fetched.source === "student_fallback") {
      progressState.discoveryStudentsProcessed = progressState.discoveryStudentsTotal;
    }
    progressState.discoveredRecords = fetched.records.length;
    await pushProgress("discovery", {
      stageProgress: 1,
      stageDescription:
        fetched.source === "student_fallback"
          ? "Finished scanning individual Sycamore student timelines for this sync window."
          : "Collecting the set of discipline records that match this sync window.",
      message:
        fetched.source === "student_fallback" && progressState.discoveryStudentsTotal > 0
          ? `Discovery complete after scanning ${progressState.discoveryStudentsProcessed} students: ${fetched.records.length} record${fetched.records.length === 1 ? "" : "s"} found.`
          : `Discovery complete: ${fetched.records.length} record${fetched.records.length === 1 ? "" : "s"} found.`
    });

    const uniqueStudentIds = [...new Set(fetched.records.map(listEntryStudentId).filter((value): value is string => Boolean(value)))];
    const studentLinks = await store.resolveStudentRecordLinks(uniqueStudentIds);
    const records: SycamoreDisciplineLogRecord[] = [];
    progressState.detailRecordsTotal = fetched.records.length;
    await pushProgress("detail_fetch", {
      stageProgress: fetched.records.length === 0 ? 1 : 0,
      stageDescription: "Loading full discipline detail for each discovered Sycamore record.",
      message:
        fetched.records.length === 0
          ? "No record details needed for this sync window."
          : `Fetching detail for ${fetched.records.length} discovered record${fetched.records.length === 1 ? "" : "s"}.`
    });

    for (let index = 0; index < fetched.records.length; index += 1) {
      const entry = fetched.records[index] as Record<string, unknown>;
      const studentId = listEntryStudentId(entry);
      const logId = listEntryLogId(entry);

      if (!studentId || !logId) {
        warnings.push(`sycamore_skipped_entry_missing_ids:${JSON.stringify(entry)}`);
        progressState.detailRecordsProcessed += 1;
        continue;
      }

      let detail: Record<string, unknown>;
      try {
        detail = await fetchSycamoreDisciplineLogDetail(studentId, logId, config, dependencies);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown discipline detail error.";
        warnings.push(`sycamore_detail_fetch_failed:${studentId}:${logId}:${message}`);
        progressState.detailRecordsProcessed += 1;
        if (
          progressState.detailRecordsProcessed === fetched.records.length ||
          progressState.detailRecordsProcessed === 1 ||
          progressState.detailRecordsProcessed % 5 === 0
        ) {
          await pushProgress("detail_fetch", {
            stageProgress:
              fetched.records.length === 0 ? 1 : progressState.detailRecordsProcessed / fetched.records.length,
            stageDescription: "Loading full discipline detail for each discovered Sycamore record.",
            message: `Fetched detail for ${progressState.detailRecordsProcessed} of ${fetched.records.length} records.`
          });
        }
        continue;
      }

      let detentionPayload: Record<string, unknown> | null = null;
      const detentionId = detailDetentionId(detail, entry);
      if (detentionId) {
        try {
          detentionPayload = await fetchSycamoreDetentionDetail(studentId, detentionId, config, dependencies);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown detention detail error.";
          warnings.push(`sycamore_detention_fetch_failed:${studentId}:${detentionId}:${message}`);
        }
      }

      records.push(
        mapDisciplineLogRecord({
          entry,
          detail,
          detentionPayload,
          schoolId: config.schoolId,
          studentRecordId: studentLinks.get(studentId) ?? null,
          syncedAt: new Date().toISOString()
        })
      );
      progressState.detailRecordsProcessed += 1;

      if (
        progressState.detailRecordsProcessed === fetched.records.length ||
        progressState.detailRecordsProcessed === 1 ||
        progressState.detailRecordsProcessed % 5 === 0
      ) {
        await pushProgress("detail_fetch", {
          stageProgress: fetched.records.length === 0 ? 1 : progressState.detailRecordsProcessed / fetched.records.length,
          stageDescription: "Loading full discipline detail for each discovered Sycamore record.",
          message: `Fetched detail for ${progressState.detailRecordsProcessed} of ${fetched.records.length} records.`
        });
      }

      if (throttleDelayMs > 0 && index < fetched.records.length - 1) {
        await sleep(throttleDelayMs);
      }
    }

    await pushProgress("upsert", {
      stageProgress: records.length === 0 ? 1 : 0,
      stageDescription: "Writing the normalized Sycamore records into the mirrored Supabase table.",
      message:
        records.length === 0
          ? "No rows needed to be written for this sync."
          : `Writing ${records.length} normalized record${records.length === 1 ? "" : "s"} to Supabase.`
    });
    await store.upsertDisciplineLogs(records);
    progressState.recordsUpserted = records.length;
    await pushProgress("upsert", {
      stageProgress: 1,
      stageDescription: "Writing the normalized Sycamore records into the mirrored Supabase table.",
      message: `Upsert complete: ${records.length} row${records.length === 1 ? "" : "s"} written.`
    });

    const blockingWarnings = warnings.filter((warning) => !isNonBlockingWarning(warning));
    const status: SycamoreSyncStatus =
      blockingWarnings.length === 0 ? "success" : records.length > 0 ? "partial" : "failed";
    const completedAt = new Date().toISOString();
    const warningSummary = buildWarningSummary(warnings);

    await store.updateSyncLog(syncLog.id, {
      completedAt,
      status,
      recordsDiscovered: fetched.records.length,
      recordsSynced: records.length,
      recordsUpserted: records.length,
      errorMessage: warningSummary
    });

    await pushProgress("complete", {
      stageProgress: 1,
      stageDescription: status === "partial" ? "The sync completed with warnings." : "The sync completed successfully.",
      message:
        status === "partial"
          ? `Sync completed with warnings. ${records.length} row${records.length === 1 ? "" : "s"} stored.`
          : `Sync completed successfully. ${records.length} row${records.length === 1 ? "" : "s"} stored.`
    });

    return {
      syncLogId: syncLog.id,
      status,
      syncMode: plan.syncMode,
      window: plan.window,
      recordsDiscovered: fetched.records.length,
      recordsUpserted: records.length,
      warnings,
      rosterSync: {
        attempted: rosterSync.attempted,
        fetchedStudents: rosterSync.fetchedStudents,
        upsertedStudents: rosterSync.upsertedStudents,
        linkedStudents: rosterSync.linkedStudents,
        linkedDisciplineLogs: rosterSync.linkedDisciplineLogs
      },
      startedAt: syncLog.startedAt,
      completedAt,
      triggeredBy: input.triggeredBy
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Sycamore sync failure.";
    const completedAt = new Date().toISOString();
    await pushProgress("failed", {
      stageProgress: null,
      stageDescription: "The sync stopped before completion.",
      message
    });

    await store.updateSyncLog(syncLog.id, {
      completedAt,
      status: "failed",
      recordsDiscovered: 0,
      recordsSynced: 0,
      recordsUpserted: 0,
      errorMessage: buildWarningSummary([...warnings, message]) ?? message
    });

    throw error;
  }
}

export async function buildSycamoreDashboardSummary(store?: SycamoreStore): Promise<SycamoreDashboardSummary> {
  const summary = baseDashboardSummary();
  if (!hasSupabaseServiceRoleEnv() && !store) {
    return summary;
  }

  const activeStore = store ?? createDefaultStore();
  try {
    await activeStore.ensureSchema();
    const [counts, lastSync, recentLogs] = await Promise.all([
      activeStore.getDisciplineCounts(),
      activeStore.getLatestSyncLog(),
      activeStore.listRecentDisciplineLogs(6)
    ]);

    return {
      ...summary,
      totalLogs: counts.total,
      linkedLogs: counts.linked,
      lastSync,
      recentLogs: recentLogs.map((row) => ({
        sycamoreLogId: row.sycamoreLogId,
        studentId: row.studentId,
        studentRecordId: row.studentRecordId,
        studentName: row.studentName,
        grade: row.grade,
        incidentDate: row.incidentDate,
        points: row.points,
        level: row.level,
        violation: row.violation,
        violationRaw: row.violationRaw,
        incidentType: row.incidentType,
        resolution: row.resolution,
        consequence: row.consequence,
        authorName: row.authorName,
        syncedAt: row.syncedAt
      }))
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Sycamore dashboard summary error.";
    return {
      ...summary,
      error: message
    };
  }
}

export async function buildSycamoreDataOpsSummary(store?: SycamoreStore): Promise<SycamoreDataOpsSummary> {
  const summary = baseDataOpsSummary();
  if (!hasSupabaseServiceRoleEnv() && !store) {
    return summary;
  }

  const activeStore = store ?? createDefaultStore();
  try {
    await activeStore.ensureSchema();
    const [counts, syncCounts, recentSyncs] = await Promise.all([
      activeStore.getDisciplineCounts(),
      activeStore.getSyncCounts(),
      activeStore.listRecentSyncLogs(20)
    ]);

    const latestSync = recentSyncs[0] ?? null;
    const latestSuccessfulSync = recentSyncs.find((row) => row.status === "success" || row.status === "partial") ?? null;
    const latestFailedSync = recentSyncs.find((row) => row.status === "failed") ?? null;

    return {
      ...summary,
      totalLogs: counts.total,
      linkedLogs: counts.linked,
      totalSyncs: syncCounts.total,
      failedSyncs: syncCounts.failed,
      lastCompletedAt: latestSync?.completedAt ?? null,
      lastSuccessfulCompletedAt: latestSuccessfulSync?.completedAt ?? null,
      lastFailedAt: latestFailedSync?.completedAt ?? latestFailedSync?.startedAt ?? null,
      lastWindow:
        latestSync?.windowStartDate && latestSync?.windowEndDate
          ? {
              startDate: latestSync.windowStartDate,
              endDate: latestSync.windowEndDate
            }
          : null,
      lastSuccessfulWindow:
        latestSuccessfulSync?.windowStartDate && latestSuccessfulSync?.windowEndDate
          ? {
              startDate: latestSuccessfulSync.windowStartDate,
              endDate: latestSuccessfulSync.windowEndDate
            }
          : null,
      lastRecordsDiscovered: latestSync?.recordsDiscovered ?? null,
      lastRecordsUpserted: latestSync?.recordsUpserted ?? null,
      lastSyncMode: latestSync?.syncMode ?? null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Sycamore data-ops summary error.";
    return {
      ...summary,
      error: message
    };
  }
}
