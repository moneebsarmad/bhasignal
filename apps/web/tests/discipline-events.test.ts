import assert from "node:assert/strict";
import test from "node:test";

import type { ApprovedIncident, Student } from "@syc/domain";

import { listDisciplineEvents } from "../lib/discipline-events";
import { createInMemoryStorage } from "./review-actions.test";

function seedStudents(): Student[] {
  return [
    {
      id: "stu_1",
      externalId: "student-1",
      fullName: "Jane Doe",
      grade: "8",
      active: true,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z"
    }
  ];
}

function seedIncidents(): ApprovedIncident[] {
  return [
    {
      id: "inc_sycamore",
      studentId: "stu_1",
      sourceType: "sycamore_api",
      sourceRecordId: "disc-1",
      externalStudentId: "student-1",
      gradeAtEvent: "8",
      eventType: "discipline",
      occurredAt: "2026-03-10T10:00:00.000Z",
      writeupDate: "2026-03-10",
      points: 4,
      reason: "Disrespect",
      violation: "Disrespect",
      violationRaw: "Level 1: Disrespect",
      level: 1,
      comment: "",
      description: "Talked back in class",
      resolution: "Lunch detention",
      teacherName: "Ms Smith",
      authorName: "Ms Smith",
      authorNameRaw: null,
      sourceJobId: "run_sycamore",
      fingerprint: "fp_sycamore",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-03-10T11:00:00.000Z"
    },
    {
      id: "inc_manual_duplicate",
      studentId: "stu_1",
      sourceType: "manual_pdf",
      sourceRecordId: "pdf-1",
      externalStudentId: "student-1",
      gradeAtEvent: "8",
      eventType: "discipline",
      occurredAt: "2026-03-10T10:00:00.000Z",
      writeupDate: "2026-03-10",
      points: 4,
      reason: "Disrespect",
      violation: "Disrespect",
      violationRaw: "Level 1: Disrespect",
      level: 1,
      comment: "",
      description: "Talked back in class",
      resolution: "Lunch detention",
      teacherName: "Ms Smith",
      authorName: "Ms Smith",
      authorNameRaw: null,
      sourceJobId: "run_manual",
      fingerprint: "fp_manual_duplicate",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-03-10T12:00:00.000Z"
    },
    {
      id: "inc_manual_fallback",
      studentId: "stu_1",
      sourceType: "manual_pdf",
      sourceRecordId: "pdf-2",
      externalStudentId: "student-1",
      gradeAtEvent: "8",
      eventType: "discipline",
      occurredAt: "2026-03-12T10:00:00.000Z",
      writeupDate: "2026-03-12",
      points: 2,
      reason: "Tardy",
      violation: "Tardy",
      violationRaw: "Level 0: Tardy",
      level: 0,
      comment: "",
      description: "Late to class",
      resolution: "Warning",
      teacherName: "Ms Smith",
      authorName: "Ms Smith",
      authorNameRaw: null,
      sourceJobId: "run_manual",
      fingerprint: "fp_manual_fallback",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-03-12T12:00:00.000Z"
    }
  ];
}

test("listDisciplineEvents prefers Sycamore rows and keeps unmatched PDF rows as fallback", async () => {
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalPublicSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  delete process.env.SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const storage = createInMemoryStorage({
      parseRuns: [],
      rawIncidents: [],
      reviewTasks: [],
      students: seedStudents(),
      approvedIncidents: seedIncidents()
    });

    const events = await listDisciplineEvents(storage);

    assert.equal(events.length, 2);
    assert.equal(events[0]?.sourceType, "manual_pdf");
    assert.equal(events[0]?.isFallback, true);
    assert.equal(events[1]?.sourceType, "sycamore_api");
    assert.equal(events[1]?.hasSourceConflict, true);
    assert.deepEqual(
      events.map((event) => event.sourceRecordId).sort(),
      ["disc-1", "pdf-2"]
    );
  } finally {
    process.env.SUPABASE_URL = originalSupabaseUrl;
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalPublicSupabaseUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
  }
});
