import {
  normalizedSycamoreDisciplineRecordSchema,
  normalizedSycamoreStudentRecordSchema,
  type NormalizedSycamoreDisciplineRecord,
  type NormalizedSycamoreStudentRecord
} from "@/lib/sycamore-contract";
import type { SourceCandidateRecord } from "@/lib/ingestion";
import type { Student } from "@syc/domain";

function pickFirst(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in source) {
      return source[key];
    }
  }
  return undefined;
}

function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

export function normalizeSycamoreGrade(rawValue: string | null): string | null {
  if (!rawValue) {
    return null;
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  const numericMatch = trimmed.match(/^\D*(\d{1,2})\D*$/);
  if (numericMatch?.[1]) {
    return numericMatch[1];
  }

  return trimmed;
}

export function normalizeSycamorePersonName(rawValue: string | null): string | null {
  if (!rawValue) {
    return null;
  }

  const trimmed = rawValue.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return null;
  }

  if (!trimmed.includes(",")) {
    return trimmed;
  }

  const [lastName, firstName, ...rest] = trimmed.split(",").map((part) => part.trim()).filter(Boolean);
  const normalized = [firstName, ...rest, lastName].filter(Boolean).join(" ").trim();
  return normalized || trimmed;
}

export function splitSycamoreViolation(rawValue: string | null): {
  violation: string | null;
  violationRaw: string | null;
  level: number | null;
} {
  if (!rawValue) {
    return {
      violation: null,
      violationRaw: null,
      level: null
    };
  }

  const violationRaw = rawValue.trim();
  const levelMatch = violationRaw.match(/^\s*level\s*([+-]?\d+)\s*[:\-]\s*(.+)$/i);
  if (!levelMatch) {
    return {
      violation: violationRaw,
      violationRaw,
      level: null
    };
  }

  return {
    violation: levelMatch[2]?.trim() || violationRaw,
    violationRaw,
    level: Number(levelMatch[1])
  };
}

function parsePoints(rawValue: string | null): { points: number; confidence: number; warnings: string[] } {
  if (!rawValue) {
    return {
      points: 0,
      confidence: 0,
      warnings: ["missing_points"]
    };
  }

  const match = rawValue.match(/[+-]?\d+/);
  if (!match) {
    return {
      points: 0,
      confidence: 0.2,
      warnings: [`invalid_points:${rawValue}`]
    };
  }

  return {
    points: Number(match[0]),
    confidence: 1,
    warnings: []
  };
}

function normalizeOccurredAt(rawValue: string | null): { occurredAt: string; confidence: number; warnings: string[] } {
  if (!rawValue) {
    return {
      occurredAt: "",
      confidence: 0,
      warnings: ["missing_occurred_at"]
    };
  }

  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {
    return {
      occurredAt: rawValue,
      confidence: 0.4,
      warnings: [`invalid_occurred_at:${rawValue}`]
    };
  }

  return {
    occurredAt: parsed.toISOString(),
    confidence: 1,
    warnings: []
  };
}

