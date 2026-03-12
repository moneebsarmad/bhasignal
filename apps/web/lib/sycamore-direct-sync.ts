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

interface DirectSyncPlan {
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
}

export interface SycamoreRosterSyncResult {
  attempted: boolean;
  fetchedStudents: number;
  upsertedStudents: number;
  linkedStudents: number;
  linkedDisciplineLogs: number;
  warnings: string[];
}

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

function isNonBlockingWarning(warning: string): boolean {
  return (
    warning.startsWith("sycamore_no_records:") ||
    warning.startsWith("sycamore_school_list_empty_fallback_used:") ||
    warning.startsWith("sycamore_student_target_sync:")
  );
}

function listEntryLogId(entry: Record<string, unknown>): string | null {
  return trimText(pickFirst(entry, ["LogID", "LogId", "ID", "Id", "DisciplineLogID", "DisciplineID"]));
}

function listEntryStudentId(entry: Record<string, unknown>): string | null {
  return trimText(pickFirst(entry, ["StudentID", "StudentId", "StudentIDNumber", "StudentNumber"]));
}

function rosterStudentId(student: Record<string, unknown>): string | null {
  return trimText(pickFirst(student, ["ID", "Id", "StudentID", "StudentId"]));
}

function rosterStudentName(student: Record<string, unknown>): string | null {
  const direct = trimText(pickFirst(student, ["Student", "StudentName", "Name", "FullName"]));
  if (direct) {
    return direct;
  }

  const firstName = trimText(pickFirst(student, ["FirstName", "PreferredFirstName"])) ?? "";
  const lastName = trimText(pickFirst(student, ["LastName"])) ?? "";
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || null;
}

function rosterStudentGrade(student: Record<string, unknown>): string | null {
  return normalizeSycamoreGrade(trimText(pickFirst(student, ["Grade", "GradeLevel", "CurrentGrade"])));
}

function entryOccurredOn(entry: Record<string, unknown>): string | null {
  return toIsoDateOnly(pickFirst(entry, ["Date", "IncidentDate", "OccurredOn", "Created", "__sycamoreOccurredOn"]));
}

function entryFallsWithinWindow(entry: Record<string, unknown>, window: { startDate: string; endDate: string }): boolean {
  const occurredOn = entryOccurredOn(entry);
  return Boolean(occurredOn && occurredOn >= window.startDate && occurredOn <= window.endDate);
}

interface DiscoveredDisciplineEntries {
  records: Array<Record<string, unknown>>;
  warnings: string[];
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
  targets: StudentSyncTargets | null
): Promise<DiscoveredDisciplineEntries> {
  const students = await fetchSycamoreStudents(config, dependencies);
  const filtered = filterRosterStudents(students, targets);
  const warnings = [
    targets
      ? `sycamore_student_target_sync:${window.startDate}:${window.endDate}:${filtered.students.length}`
      : `sycamore_school_list_empty_fallback_used:${window.startDate}:${window.endDate}:${students.length}`,
    ...filtered.warnings
  ];
  const records: Array<Record<string, unknown>> = [];

  for (let index = 0; index < filtered.students.length; index += 1) {
    const student = filtered.students[index] as Record<string, unknown>;
    const studentId = rosterStudentId(student);

    if (!studentId) {
      warnings.push(`sycamore_student_scan_skipped_missing_id:${JSON.stringify(student)}`);
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
          Student: trimText(pickFirst(row, ["Student", "StudentName"])) ?? rosterStudentName(student),
          Grade: trimText(pickFirst(row, ["Grade", "GradeLevel"])) ?? rosterStudentGrade(student),
          __sycamoreOccurredOn: entryOccurredOn(row)
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown student discipline scan error.";
      warnings.push(`sycamore_student_scan_failed:${studentId}:${message}`);
    }

    if (throttleDelayMs > 0 && index < filtered.students.length - 1) {
      await sleep(throttleDelayMs);
    }
  }

  return { records, warnings };
}

async function discoverDisciplineEntries(
  window: { startDate: string; endDate: string },
  config: SycamoreClientConfig,
  dependencies: SycamoreClientDependencies,
  sleep: (ms: number) => Promise<void>,
  throttleDelayMs: number,
  targets: StudentSyncTargets | null
): Promise<DiscoveredDisciplineEntries> {
  if (targets) {
    return fetchDisciplineEntriesByStudentFallback(window, config, dependencies, sleep, throttleDelayMs, targets);
  }

  const schoolLevel = await fetchSycamoreDisciplineRange(window, config, dependencies);
  if (schoolLevel.records.length > 0) {
    return schoolLevel;
  }

  const fallback = await fetchDisciplineEntriesByStudentFallback(
    window,
    config,
    dependencies,
    sleep,
    throttleDelayMs,
    null
  );
  if (fallback.records.length > 0) {
    return fallback;
  }

  return {
    records: [],
    warnings: [...schoolLevel.warnings, ...fallback.warnings]
  };
}

