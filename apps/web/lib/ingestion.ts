import type { IngestionSourceType, ParseRun, RawIncident, ReviewTask } from "@syc/domain";

import type { ParseRecord } from "@/lib/parser-contract";

export interface IngestionValidationLimits {
  maxBytes: number;
  maxPages: number;
}

export interface ReviewRules {
  criticalFieldMinConfidence: number;
  recordMinConfidence: number;
  warningTriggersReview: boolean;
}

export interface SourceCandidateRecord {
  sourceType: IngestionSourceType;
  sourceRecordId: string;
  studentReference: string;
  externalStudentId: string | null;
  gradeAtEvent: string | null;
  eventType: string | null;
  occurredAt: string;
  writeupDate: string | null;
  points: number;
  reason: string;
  violation: string | null;
  violationRaw: string | null;
  level: number | null;
  comment: string;
  description: string | null;
  resolution: string | null;
  teacherName: string;
  authorName: string | null;
  authorNameRaw: string | null;
  sourcePayloadJson: string;
  mappingWarningsJson: string;
  confidenceJson: string;
  studentConfidence: number | null;
  occurredAtConfidence: number | null;
  pointsConfidence: number | null;
  recordConfidence: number | null;
  warnings: string[];
}

export const defaultReviewRules: ReviewRules = {
  criticalFieldMinConfidence: 0.8,
  recordMinConfidence: 0.88,
  warningTriggersReview: true
};

export function countPdfPages(pdfBuffer: Buffer): number {
  const content = pdfBuffer.toString("latin1");
  const matches = content.match(/\/Type\s*\/Page\b/g);
  return matches?.length ?? 0;
}

export function createPendingParseRun(input: {
  id: string;
  sourceType?: IngestionSourceType;
  fileName: string;
  uploadedBy: string;
  triggeredBy?: string;
  metadataJson?: string;
  cursorJson?: string | null;
  startedAt: string;
}): ParseRun {
  return {
    id: input.id,
    sourceType: input.sourceType ?? "manual_pdf",
    fileName: input.fileName,
    uploadedBy: input.uploadedBy,
    triggeredBy: input.triggeredBy ?? input.uploadedBy,
    metadataJson: input.metadataJson ?? "{}",
    cursorJson: input.cursorJson ?? null,
    status: "pending",
    rowsExtracted: 0,
    rowsFlagged: 0,
    startedAt: input.startedAt,
    completedAt: null
  };
}

export function buildRawIncident(input: {
  parseRunId: string;
  record: ParseRecord;
  rowNumber: number;
}): RawIncident {
  const candidate = buildManualPdfCandidateRecord({
    record: input.record,
    rowNumber: input.rowNumber
  });
  return buildRawIncidentFromCandidate({
    parseRunId: input.parseRunId,
    candidate,
    rowNumber: input.rowNumber
  });
}

export function buildManualPdfCandidateRecord(input: {
  record: ParseRecord;
  rowNumber: number;
}): SourceCandidateRecord {
  const { record, rowNumber } = input;
  const sourceRecordId = `pdf_row_${String(rowNumber).padStart(4, "0")}`;
  const writeupDate = normalizeWriteupDate(record.writeupDate?.value ?? record.occurredAt.value);
  const violationRaw = normalizeNullableText(record.violationRaw?.value ?? record.reason.value);
  const violation = normalizeNullableText(record.violation?.value ?? record.reason.value);
  const description = normalizeNullableText(record.description?.value ?? record.comment.value);
  const resolution = normalizeNullableText(record.resolution?.value);
  const authorNameRaw = normalizeNullableText(record.authorNameRaw?.value ?? record.teacher.value);
  const authorName =
    normalizeNullableText(record.authorName?.value) ?? normalizeNullableText(record.teacher.value);
  const level = coerceLevel(record.level?.value ?? violationRaw ?? "");
  const confidencePayload = {
    student: record.student,
    occurredAt: record.occurredAt,
    writeupDate: record.writeupDate ?? record.occurredAt,
    points: record.points,
    reason: record.reason,
    violation: record.violation ?? record.reason,
    violationRaw: record.violationRaw ?? record.reason,
    level: record.level ?? { value: level === null ? "" : String(level), confidence: 0 },
    teacher: record.teacher,
    authorName: record.authorName ?? record.teacher,
    authorNameRaw: record.authorNameRaw ?? record.teacher,
    comment: record.comment,
    description: record.description ?? record.comment,
    resolution: record.resolution ?? { value: resolution ?? "", confidence: resolution === null ? 0 : 1 },
    recordConfidence: record.recordConfidence,
    warnings: record.warnings,
    sourceSnippet: record.sourceSnippet
  };

  return {
    sourceType: "manual_pdf",
    sourceRecordId,
    studentReference: record.student.value.trim(),
    externalStudentId: null,
    gradeAtEvent: null,
    eventType: "discipline",
    occurredAt: normalizeOccurredAt(record.occurredAt.value),
    writeupDate,
    points: coercePoints(record.points.value),
    reason: violation ?? record.reason.value.trim(),
    violation,
    violationRaw,
    level,
    comment: description ?? record.comment.value.trim(),
    description,
    resolution,
    teacherName: authorName ?? record.teacher.value.trim(),
    authorName,
    authorNameRaw,
    sourcePayloadJson: JSON.stringify({
      kind: "manual_pdf_parse_record",
      sourceRecordId,
      record
    }),
    mappingWarningsJson: JSON.stringify([]),
    confidenceJson: JSON.stringify(confidencePayload),
    studentConfidence: record.student.confidence,
    occurredAtConfidence: record.occurredAt.confidence,
    pointsConfidence: record.points.confidence,
    recordConfidence: record.recordConfidence,
    warnings: [...record.warnings]
  };
}

