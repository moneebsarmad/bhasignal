import assert from "node:assert/strict";
import test from "node:test";

import type { ApprovedIncident, Intervention, Notification, Policy, Student } from "@syc/domain";

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
    },
    {
      id: "stu_3",
      externalId: "student-3",
      fullName: "Ibrahim Noor",
      grade: "9",
      active: true,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z"
    },
    {
      id: "stu_4",
      externalId: "student-4",
      fullName: "Khaled Ali",
      grade: "9",
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
      comment: "Argued with teacher",
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
      comment: "Refused work in class",
      teacherName: "Ms Smith",
      sourceJobId: "run_manual_new",
      fingerprint: "fp_new_manual",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-03-10T11:00:00.000Z"
    },
    {
      id: "inc_prev_disrespect",
      studentId: "stu_1",
      sourceType: "sycamore_api",
      sourceRecordId: "disc-1-prev",
      externalStudentId: "student-1",
      gradeAtEvent: "8",
      eventType: "discipline",
      occurredAt: "2026-02-15T09:30:00.000Z",
      points: 3,
      reason: "Disrespect",
      comment: "Argued with staff during class",
      teacherName: "Ms Smith",
      sourceJobId: "run_sycamore_prev",
      fingerprint: "fp_sycamore_prev_1",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-02-15T10:00:00.000Z"
    },
    {
      id: "inc_curr_disrespect_a",
      studentId: "stu_1",
      sourceType: "sycamore_api",
      sourceRecordId: "disc-1-current-a",
      externalStudentId: "student-1",
      gradeAtEvent: "8",
      eventType: "discipline",
      occurredAt: "2026-03-10T09:15:00.000Z",
      points: 4,
      reason: "Disrespect",
      comment: "Refused directions and argued",
      teacherName: "Ms Smith",
      sourceJobId: "run_sycamore_current",
      fingerprint: "fp_sycamore_current_1",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-03-10T09:45:00.000Z"
    },
    {
      id: "inc_curr_disrespect_b",
      studentId: "stu_1",
      sourceType: "sycamore_api",
      sourceRecordId: "disc-1-current-b",
      externalStudentId: "student-1",
      gradeAtEvent: "8",
      eventType: "discipline",
      occurredAt: "2026-03-25T11:20:00.000Z",
      points: 5,
      reason: "Disrespect",
      comment: "Escalated again after intervention",
      teacherName: "Ms Smith",
      sourceJobId: "run_sycamore_current",
      fingerprint: "fp_sycamore_current_2",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-03-25T11:50:00.000Z"
    },
    {
      id: "inc_curr_tardy_a",
      studentId: "stu_2",
      sourceType: "sycamore_api",
      sourceRecordId: "disc-2-current-a",
      externalStudentId: "student-2",
      gradeAtEvent: "8",
      eventType: "discipline",
      occurredAt: "2026-03-12T08:05:00.000Z",
      points: 2,
      reason: "Tardy",
      comment: "Late to first block",
      teacherName: "Mr Adams",
      sourceJobId: "run_sycamore_current",
      fingerprint: "fp_sycamore_current_3",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-03-12T08:25:00.000Z"
    },
    {
      id: "inc_curr_tardy_b",
      studentId: "stu_2",
      sourceType: "sycamore_api",
      sourceRecordId: "disc-2-current-b",
      externalStudentId: "student-2",
      gradeAtEvent: "8",
      eventType: "discipline",
      occurredAt: "2026-03-20T08:10:00.000Z",
      points: 2,
      reason: "Tardy",
      comment: "Late again to first block",
      teacherName: "Mr Adams",
      sourceJobId: "run_sycamore_current",
      fingerprint: "fp_sycamore_current_4",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-03-20T08:35:00.000Z"
    },
    {
      id: "inc_prev_disruption",
      studentId: "stu_3",
      sourceType: "sycamore_api",
      sourceRecordId: "disc-3-prev",
      externalStudentId: "student-3",
      gradeAtEvent: "9",
      eventType: "discipline",
      occurredAt: "2026-02-20T10:30:00.000Z",
      points: 3,
      reason: "Class disruption",
      comment: "Repeated interruptions",
      teacherName: "Mrs Khan",
      sourceJobId: "run_sycamore_prev",
      fingerprint: "fp_sycamore_prev_2",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-02-20T11:00:00.000Z"
    },
    {
      id: "inc_curr_disruption",
      studentId: "stu_3",
      sourceType: "sycamore_api",
      sourceRecordId: "disc-3-current",
      externalStudentId: "student-3",
      gradeAtEvent: "9",
      eventType: "discipline",
      occurredAt: "2026-03-18T10:40:00.000Z",
      points: 3,
      reason: "Class disruption",
      comment: "Repeated interruptions in lesson",
      teacherName: "Mrs Khan",
      sourceJobId: "run_sycamore_current",
      fingerprint: "fp_sycamore_current_5",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-03-18T11:10:00.000Z"
    },
    {
      id: "inc_curr_fight",
      studentId: "stu_4",
      sourceType: "sycamore_api",
      sourceRecordId: "disc-4-current",
      externalStudentId: "student-4",
      gradeAtEvent: "9",
      eventType: "discipline",
      occurredAt: "2026-03-30T13:05:00.000Z",
      points: 6,
      reason: "Fight",
      comment: "Peer altercation at lunch",
      teacherName: "Dean Yusuf",
      sourceJobId: "run_sycamore_current",
      fingerprint: "fp_sycamore_current_6",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-03-30T13:30:00.000Z"
    }
  ];
}