function detailDetentionId(detail: Record<string, unknown>, entry: Record<string, unknown>): string | null {
  return trimText(
    pickFirst(detail, ["DetentionID", "DetentionId", "LinkedDetentionID", "LinkedDetentionId"]) ??
      pickFirst(entry, ["DetentionID", "DetentionId", "LinkedDetentionID", "LinkedDetentionId"])
  );
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
    trimText(pickFirst(input.detail, ["StudentID", "StudentId", "StudentIDNumber", "StudentNumber"])) ??
    "unknown_student";
  const logId =
    listEntryLogId(input.entry) ??
    trimText(pickFirst(input.detail, ["LogID", "LogId", "ID", "Id", "DisciplineLogID", "DisciplineID"])) ??
    "unknown_log";
  const violationRaw =
    trimText(
      pickFirst(input.detail, ["Violation", "Type", "IncidentType", "Category", "Reason"]) ??
        pickFirst(input.entry, ["Violation", "Type", "IncidentType", "Category", "Reason"])
    ) ?? null;
  const violationParts = splitSycamoreViolation(violationRaw);
  const authorNameRaw =
    trimText(
      pickFirst(input.detail, ["Author", "AssignedBy", "Staff", "EnteredBy", "Teacher", "TeacherName", "CreatedBy"]) ??
        pickFirst(input.entry, ["Author", "AssignedBy", "Staff", "EnteredBy", "Teacher", "TeacherName", "CreatedBy"])
    ) ?? null;
  const authorName = normalizeSycamorePersonName(authorNameRaw);
  const resolution =
    trimText(
      pickFirst(input.detail, ["Resolution", "Consequence", "Action", "Result"]) ??
        pickFirst(input.entry, ["Resolution", "Consequence", "Action", "Result"])
    ) ?? null;
  const points =
    toInteger(pickFirst(input.detail, ["Points", "PointValue"]) ?? pickFirst(input.entry, ["Points", "PointValue"])) ?? 0;

  return {
    sycamoreLogId: logId,
    studentId,
    studentRecordId: input.studentRecordId,
    studentName:
      trimText(
        pickFirst(input.detail, ["StudentName", "Student", "StudentFullName", "FullName", "Name"]) ??
          pickFirst(input.entry, ["StudentName", "Student", "StudentFullName", "FullName", "Name"])
      ) ?? null,
    grade:
      normalizeSycamoreGrade(
        trimText(
          pickFirst(input.detail, ["Grade", "GradeLevel", "CurrentGrade"]) ??
            pickFirst(input.entry, ["Grade", "GradeLevel", "CurrentGrade"])
        )
      ) ?? null,
    schoolId: input.schoolId,
    incidentDate:
      toIsoDateOnly(
        pickFirst(input.detail, ["Date", "IncidentDate", "OccurredOn", "CreatedDate"]) ??
          pickFirst(input.entry, ["Date", "IncidentDate", "__sycamoreOccurredOn"])
      ) ?? null,
    points,
    level: violationParts.level,
    violation: violationParts.violation,
    violationRaw: violationParts.violationRaw,
    incidentType: violationParts.violationRaw ?? violationParts.violation,
    description:
      trimText(
        pickFirst(input.detail, ["Description", "Notes", "Comment", "Narrative", "Details"]) ??
          pickFirst(input.entry, ["Description", "Notes", "Comment", "Narrative", "Details"])
      ) ?? null,
    resolution,
    consequence: resolution,
    authorName,
    authorNameRaw,
    assignedBy: authorName ?? authorNameRaw,
    quarter: trimText(pickFirst(input.detail, ["Quarter"]) ?? pickFirst(input.entry, ["Quarter"])) ?? null,
    createdAtSycamore:
      toIsoTimestamp(pickFirst(input.detail, ["Created"]) ?? pickFirst(input.entry, ["Created"])) ?? null,
    managerNotified: toBooleanFlag(pickFirst(input.detail, ["ManagerNotified"])),
    familyNotified: toBooleanFlag(pickFirst(input.detail, ["FamilyNotified"])),
    studentNotified: toBooleanFlag(pickFirst(input.detail, ["StudentNotified"])),
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

async function resolveSyncPlan(store: SycamoreStore, request: SycamoreDirectSyncRequest): Promise<DirectSyncPlan> {
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

  const warnings: string[] = [];
  const rosterSync = await syncSycamoreRosterLinks({
    storage,
    store,
    config,
    dependencies
  });
  warnings.push(...rosterSync.warnings);

  try {
    const fetched = await discoverDisciplineEntries(plan.window, config, dependencies, sleep, throttleDelayMs, studentTargets);
    warnings.push(...fetched.warnings);

    const uniqueStudentIds = [...new Set(fetched.records.map(listEntryStudentId).filter((value): value is string => Boolean(value)))];
    const studentLinks = await store.resolveStudentRecordLinks(uniqueStudentIds);
    const records: SycamoreDisciplineLogRecord[] = [];

    for (let index = 0; index < fetched.records.length; index += 1) {
      const entry = fetched.records[index] as Record<string, unknown>;
      const studentId = listEntryStudentId(entry);
      const logId = listEntryLogId(entry);

      if (!studentId || !logId) {
        warnings.push(`sycamore_skipped_entry_missing_ids:${JSON.stringify(entry)}`);
        continue;
      }

      let detail: Record<string, unknown>;
      try {
        detail = await fetchSycamoreDisciplineLogDetail(studentId, logId, config, dependencies);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown discipline detail error.";
        warnings.push(`sycamore_detail_fetch_failed:${studentId}:${logId}:${message}`);
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

      if (throttleDelayMs > 0 && index < fetched.records.length - 1) {
        await sleep(throttleDelayMs);
      }
    }

    await store.upsertDisciplineLogs(records);

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
