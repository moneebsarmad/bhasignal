import assert from "node:assert/strict";
import test from "node:test";

import type { ApprovedIncident, ParseRun, Policy, Student } from "@syc/domain";

import { buildDashboardSnapshot, readDashboardFilters } from "../lib/dashboard";
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

function seedParseRuns(): ParseRun[] {
  return [
    {
      id: "run_manual_new",
      sourceType: "manual_pdf",
      fileName: "discipline.pdf",
      uploadedBy: "admin@school.org",
      triggeredBy: "admin@school.org",
      metadataJson: "{}",
      cursorJson: null,
      status: "completed",
      rowsExtracted: 1,
      rowsFlagged: 0,
      startedAt: "2026-03-10T09:00:00.000Z",
      completedAt: "2026-03-10T09:05:00.000Z"
    },
    {
      id: "run_sycamore_new",
      sourceType: "sycamore_api",
      fileName: "sycamore.json",
      uploadedBy: "admin@school.org",
      triggeredBy: "admin@school.org",
      metadataJson: "{\"startDate\":\"2026-03-11\",\"endDate\":\"2026-03-11\"}",
      cursorJson: null,
      status: "review_required",
      rowsExtracted: 1,
      rowsFlagged: 0,
      startedAt: "2026-03-11T09:00:00.000Z",
      completedAt: "2026-03-11T09:05:00.000Z"
    }
  ];
}

test("readDashboardFilters defaults the dashboard to Sycamore when no source is supplied", () => {
  const filters = readDashboardFilters(new URLSearchParams("grade=8&from=2026-03-01&to=2026-03-31"));
  assert.equal(filters.sourceType, "sycamore_api");
});

test("buildDashboardSnapshot defaults to Sycamore and supports explicit PDF exception filtering", async () => {
  const storage = createInMemoryStorage({
    parseRuns: seedParseRuns(),
    rawIncidents: [],
    reviewTasks: [],
    students: seedStudents(),
    approvedIncidents: seedIncidents(),
    policies: [seedPolicy()]
  });

  const marchSnapshot = await buildDashboardSnapshot(storage, {
    grade: "8",
    from: "2026-03-01",
    to: "2026-03-31"
  });
  assert.equal(marchSnapshot.metrics.totalStudents, 1);
  assert.equal(marchSnapshot.metrics.countAtX, 1);
  assert.equal(marchSnapshot.topStudents[0]?.studentId, "stu_2");
  assert.deepEqual(marchSnapshot.incidentSourceCounts, { sycamore_api: 1 });
  assert.deepEqual(marchSnapshot.parseRunSourceCounts, { sycamore_api: 1 });

  const pdfExceptionSnapshot = await buildDashboardSnapshot(storage, {
    grade: "8",
    from: "2026-03-01",
    to: "2026-03-31",
    sourceType: "manual_pdf"
  });
  assert.equal(pdfExceptionSnapshot.metrics.totalStudents, 1);
  assert.equal(pdfExceptionSnapshot.metrics.countAtX, 0);
  assert.deepEqual(pdfExceptionSnapshot.incidentSourceCounts, { manual_pdf: 1 });
  assert.deepEqual(pdfExceptionSnapshot.parseRunSourceCounts, { manual_pdf: 1 });
  assert.equal(pdfExceptionSnapshot.topStudents[0]?.studentId, "stu_1");

  const singleDaySnapshot = await buildDashboardSnapshot(storage, {
    grade: "8",
    from: "2026-03-11",
    to: "2026-03-11",
    sourceType: "sycamore_api"
  });
  assert.equal(singleDaySnapshot.metrics.incidentsInRange, 1);
});