function seedManualBandIncidents(): ApprovedIncident[] {
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
      fingerprint: "fp_old_manual_only",
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
      fingerprint: "fp_new_manual_only",
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
      fingerprint: "fp_new_sycamore_only",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-03-11T11:00:00.000Z"
    }
  ];
}

function seedInterventions(): Intervention[] {
  return [
    {
      id: "int_completed",
      studentId: "stu_1",
      policyVersion: 1,
      milestoneLabel: "10 points",
      status: "completed",
      dueDate: "2026-03-14T00:00:00.000Z",
      completedAt: "2026-03-16T00:00:00.000Z",
      assignedTo: "admin@school.org",
      notes: "Family meeting held."
    },
    {
      id: "int_overdue",
      studentId: "stu_4",
      policyVersion: 1,
      milestoneLabel: "10 points",
      status: "overdue",
      dueDate: "2026-03-22T00:00:00.000Z",
      completedAt: null,
      assignedTo: "admin@school.org",
      notes: "Still awaiting conference."
    }
  ];
}

function seedNotifications(): Notification[] {
  return [
    {
      id: "notif_queued",
      studentId: "stu_4",
      interventionId: "int_overdue",
      channel: "email",
      recipient: "admin@school.org",
      status: "queued",
      providerId: "",
      sentAt: null,
      error: ""
    },
    {
      id: "notif_failed",
      studentId: "stu_1",
      interventionId: "int_completed",
      channel: "email",
      recipient: "admin@school.org",
      status: "failed",
      providerId: "provider-1",
      sentAt: "2026-03-16T08:00:00.000Z",
      error: "SMTP timeout"
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
    approvedIncidents: seedManualBandIncidents(),
    policies: [seedPolicy()]
  });

  const snapshot = await buildAnalyticsSnapshot(storage, {
    grade: "8",
    from: "2026-03-10",
    to: "2026-03-10",
    sourceType: "manual_pdf",
    thresholdBand: "points_10_19"
  });

  assert.equal(snapshot.filters.from, "2026-03-10");
  assert.equal(snapshot.filters.to, "2026-03-10");
  assert.equal(snapshot.summary[0]?.value, 1);
  assert.equal(snapshot.summary[1]?.value, 1);
  assert.equal(snapshot.summary[2]?.value, 4);
  assert.equal(snapshot.thresholdPressure.escalatedStudents, 1);
  assert.equal(snapshot.studentRows[0]?.studentId, "stu_1");
  assert.equal(snapshot.studentRows[0]?.totalPoints, 4);
  assert.equal(snapshot.studentRows[0]?.currentTotalPoints, 16);
  assert.equal(snapshot.studentRows[0]?.currentBandId, "points_10_19");
});

test("buildAnalyticsSnapshot computes pressure, recurrence, workflow, and narrative metrics for the current window", async () => {
  const storage = createInMemoryStorage({
    parseRuns: [],
    rawIncidents: [],
    reviewTasks: [],
    students: seedStudents(),
    approvedIncidents: seedIncidents(),
    policies: [seedPolicy()],
    interventions: seedInterventions(),
    notifications: seedNotifications()
  });

  const snapshot = await buildAnalyticsSnapshot(storage, {
    sourceType: "sycamore_api"
  });

  assert.equal(snapshot.filters.from, "2026-03-01");
  assert.equal(snapshot.filters.to, "2026-03-30");
  assert.equal(snapshot.comparisonWindow.usedDefaultWindow, true);

  assert.equal(snapshot.summary[0]?.value, 4);
  assert.equal(snapshot.summary[1]?.value, 6);
  assert.equal(snapshot.summary[2]?.value, 22);
  assert.equal(snapshot.summary[3]?.value, 1);
  assert.equal(snapshot.thresholdPressure.crossedIntoHigherBand, 1);

  assert.equal(snapshot.repeatIncident.repeat14Rate, 25);
  assert.equal(snapshot.repeatIncident.repeat30Rate, 75);
  assert.equal(snapshot.repeatIncident.sameBehavior30Rate, 75);

  assert.equal(snapshot.concentration.topDecileStudents, 1);
  assert.equal(snapshot.concentration.topDecileShare, 40.9);
  assert.equal(snapshot.concentration.profile, "Moderately concentrated");

  assert.equal(snapshot.behaviorShiftRows[0]?.behavior, "Attendance / punctuality");
  assert.equal(snapshot.behaviorShiftRows[0]?.deltaIncidents, 2);

  assert.equal(snapshot.hotspotTiming.timeCoverageRate, 100);
  assert.equal(snapshot.hotspotTiming.rows.some((row) => row.timeBlock === "Arrival"), true);
  assert.equal(snapshot.interventionHealth.overdueCount, 1);
  assert.equal(snapshot.interventionHealth.completedOnTimeRate, 0);

  assert.equal(snapshot.postIntervention.completedInterventions, 1);
  assert.equal(snapshot.postIntervention.rows[0]?.days, 14);
  assert.equal(snapshot.postIntervention.rows[0]?.reentryRate, 100);

  assert.equal(snapshot.narrativeThemeRows.some((row) => row.theme === "Boundary testing"), true);
  assert.equal(snapshot.notificationStatus.queued, 1);
  assert.equal(snapshot.notificationStatus.failed, 1);
});