export function buildRawIncidentFromCandidate(input: {
  parseRunId: string;
  candidate: SourceCandidateRecord;
  rowNumber: number;
}): RawIncident {
  const { parseRunId, candidate, rowNumber } = input;
  const rawId = `${parseRunId}:raw:${String(rowNumber).padStart(4, "0")}`;

  return {
    id: rawId,
    parseRunId,
    sourceType: candidate.sourceType,
    sourceRecordId: candidate.sourceRecordId,
    studentReference: candidate.studentReference,
    externalStudentId: candidate.externalStudentId,
    gradeAtEvent: candidate.gradeAtEvent,
    eventType: candidate.eventType,
    occurredAt: candidate.occurredAt,
    writeupDate: candidate.writeupDate,
    points: candidate.points,
    reason: candidate.reason,
    violation: candidate.violation,
    violationRaw: candidate.violationRaw,
    level: candidate.level,
    comment: candidate.comment,
    description: candidate.description,
    resolution: candidate.resolution,
    teacherName: candidate.teacherName,
    authorName: candidate.authorName,
    authorNameRaw: candidate.authorNameRaw,
    sourcePayloadJson: candidate.sourcePayloadJson,
    mappingWarningsJson: candidate.mappingWarningsJson,
    confidenceJson: candidate.confidenceJson,
    status: "pending_review"
  };
}

export function shouldRequireReview(
  record: ParseRecord,
  rules: ReviewRules = defaultReviewRules
): boolean {
  return shouldRequireReviewCandidate(
    buildManualPdfCandidateRecord({
      record,
      rowNumber: 1
    }),
    rules
  );
}

export function shouldRequireReviewCandidate(
  candidate: SourceCandidateRecord,
  rules: ReviewRules = defaultReviewRules
): boolean {
  const criticalLowConfidence = [
    { confidence: candidate.studentConfidence, value: candidate.studentReference },
    { confidence: candidate.occurredAtConfidence, value: candidate.occurredAt },
    { confidence: candidate.pointsConfidence, value: String(candidate.points) }
  ].some(({ confidence, value }) => {
    const normalizedValue = value.trim();
    return confidence === null || confidence < rules.criticalFieldMinConfidence || normalizedValue === "";
  });
  if (criticalLowConfidence) {
    return true;
  }
  if (candidate.recordConfidence === null || candidate.recordConfidence < rules.recordMinConfidence) {
    return true;
  }
  if (rules.warningTriggersReview && candidate.warnings.length > 0) {
    return true;
  }
  return false;
}

export function buildReviewTask(input: {
  id?: string;
  parseRunId: string;
  rawIncidentId: string;
  resolution?: string;
  createdAt: string;
}): ReviewTask {
  return {
    id: input.id ?? `${input.parseRunId}:review:${input.rawIncidentId}`,
    parseRunId: input.parseRunId,
    rawIncidentId: input.rawIncidentId,
    assignee: null,
    status: "open",
    resolution: input.resolution ?? "",
    createdAt: input.createdAt,
    resolvedAt: null
  };
}

export function coercePoints(rawValue: string): number {
  const match = rawValue.match(/[+-]?\d+/);
  if (!match) {
    return 0;
  }
  const parsed = Number(match[0]);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return parsed;
}

function normalizeOccurredAt(rawValue: string): string {
  const value = rawValue.trim();
  if (!value) {
    return "";
  }
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }
  return parsedDate.toISOString();
}

function normalizeWriteupDate(rawValue: string): string | null {
  const value = rawValue.trim();
  if (!value) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }
  return parsedDate.toISOString().slice(0, 10);
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized : null;
}

function coerceLevel(rawValue: string): number | null {
  const match = rawValue.match(/level\s*([+-]?\d+)/i) ?? rawValue.match(/[+-]?\d+/);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1] ?? match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}
