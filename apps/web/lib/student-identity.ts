import type { Student } from "@syc/domain";
import type { StorageRepositories } from "@syc/storage";

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function findUniqueStudentByNormalizedName(students: Student[], normalizedReference: string): Student | null {
  const matches = students.filter((student) => normalizeToken(student.fullName) === normalizedReference);
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function buildStudentUpdate(
  existing: Student,
  input: {
    externalId: string | null;
    fullName?: string;
    grade?: string | null;
    active?: boolean;
    preferIncomingExternalId?: boolean;
    nowIso: string;
  }
): Student {
  return {
    ...existing,
    externalId: input.preferIncomingExternalId
      ? input.externalId ?? existing.externalId
      : existing.externalId ?? input.externalId,
    fullName: input.fullName?.trim() || existing.fullName,
    grade: input.grade?.trim() || existing.grade,
    active: input.active ?? existing.active,
    updatedAt: input.nowIso
  };
}

export async function findOrCreateStudent(
  storage: StorageRepositories,
  studentReference: string,
  externalStudentId: string | null,
  gradeAtEvent: string | null,
  nowIso: string
): Promise<Student> {
  const normalizedReference = normalizeToken(studentReference);
  const students = await storage.students.list();
  if (externalStudentId) {
    const byExternalId = students.find((student) => student.externalId === externalStudentId);
    if (byExternalId) {
      if (gradeAtEvent && byExternalId.grade !== gradeAtEvent) {
        const updated = buildStudentUpdate(byExternalId, {
          externalId: externalStudentId,
          grade: gradeAtEvent,
          nowIso
        });
        await storage.students.upsert(updated);
        return updated;
      }
      return byExternalId;
    }
  }

  const existing = findUniqueStudentByNormalizedName(students, normalizedReference);
  if (existing) {
    const updated = buildStudentUpdate(existing, {
      externalId: externalStudentId,
      grade: gradeAtEvent,
      nowIso
    });
    if (
      updated.externalId !== existing.externalId ||
      updated.grade !== existing.grade ||
      updated.fullName !== existing.fullName ||
      updated.active !== existing.active
    ) {
      await storage.students.upsert(updated);
      return updated;
    }
    return existing;
  }

  const student: Student = {
    id: stableStudentId(externalStudentId?.trim() || studentReference),
    externalId: externalStudentId,
    fullName: studentReference.trim(),
    grade: gradeAtEvent?.trim() || "unknown",
    active: true,
    createdAt: nowIso,
    updatedAt: nowIso
  };
  await storage.students.upsert(student);
  return student;
}

export async function upsertRosterStudent(
  storage: StorageRepositories,
  student: Pick<Student, "externalId" | "fullName" | "grade" | "active">,
  nowIso: string
): Promise<Student> {
  const students = await storage.students.list();

  if (student.externalId) {
    const byExternalId = students.find((item) => item.externalId === student.externalId);
    if (byExternalId) {
      const updated = buildStudentUpdate(byExternalId, {
        externalId: student.externalId,
        fullName: student.fullName,
        grade: student.grade,
        active: student.active,
        preferIncomingExternalId: true,
        nowIso
      });
      await storage.students.upsert(updated);
      return updated;
    }
  }

  const normalizedReference = normalizeToken(student.fullName);
  const byName = findUniqueStudentByNormalizedName(students, normalizedReference);
  if (byName) {
    const updated = buildStudentUpdate(byName, {
      externalId: student.externalId,
      fullName: student.fullName,
      grade: student.grade,
      active: student.active,
      preferIncomingExternalId: true,
      nowIso
    });
    await storage.students.upsert(updated);
    return updated;
  }

  const created: Student = {
    id: stableStudentId(student.externalId?.trim() || student.fullName),
    externalId: student.externalId,
    fullName: student.fullName.trim(),
    grade: student.grade.trim() || "unknown",
    active: student.active,
    createdAt: nowIso,
    updatedAt: nowIso
  };
  await storage.students.upsert(created);
  return created;
}

export function stableStudentId(studentReference: string): string {
  const normalized = normalizeToken(studentReference);
  let hash = 5381;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 33) ^ normalized.charCodeAt(index);
  }
  return `stu_${(hash >>> 0).toString(36)}`;
}
