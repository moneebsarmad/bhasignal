import assert from "node:assert/strict";
import test from "node:test";

import type { ApprovedIncident, Policy, Student } from "@syc/domain";

import { buildAnalyticsSnapshot, readAnalyticsFilters } from "../lib/analytics";
import { createInMemoryStorage } from "./review-actions.test";

function seedPolicy(): Policy {
  return {
    version: 1,
    baseThreshold: 10,
    warningOffsets: [-3, -1],
    milestones: [0, 10, 20, 30],
    interventionTemplates: "[]",
    createdBy: "admin@school.org",
    createdAt: "2026-03-01T00:00:00.000Z"
  };
}

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
    },
    {
      id: "stu_2",
      externalId: "student-2",
      fullName: "John Roe",
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
      id: "inc_old_manual",
      studentId: "stu_1",
      sourceType: "manual_pdf",
      sourceRecordId: "pdf_old",
      externalStudentId: "student-1",
      gradeAtEvent: "8",
      eventType: "discipline",
      occurredAt: "2026-02-05T10:00:00.000Z",
      points: 12,
      reason: "Disrespect",
      comment: "",
      teacherName: "Ms Smith",
      sourceJobId: "run_manual_old",
      fingerprint: "fp_old_manual",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-02-05T11:00:00.000Z"
    },
    {
      id: "inc_window_manual",
      studentId: "stu_1",
      sourceType: "manual_pdf",
      sourceRecordId: "pdf_new",
      externalStudentId: "student-1",
      gradeAtEvent: "8",
      eventType: "discipline",
      occurredAt: "2026-03-10T10:00:00.000Z",
      points: 4,
      reason: "Disrespect",
      comment: "",
      teacherName: "Ms Smith",
      sourceJobId: "run_manual_new",
      fingerprint: "fp_new_manual",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-03-10T11:00:00.000Z"
    },
    {
      id: "inc_window_sycamore",
      studentId: "stu_2",
      sourceType: "sycamore_api",
      sourceRecordId: "disc-2",
      externalStudentId: "student-2",
      gradeAtEvent: "8",
      eventType: "discipline",
      occurredAt: "2026-03-11T10:00:00.000Z",
      points: 11,
      reason: "Class disruption",
      comment: "",
      teacherName: "Mr Adams",
      sourceJobId: "run_sycamore_new",
      fingerprint: "fp_new_sycamore",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-03-11T11:00:00.000Z"
    }
  ];
}

test("readAnalyticsFilters defaults the analytics tab to Sycamore when no source is supplied", () => {
  const filters = readAnalyticsFilters(new URLSearchParams("grade=8&from=2026-03-01&to=2026-03-31"));
  assert.equal(filters.sourceType, "sycamore_api");
});

test("buildAnalyticsSnapshot keeps live escalation bands even when the analytics window is narrower", async () => {
  const storage = createInMemoryStorage({
    parseRuns: [],
    rawIncidents: [],
    reviewTasks: [],
    students: seedStudents(),
    approvedIncidents: seedIncidents(),
    policies: [seedPolicy()]
  });

  const snapshot = await buildAnalyticsSnapshot(storage, {
    grade: "8",
    from: "2026-03-10",
    to: "2026-03-10",
    sourceType: "manual_pdf",
    thresholdBand: "points_10_19"
  });

  assert.equal(snapshot.summary[0]?.value, 1);
  assert.equal(snapshot.summary[1]?.value, 1);
  assert.equal(snapshot.summary[2]?.value, 4);
  assert.equal(snapshot.studentRows[0]?.studentId, "stu_1");
  assert.equal(snapshot.studentRows[0]?.totalPoints, 4);
  assert.equal(snapshot.studentRows[0]?.currentTotalPoints, 16);
  assert.equal(snapshot.studentRows[0]?.currentBandId, "points_10_19");
});