function writeupDateFromOccurredAt(rawValue: string): string | null {
  if (!rawValue) {
    return null;
  }
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function normalizeRawRecord(source: Record<string, unknown>): NormalizedSycamoreDisciplineRecord {
  return normalizedSycamoreDisciplineRecordSchema.parse({
    id: toNullableString(pickFirst(source, ["ID", "Id", "id"])) ?? "missing-id",
    studentId: toNullableString(pickFirst(source, ["StudentID", "studentId", "student_id"])),
    studentCode: toNullableString(pickFirst(source, ["StudentCode", "studentCode", "student_code"])),
    studentName: toNullableString(pickFirst(source, ["Student", "student", "StudentName", "studentName"])),
    grade: normalizeSycamoreGrade(toNullableString(pickFirst(source, ["Grade", "grade"]))),
    violation: toNullableString(pickFirst(source, ["Violation", "violation", "Reason", "reason"])),
    description: toNullableString(pickFirst(source, ["Description", "description", "Comment", "comment"])),
    points: toNullableString(pickFirst(source, ["Points", "points"])),
    createdAt: toNullableString(pickFirst(source, ["Created", "created", "OccurredAt", "occurredAt", "Date", "date"])),
    author: toNullableString(pickFirst(source, ["Author", "author", "Teacher", "teacher"])),
    occurredOn: toNullableString(pickFirst(source, ["__sycamoreOccurredOn"])) as string | null
  });
}

function normalizeStudentRawRecord(source: Record<string, unknown>): NormalizedSycamoreStudentRecord {
  const firstName = toNullableString(pickFirst(source, ["FirstName", "firstName", "firstname"]));
  const lastName = toNullableString(pickFirst(source, ["LastName", "Lastname", "lastName", "lastname"]));
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  return normalizedSycamoreStudentRecordSchema.parse({
    id: toNullableString(pickFirst(source, ["ID", "Id", "id"])) ?? "missing-student-id",
    studentCode: toNullableString(
      pickFirst(source, ["StudentCode", "studentCode", "student_code", "Code", "code"])
    ),
    firstName,
    lastName,
    fullName: fullName || toNullableString(pickFirst(source, ["Student", "student"])) || "Unknown Student",
    grade: normalizeSycamoreGrade(toNullableString(pickFirst(source, ["Grade", "grade"]))),
    graduated: ["1", "true", "yes"].includes(
      (toNullableString(pickFirst(source, ["Graduated", "graduated"])) ?? "").toLowerCase()
    )
  });
}

export interface NormalizeSycamoreDisciplineResult {
  sourceRecords: SourceCandidateRecord[];
  warnings: string[];
}

export function normalizeSycamoreDisciplineRecords(
  records: Array<Record<string, unknown>>
): NormalizeSycamoreDisciplineResult {
  const warnings: string[] = [];
  const sourceRecords = records
    .map((rawRecord) => {
      const normalized = normalizeRawRecord(rawRecord);
      const recordWarnings: string[] = [];

      const occurredAt = normalizeOccurredAt(normalized.createdAt ?? normalized.occurredOn);
      recordWarnings.push(...occurredAt.warnings);

      const points = parsePoints(normalized.points);
      recordWarnings.push(...points.warnings);

      const studentReference = normalized.studentName ?? "";
      if (!studentReference) {
        recordWarnings.push("missing_student");
      }

      const violationParts = splitSycamoreViolation(normalized.violation);
      const authorNameRaw = normalized.author ?? null;
      const authorName = normalizeSycamorePersonName(authorNameRaw);
      const reason = violationParts.violation ?? normalized.description ?? "";
      if (!reason) {
        recordWarnings.push("missing_reason");
      }

      const recordConfidence = Math.max(
        0,
        1 -
          (recordWarnings.includes("missing_student") ? 0.45 : 0) -
          (recordWarnings.some((warning) => warning.startsWith("missing_occurred_at")) ? 0.35 : 0) -
          (recordWarnings.some((warning) => warning.startsWith("missing_points")) ? 0.35 : 0) -
          (recordWarnings.some((warning) => warning.startsWith("invalid_")) ? 0.2 : 0) -
          (recordWarnings.includes("missing_reason") ? 0.05 : 0)
      );

      const sourceRecordId = normalized.id;
      const snippet = [normalized.violation, normalized.description].filter(Boolean).join(" | ");
      const externalStudentId = normalized.studentId ?? normalized.studentCode;

      return {
        sourceType: "sycamore_api" as const,
        sourceRecordId,
        studentReference,
        externalStudentId,
        gradeAtEvent: normalized.grade,
        eventType: "discipline",
        occurredAt: occurredAt.occurredAt,
        writeupDate: writeupDateFromOccurredAt(occurredAt.occurredAt),
        points: points.points,
        reason,
        violation: violationParts.violation,
        violationRaw: violationParts.violationRaw,
        level: violationParts.level,
        comment: normalized.description ?? "",
        description: normalized.description ?? null,
        resolution: null,
        teacherName: authorName ?? authorNameRaw ?? "",
        authorName,
        authorNameRaw,
        sourcePayloadJson: JSON.stringify(rawRecord),
        mappingWarningsJson: JSON.stringify(recordWarnings),
        confidenceJson: JSON.stringify({
          source: "sycamore_api",
          recordConfidence,
          warnings: recordWarnings,
          sourceSnippet: snippet,
          importedAt: new Date().toISOString()
        }),
        studentConfidence: studentReference ? 1 : 0,
        occurredAtConfidence: occurredAt.confidence,
        pointsConfidence: points.confidence,
        recordConfidence,
        warnings: recordWarnings
      } satisfies SourceCandidateRecord;
    })
    .sort((left, right) => left.sourceRecordId.localeCompare(right.sourceRecordId));

  const duplicateIds = new Set<string>();
  const seenIds = new Set<string>();
  for (const record of sourceRecords) {
    if (seenIds.has(record.sourceRecordId)) {
      duplicateIds.add(record.sourceRecordId);
    }
    seenIds.add(record.sourceRecordId);
  }

  for (const duplicateId of duplicateIds) {
    warnings.push(`duplicate_source_record_id:${duplicateId}`);
  }

  return {
    sourceRecords,
    warnings
  };
}

export interface NormalizeSycamoreStudentResult {
  students: Student[];
  warnings: string[];
}

export function normalizeSycamoreStudentRecords(
  records: Array<Record<string, unknown>>,
  nowIso: string
): NormalizeSycamoreStudentResult {
  const warnings: string[] = [];
  const seenIds = new Set<string>();
  const students: Student[] = [];

  for (const rawRecord of records) {
    const normalized = normalizeStudentRawRecord(rawRecord);
    if (seenIds.has(normalized.id)) {
      warnings.push(`duplicate_student_id:${normalized.id}`);
      continue;
    }
    seenIds.add(normalized.id);

    students.push({
      id: normalized.id,
      externalId: normalized.id,
      fullName: normalized.fullName,
      grade: normalized.grade ?? "unknown",
      active: !normalized.graduated,
      createdAt: nowIso,
      updatedAt: nowIso
    });
  }

  return {
    students,
    warnings
  };
}
