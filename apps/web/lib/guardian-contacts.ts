import { randomUUID } from "node:crypto";

import type { AuditEvent, GuardianContact, Student } from "@syc/domain";
import type { StorageRepositories } from "@syc/storage";

import { fetchSycamoreStudents, getSycamoreClientConfigFromEnv, type SycamoreClientDependencies } from "@/lib/sycamore-client";
import { normalizeSycamoreStudentRecords } from "@/lib/sycamore-normalizer";
import { upsertRosterStudent } from "@/lib/student-identity";

interface ContactCandidate {
  email: string;
  guardianName: string | null;
  relationship: string | null;
  isPrimary: boolean;
}

export interface GuardianContactImportSummary {
  rowsRead: number;
  contactsUpserted: number;
  warnings: string[];
}

export interface GuardianContactSyncSummary {
  studentsFetched: number;
  studentsUpserted: number;
  contactsUpserted: number;
  warnings: string[];
}

const ROSTER_CONTACT_GROUPS = [
  {
    relationship: "Primary guardian",
    isPrimary: true,
    emailKeys: [
      "PrimaryParentEmail",
      "PrimaryGuardianEmail",
      "ParentEmail",
      "ParentEmailAddress",
      "FamilyEmail"
    ],
    nameKeys: ["PrimaryParentName", "PrimaryGuardianName", "ParentName", "FamilyName"]
  },
  {
    relationship: "Mother",
    isPrimary: false,
    emailKeys: ["MotherEmail", "MotherEmailAddress", "MomEmail"],
    nameKeys: ["MotherName", "Mother", "MomName"]
  },
  {
    relationship: "Father",
    isPrimary: false,
    emailKeys: ["FatherEmail", "FatherEmailAddress", "DadEmail"],
    nameKeys: ["FatherName", "Father", "DadName"]
  },
  {
    relationship: "Guardian 1",
    isPrimary: false,
    emailKeys: ["Guardian1Email", "GuardianEmail1"],
    nameKeys: ["Guardian1Name", "GuardianName1"]
  },
  {
    relationship: "Guardian 2",
    isPrimary: false,
    emailKeys: ["Guardian2Email", "GuardianEmail2"],
    nameKeys: ["Guardian2Name", "GuardianName2"]
  }
] as const;

