import { z } from "zod";

import type { ApprovedIncident, Student } from "@syc/domain";

import { createSupabaseServerClient } from "@/lib/supabase-server-client";
import {
  parseSycamoreDisciplineLogRow,
  type SycamoreDisciplineLogRecord
} from "@/lib/sycamore-direct-store";

const isoDateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const sycamoreReconciliationRequestSchema = z
  .object({
    startDate: isoDateOnlySchema,
    endDate: isoDateOnlySchema,
    studentNames: z.array(z.string().trim().min(1)).min(1).max(50)
  })
  .superRefine((value, context) => {
    if (value.startDate > value.endDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "`endDate` must be on or after `startDate`."
      });
    }
  });

export type SycamoreReconciliationRequest = z.infer<typeof sycamoreReconciliationRequestSchema>;

export interface ReconciliationRecordView {
  sourceRecordId: string;
  studentId: string;
  studentName: string | null;
  grade: string | null;
  incidentDate: string | null;
  points: number;
  level: number | null;
  violation: string | null;
  violationRaw: string | null;
  resolution: string | null;
  authorName: string | null;
}

export interface ReconciliationFieldDiff {
  field: "incidentDate" | "points" | "level" | "violation" | "violationRaw" | "resolution" | "authorName" | "grade";
  label: string;
  sycamoreValue: string | number | null;
  pdfValue: string | number | null;
}

export interface ReconciliationRow {
  status: "matched" | "field_mismatch" | "sycamore_only" | "pdf_only";
  matchKey: string;
  sycamore: ReconciliationRecordView | null;
  pdf: ReconciliationRecordView | null;
  diffs: ReconciliationFieldDiff[];
}

export interface ReconciliationStudentSection {
  requestedName: string;
  notes: string[];
  pdfResolvedStudents: Array<{
    id: string;
    fullName: string;
    grade: string;
  }>;
  sycamoreResolvedStudents: Array<{
    studentId: string;
    studentName: string | null;
    grade: string | null;
  }>;
  counts: {
    sycamore: number;
    pdf: number;
    matched: number;
    fieldMismatch: number;
    sycamoreOnly: number;
    pdfOnly: number;
  };
  rows: ReconciliationRow[];
}

export interface SycamoreReconciliationReport {
  generatedAt: string;
  window: {
    startDate: string;
    endDate: string;
  };
  requestedStudents: string[];
  summary: {
    studentsRequested: number;
    studentsWithAnyRecords: number;
    sycamoreRecords: number;
    pdfRecords: number;
    matched: number;
    fieldMismatch: number;
    sycamoreOnly: number;
    pdfOnly: number;
  };
  students: ReconciliationStudentSection[];
}

function normalizeLookupValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeCompareValue(value: string | number | null): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number") {
    return String(value);
  }
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeLooseTextCompareValue(value: string | null | undefined): string {
  const normalized = toNullableString(value);
  if (!normalized) {
    return "";
  }

  return normalized
    .toLowerCase()
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAuthorCompareValue(value: string | null | undefined): string {
  const normalized = toNullableString(value);
  if (!normalized) {
    return "";
  }

  return normalized
    .replace(/^[,;:\-\s]+/, "")
    .replace(/[,;:\-\s]+$/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function toNullableString(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeGradeValue(value: string | null | undefined): string | null {
  const normalized = toNullableString(value);
  if (!normalized) {
    return null;
  }

  const comparable = normalizeLookupValue(normalized);
  if (comparable === "unknown" || comparable === "n/a" || comparable === "na" || comparable === "null") {
    return null;
  }

  return normalized;
}

function approvedIncidentDate(incident: ApprovedIncident): string | null {
  const fromWriteupDate = toNullableString(incident.writeupDate ?? undefined);
  if (fromWriteupDate) {
    return fromWriteupDate;
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

function isWithinDateWindow(value: string | null, window: { startDate: string; endDate: string }): boolean {
  return Boolean(value && value >= window.startDate && value <= window.endDate);
}

function buildPdfRecordView(incident: ApprovedIncident, student: Student | null): ReconciliationRecordView {
  return {
    sourceRecordId: incident.sourceRecordId,
    studentId: student?.externalId ?? incident.studentId,
    studentName: student?.fullName ?? null,
    grade: normalizeGradeValue(incident.gradeAtEvent ?? student?.grade ?? null),
    incidentDate: approvedIncidentDate(incident),
    points: incident.points,
    level: incident.level ?? null,
    violation: incident.violation ?? incident.reason ?? null,
    violationRaw: incident.violationRaw ?? incident.violation ?? incident.reason ?? null,
    resolution: incident.resolution ?? null,
    authorName: incident.authorName ?? incident.authorNameRaw ?? incident.teacherName ?? null
  };
}

function buildSycamoreRecordView(record: SycamoreDisciplineLogRecord): ReconciliationRecordView {
  return {
    sourceRecordId: record.sycamoreLogId,
    studentId: record.studentId,
    studentName: record.studentName,
    grade: normalizeGradeValue(record.grade),
    incidentDate: record.incidentDate,
    points: record.points,
    level: record.level,
    violation: record.violation,
    violationRaw: record.violationRaw,
    resolution: record.resolution,
    authorName: record.authorName ?? record.authorNameRaw ?? record.assignedBy
  };
}

function matchKey(record: ReconciliationRecordView): string {
  return [
    record.incidentDate ?? "",
    String(record.points),
    String(record.level ?? ""),
    normalizeCompareValue(record.violation ?? record.violationRaw)
  ].join("|");
}

function sortRecordViews(left: ReconciliationRecordView, right: ReconciliationRecordView): number {
  return (
    (left.incidentDate ?? "").localeCompare(right.incidentDate ?? "") ||
    left.points - right.points ||
    (left.violation ?? "").localeCompare(right.violation ?? "") ||
    (left.authorName ?? "").localeCompare(right.authorName ?? "") ||
    left.sourceRecordId.localeCompare(right.sourceRecordId)
  );
}

function compareFields(
  sycamore: ReconciliationRecordView,
  pdf: ReconciliationRecordView
): ReconciliationFieldDiff[] {
  const candidates: Array<{
    field: ReconciliationFieldDiff["field"];
    label: string;
    sycamoreValue: string | number | null;
    pdfValue: string | number | null;
  }> = [
    {
      field: "incidentDate",
      label: "Incident date",
      sycamoreValue: sycamore.incidentDate,
      pdfValue: pdf.incidentDate
    },
    {
      field: "points",
      label: "Points",
      sycamoreValue: sycamore.points,
      pdfValue: pdf.points
    },
    {
      field: "level",
      label: "Level",
      sycamoreValue: sycamore.level,
      pdfValue: pdf.level
    },
    {
      field: "violation",
      label: "Violation",
      sycamoreValue: sycamore.violation,
      pdfValue: pdf.violation
    },
    {
      field: "violationRaw",
      label: "Violation raw",
      sycamoreValue: sycamore.violationRaw,
      pdfValue: pdf.violationRaw
    },
    {
      field: "resolution",
      label: "Resolution",
      sycamoreValue: sycamore.resolution,
      pdfValue: pdf.resolution
    },
    {
      field: "authorName",
      label: "Author",
      sycamoreValue: sycamore.authorName,
      pdfValue: pdf.authorName
    },
    {
      field: "grade",
      label: "Grade",
      sycamoreValue: sycamore.grade,
      pdfValue: pdf.grade
    }
  ];

  return candidates.filter((candidate) => {
    if (candidate.field === "grade") {
      const sycamoreGrade = normalizeGradeValue(
        typeof candidate.sycamoreValue === "string" ? candidate.sycamoreValue : null
      );
      const pdfGrade = normalizeGradeValue(typeof candidate.pdfValue === "string" ? candidate.pdfValue : null);
      if (!sycamoreGrade || !pdfGrade) {
        return false;
      }
      return normalizeCompareValue(sycamoreGrade) !== normalizeCompareValue(pdfGrade);
    }

    if (candidate.field === "resolution") {
      return (
        normalizeLooseTextCompareValue(typeof candidate.sycamoreValue === "string" ? candidate.sycamoreValue : null) !==
        normalizeLooseTextCompareValue(typeof candidate.pdfValue === "string" ? candidate.pdfValue : null)
      );
    }

    if (candidate.field === "authorName") {
      return (
        normalizeAuthorCompareValue(typeof candidate.sycamoreValue === "string" ? candidate.sycamoreValue : null) !==
        normalizeAuthorCompareValue(typeof candidate.pdfValue === "string" ? candidate.pdfValue : null)
      );
    }

    return normalizeCompareValue(candidate.sycamoreValue) !== normalizeCompareValue(candidate.pdfValue);
  });
}

function groupByMatchKey(records: ReconciliationRecordView[]): Map<string, ReconciliationRecordView[]> {
  const grouped = new Map<string, ReconciliationRecordView[]>();
  for (const record of records) {
    const key = matchKey(record);
    const existing = grouped.get(key) ?? [];
    existing.push(record);
    existing.sort(sortRecordViews);
    grouped.set(key, existing);
  }
  return grouped;
}

function uniqueByKey<T>(values: T[], keyFor: (value: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    const key = keyFor(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function buildSycamoreReconciliationReport(input: {
  request: SycamoreReconciliationRequest;
  students: Student[];
  approvedIncidents: ApprovedIncident[];
  sycamoreLogs: SycamoreDisciplineLogRecord[];
}): SycamoreReconciliationReport {
  const request = sycamoreReconciliationRequestSchema.parse(input.request);
  const generatedAt = new Date().toISOString();
  const normalizedRequestedNames = request.studentNames.map((value) => ({
    requestedName: value,
    normalized: normalizeLookupValue(value)
  }));
  const studentsById = new Map(input.students.map((student) => [student.id, student] as const));

  const sections = normalizedRequestedNames.map(({ requestedName, normalized }) => {
    const pdfResolvedStudents = input.students.filter(
      (student) => normalizeLookupValue(student.fullName) === normalized
    );
    const pdfRecords = input.approvedIncidents
      .filter((incident) => incident.sourceType === "manual_pdf")
      .filter((incident) => pdfResolvedStudents.some((student) => student.id === incident.studentId))
      .map((incident) => buildPdfRecordView(incident, studentsById.get(incident.studentId) ?? null))
      .filter((record) => isWithinDateWindow(record.incidentDate, request))
      .sort(sortRecordViews);

    const sycamoreRecords = input.sycamoreLogs
      .filter((record) => normalizeLookupValue(record.studentName ?? "") === normalized)
      .map(buildSycamoreRecordView)
      .filter((record) => isWithinDateWindow(record.incidentDate, request))
      .sort(sortRecordViews);

    const notes: string[] = [];
    if (pdfResolvedStudents.length === 0) {
      notes.push("No local student matched this name in the approved PDF dataset.");
    } else if (pdfResolvedStudents.length > 1) {
      notes.push("Multiple local students matched this name; all matching approved incidents are included.");
    }
    if (sycamoreRecords.length === 0) {
      notes.push("No Sycamore discipline rows were found for this student in the selected window.");
    }

    const sycamoreByKey = groupByMatchKey(sycamoreRecords);
    const pdfByKey = groupByMatchKey(pdfRecords);
    const keys = [...new Set([...sycamoreByKey.keys(), ...pdfByKey.keys()])].sort();
    const rows: ReconciliationRow[] = [];

    for (const key of keys) {
      const sycamoreQueue = [...(sycamoreByKey.get(key) ?? [])];
      const pdfQueue = [...(pdfByKey.get(key) ?? [])];
      while (sycamoreQueue.length > 0 && pdfQueue.length > 0) {
        const sycamore = sycamoreQueue.shift() as ReconciliationRecordView;
        const pdf = pdfQueue.shift() as ReconciliationRecordView;
        const diffs = compareFields(sycamore, pdf);
        rows.push({
          status: diffs.length > 0 ? "field_mismatch" : "matched",
          matchKey: key,
          sycamore,
          pdf,
          diffs
        });
      }

      for (const sycamore of sycamoreQueue) {
        rows.push({
          status: "sycamore_only",
          matchKey: key,
          sycamore,
          pdf: null,
          diffs: []
        });
      }

      for (const pdf of pdfQueue) {
        rows.push({
          status: "pdf_only",
          matchKey: key,
          sycamore: null,
          pdf,
          diffs: []
        });
      }
    }

    const sortedRows = rows.sort((left, right) => {
      const leftDate = left.sycamore?.incidentDate ?? left.pdf?.incidentDate ?? "";
      const rightDate = right.sycamore?.incidentDate ?? right.pdf?.incidentDate ?? "";
      return (
        leftDate.localeCompare(rightDate) ||
        left.status.localeCompare(right.status) ||
        (left.sycamore?.sourceRecordId ?? left.pdf?.sourceRecordId ?? "").localeCompare(
          right.sycamore?.sourceRecordId ?? right.pdf?.sourceRecordId ?? ""
        )
      );
    });

    return {
      requestedName,
      notes,
      pdfResolvedStudents: pdfResolvedStudents.map((student) => ({
        id: student.id,
        fullName: student.fullName,
        grade: student.grade
      })),
      sycamoreResolvedStudents: uniqueByKey(
        sycamoreRecords.map((record) => ({
          studentId: record.studentId,
          studentName: record.studentName,
          grade: record.grade
        })),
        (record) => `${record.studentId}|${normalizeLookupValue(record.studentName ?? "")}`
      ),
      counts: {
        sycamore: sycamoreRecords.length,
        pdf: pdfRecords.length,
        matched: sortedRows.filter((row) => row.status === "matched").length,
        fieldMismatch: sortedRows.filter((row) => row.status === "field_mismatch").length,
        sycamoreOnly: sortedRows.filter((row) => row.status === "sycamore_only").length,
        pdfOnly: sortedRows.filter((row) => row.status === "pdf_only").length
      },
      rows: sortedRows
    };
  });

  return {
    generatedAt,
    window: {
      startDate: request.startDate,
      endDate: request.endDate
    },
    requestedStudents: request.studentNames,
    summary: {
      studentsRequested: sections.length,
      studentsWithAnyRecords: sections.filter((section) => section.counts.sycamore > 0 || section.counts.pdf > 0).length,
      sycamoreRecords: sections.reduce((sum, section) => sum + section.counts.sycamore, 0),
      pdfRecords: sections.reduce((sum, section) => sum + section.counts.pdf, 0),
      matched: sections.reduce((sum, section) => sum + section.counts.matched, 0),
      fieldMismatch: sections.reduce((sum, section) => sum + section.counts.fieldMismatch, 0),
      sycamoreOnly: sections.reduce((sum, section) => sum + section.counts.sycamoreOnly, 0),
      pdfOnly: sections.reduce((sum, section) => sum + section.counts.pdfOnly, 0)
    },
    students: sections
  };
}

export async function listSycamoreLogsForReconciliation(window: {
  startDate: string;
  endDate: string;
}): Promise<SycamoreDisciplineLogRecord[]> {
  const client = createSupabaseServerClient();
  const { data, error } = await client
    .from("sycamore_discipline_logs")
    .select("*")
    .gte("incident_date", window.startDate)
    .lte("incident_date", window.endDate)
    .order("incident_date", { ascending: true })
    .order("student_name", { ascending: true });

  if (error) {
    throw new Error(`Supabase select failed for table "sycamore_discipline_logs": ${error.message}`);
  }

  return ((data as Record<string, unknown>[] | null) ?? []).map(parseSycamoreDisciplineLogRow);
}

export function parseStudentNamesInput(value: string): string[] {
  return [...new Set(value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean))];
}
