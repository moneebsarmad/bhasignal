import assert from "node:assert/strict";
import test from "node:test";

import type { ApprovedIncident, Intervention, Notification, Student } from "@syc/domain";

import { buildReportSnapshot, readReportFilters } from "../lib/reporting";
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
      id: "inc_manual",
      studentId: "stu_1",
      sourceType: "manual_pdf",
      sourceRecordId: "pdf_row_0001",
      externalStudentId: "student-1",
      gradeAtEvent: "8",
      eventType: "discipline",
      occurredAt: "2026-03-10T10:00:00.000Z",
      points: 4,
      reason: "Disrespect",
      comment: "Manual incident",
      teacherName: "Ms Smith",
      sourceJobId: "run_manual",
      fingerprint: "fp_manual",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-03-10T11:00:00.000Z"
    },
    {
      id: "inc_sycamore",
      studentId: "stu_2",
      sourceType: "sycamore_api",
      sourceRecordId: "disc-2",
      externalStudentId: "student-2",
      gradeAtEvent: "8",
      eventType: "discipline",
      occurredAt: "2026-03-12T10:00:00.000Z",
      points: 6,
      reason: "Class disruption",
      comment: "Sycamore incident",
      teacherName: "Mr Adams",
      sourceJobId: "run_sycamore",
      fingerprint: "fp_sycamore",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-03-12T11:00:00.000Z"
    }
  ];
}

function seedInterventions(): Intervention[] {
  return [
    {
      id: "int_manual",
      studentId: "stu_1",
      policyVersion: 1,
      milestoneLabel: "X-3",
      status: "open",
      dueDate: "2026-03-15T00:00:00.000Z",
      completedAt: null,
      assignedTo: "Dean",
      notes: ""
    },
    {
      id: "int_sycamore",
      studentId: "stu_2",
      policyVersion: 1,
      milestoneLabel: "X",
      status: "open",
      dueDate: "2026-03-18T00:00:00.000Z",
      completedAt: null,
      assignedTo: "Dean",
      notes: ""
    }
  ];
}

function seedNotifications(): Notification[] {
  return [
    {
      id: "notif_1",
      studentId: "stu_1",
      interventionId: "int_manual",
      channel: "email",
      recipient: "staff@school.org",
      status: "queued",
      providerId: "id-1",
      sentAt: null,
      error: "{}"
    },
    {
      id: "notif_2",
      studentId: "stu_2",
      interventionId: "int_sycamore",
      channel: "email",
      recipient: "staff@school.org",
      status: "queued",
      providerId: "id-2",
      sentAt: null,
      error: "{}"
    }
  ];
}

test("readReportFilters defaults reports to Sycamore when no source is supplied", () => {
  const filters = readReportFilters(new URLSearchParams("grade=8&from=2026-03-01&to=2026-03-31"));
  assert.equal(filters.sourceType, "sycamore_api");
});

test("buildReportSnapshot defaults to Sycamore and supports explicit PDF exception filtering", async () => {
  const storage = createInMemoryStorage({
    parseRuns: [],
    rawIncidents: [],
    reviewTasks: [],
    students: seedStudents(),
    approvedIncidents: seedIncidents(),
    interventions: seedInterventions(),
    notifications: seedNotifications()
  });

  const snapshot = await buildReportSnapshot(storage, {
    grade: "8",
    from: "2026-03-01",
    to: "2026-03-31"
  });

  assert.equal(snapshot.filters.sourceType, "sycamore_api");
  assert.deepEqual(snapshot.sourceBreakdown, { sycamore_api: 1 });
  assert.equal(snapshot.studentRows.length, 1);
  assert.equal(snapshot.studentRows[0]?.studentId, "stu_2");
  assert.equal(snapshot.summary.find((metric) => metric.label === "Discipline events")?.value, 1);
  assert.equal(snapshot.summary.find((metric) => metric.label === "Active interventions")?.value, 1);

  const pdfExceptionSnapshot = await buildReportSnapshot(storage, {
    grade: "8",
    from: "2026-03-01",
    to: "2026-03-31",
    sourceType: "manual_pdf"
  });

  assert.equal(pdfExceptionSnapshot.filters.sourceType, "manual_pdf");
  assert.deepEqual(pdfExceptionSnapshot.sourceBreakdown, { manual_pdf: 1 });
  assert.equal(pdfExceptionSnapshot.studentRows.length, 1);
  assert.equal(pdfExceptionSnapshot.studentRows[0]?.studentId, "stu_1");
  assert.equal(pdfExceptionSnapshot.summary.find((metric) => metric.label === "Discipline events")?.value, 1);
  assert.equal(pdfExceptionSnapshot.summary.find((metric) => metric.label === "Active interventions")?.value, 1);

  const singleDaySnapshot = await buildReportSnapshot(storage, {
    grade: "8",
    from: "2026-03-12",
    to: "2026-03-12",
    sourceType: "sycamore_api"
  });
  assert.equal(singleDaySnapshot.summary.find((metric) => metric.label === "Discipline events")?.value, 1);
});