function pickFirst(source: Record<string, unknown>, keys: readonly string[]): unknown {
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

function normalizeEmail(value: string | null): string | null {
  const trimmed = value?.trim().toLowerCase() || "";
  if (!trimmed) {
    return null;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}

function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeLookup(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function stableGuardianContactId(studentId: string, email: string, relationship: string | null): string {
  const seed = `${normalizeLookup(studentId)}|${normalizeLookup(email)}|${normalizeLookup(relationship ?? "")}`;
  let hash = 5381;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 33) ^ seed.charCodeAt(index);
  }
  return `gct_${(hash >>> 0).toString(36)}`;
}

function createAuditEvent(input: {
  eventType: string;
  entityId: string;
  actor: string;
  payload: unknown;
}): AuditEvent {
  return {
    id: randomUUID(),
    eventType: input.eventType,
    entityType: "guardian_contact",
    entityId: input.entityId,
    actor: input.actor,
    payloadJson: JSON.stringify(input.payload),
    createdAt: new Date().toISOString()
  };
}

function extractGuardianCandidates(record: Record<string, unknown>): ContactCandidate[] {
  const found: ContactCandidate[] = [];
  const seen = new Set<string>();

  for (const group of ROSTER_CONTACT_GROUPS) {
    const email = normalizeEmail(trimText(pickFirst(record, group.emailKeys)));
    if (!email || seen.has(email)) {
      continue;
    }

    found.push({
      email,
      guardianName: trimText(pickFirst(record, group.nameKeys)),
      relationship: group.relationship,
      isPrimary: group.isPrimary
    });
    seen.add(email);
  }

  return found;
}

async function upsertGuardianContact(
  storage: StorageRepositories,
  student: Pick<Student, "id">,
  contact: ContactCandidate,
  sourceType: GuardianContact["sourceType"],
  sourceRecordId: string | null,
  notes: string,
  nowIso: string
): Promise<GuardianContact> {
  const id = stableGuardianContactId(student.id, contact.email, contact.relationship);
  const existing = await storage.guardianContacts.getById(id);
  const next: GuardianContact = {
    id,
    studentId: student.id,
    guardianName: contact.guardianName ?? existing?.guardianName ?? null,
    relationship: contact.relationship ?? existing?.relationship ?? null,
    email: contact.email,
    phone: existing?.phone ?? null,
    isPrimary: contact.isPrimary || existing?.isPrimary || false,
    allowEmail: existing?.allowEmail ?? true,
    sourceType,
    sourceRecordId,
    lastSyncedAt: nowIso,
    isActive: existing?.isActive ?? true,
    notes: notes || existing?.notes || ""
  };
  await storage.guardianContacts.upsert(next);
  return next;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? "";
    if (char === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  values.push(current.trim());
  return values;
}

function resolveStudentFromCsvRow(
  row: Record<string, string>,
  students: Student[]
): Student | null {
  const studentId = row.student_id?.trim();
  if (studentId) {
    const byId = students.find((student) => student.id === studentId);
    if (byId) {
      return byId;
    }
  }

  const externalId = row.external_id?.trim();
  if (externalId) {
    const byExternalId = students.find((student) => student.externalId === externalId);
    if (byExternalId) {
      return byExternalId;
    }
  }

  const studentName = row.student_name?.trim();
  if (studentName) {
    const normalizedName = normalizeLookup(studentName);
    const matches = students.filter((student) => normalizeLookup(student.fullName) === normalizedName);
    if (matches.length === 1) {
      return matches[0] ?? null;
    }
  }

  return null;
}

export async function importGuardianContactsCsv(input: {
  storage: StorageRepositories;
  actorEmail: string;
  csv: string;
}): Promise<GuardianContactImportSummary> {
  const lines = input.csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return {
      rowsRead: 0,
      contactsUpserted: 0,
      warnings: ["guardian_contacts_csv_requires_header_and_rows"]
    };
  }

  const headers = parseCsvLine(lines[0] ?? "").map((value) => value.trim().toLowerCase());
  const students = await input.storage.students.list();
  const nowIso = new Date().toISOString();
  let contactsUpserted = 0;
  const warnings: string[] = [];

  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    const student = resolveStudentFromCsvRow(row, students);
    if (!student) {
      warnings.push(`guardian_contact_student_not_found:${line}`);
      continue;
    }

    const email = normalizeEmail(row.email ?? null);
    if (!email) {
      warnings.push(`guardian_contact_missing_email:${student.id}`);
      continue;
    }

    const contact = await upsertGuardianContact(
      input.storage,
      student,
      {
        email,
        guardianName: row.guardian_name?.trim() || null,
        relationship: row.relationship?.trim() || null,
        isPrimary: parseBoolean(row.is_primary?.trim() || null, false)
      },
      "csv_import",
      null,
      row.notes?.trim() || "",
      nowIso
    );
    contactsUpserted += 1;

    await input.storage.auditEvents.append(
      createAuditEvent({
        eventType: "guardian_contact_imported",
        entityId: contact.id,
        actor: input.actorEmail,
        payload: {
          studentId: student.id,
          email: contact.email
        }
      })
    );
  }

  return {
    rowsRead: lines.length - 1,
    contactsUpserted,
    warnings
  };
}

export async function syncGuardianContactsFromSycamore(input: {
  storage: StorageRepositories;
  actorEmail: string;
  dependencies?: SycamoreClientDependencies;
}): Promise<GuardianContactSyncSummary> {
  const config = getSycamoreClientConfigFromEnv();
  const nowIso = new Date().toISOString();
  const rosterRecords = await fetchSycamoreStudents(config, input.dependencies);
  const normalizedStudents = normalizeSycamoreStudentRecords(rosterRecords, nowIso);

  const studentByExternalId = new Map<string, Student>();
  let studentsUpserted = 0;
  for (const studentRow of normalizedStudents.students) {
    const upserted = await upsertRosterStudent(input.storage, studentRow, nowIso);
    studentsUpserted += 1;
    if (upserted.externalId) {
      studentByExternalId.set(upserted.externalId, upserted);
    }
  }

  let contactsUpserted = 0;
  const warnings = [...normalizedStudents.warnings];

  for (const record of rosterRecords) {
    const externalStudentId =
      trimText(pickFirst(record, ["ID", "Id", "id", "StudentID", "StudentId"])) ?? null;
    if (!externalStudentId) {
      continue;
    }
    const student = studentByExternalId.get(externalStudentId);
    if (!student) {
      warnings.push(`guardian_contact_student_missing_after_roster_sync:${externalStudentId}`);
      continue;
    }

    const candidates = extractGuardianCandidates(record);
    if (candidates.length === 0) {
      continue;
    }

    for (const candidate of candidates) {
      const contact = await upsertGuardianContact(
        input.storage,
        student,
        candidate,
        "sycamore_roster",
        externalStudentId,
        "",
        nowIso
      );
      contactsUpserted += 1;
      await input.storage.auditEvents.append(
        createAuditEvent({
          eventType: "guardian_contact_synced_from_sycamore",
          entityId: contact.id,
          actor: input.actorEmail,
          payload: {
            studentId: student.id,
            externalStudentId,
            email: contact.email
          }
        })
      );
    }
  }

  return {
    studentsFetched: rosterRecords.length,
    studentsUpserted,
    contactsUpserted,
    warnings
  };
}
