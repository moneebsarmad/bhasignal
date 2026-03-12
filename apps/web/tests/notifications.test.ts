import assert from "node:assert/strict";
import test from "node:test";
import { inspect } from "node:util";

import type { ApprovedIncident, Intervention, Policy, Student } from "@syc/domain";

import {
  dispatchNotificationQueue,
  queueManualOverrideNotification,
  queueNotificationsForInterventions,
  saveNotificationConfig
} from "../lib/notifications";
import { createInMemoryStorage } from "./review-actions.test";

function seedStudent(): Student {
  return {
    id: "stu_1",
    externalId: null,
    fullName: "Jane Doe",
    grade: "8",
    active: true,
    createdAt: "2026-02-12T00:00:00.000Z",
    updatedAt: "2026-02-12T00:00:00.000Z"
  };
}

function seedApprovedIncident(): ApprovedIncident {
  return {
    id: "inc_1",
    studentId: "stu_1",
    sourceType: "manual_pdf",
    sourceRecordId: "pdf_row_0001",
    externalStudentId: null,
    gradeAtEvent: "8",
    eventType: null,
    occurredAt: "2026-02-12T00:00:00.000Z",
    points: 12,
    reason: "Disrespect",
    comment: "Talking back",
    teacherName: "Mr. Adams",
    sourceJobId: "run-1",
    fingerprint: "fp_1",
    reviewedBy: "reviewer@school.org",
    reviewedAt: "2026-02-12T00:00:00.000Z"
  };
}

function seedIntervention(): Intervention {
  return {
    id: "int_1",
    studentId: "stu_1",
    policyVersion: 1,
    milestoneLabel: "X",
    status: "open",
    dueDate: "2026-02-20T00:00:00.000Z",
    completedAt: null,
    assignedTo: "Dean",
    notes: "Threshold reached"
  };
}

function seedPolicy(): Policy {
  return {
    version: 1,
    baseThreshold: 10,
    warningOffsets: [-3, -1],
    milestones: [0, 10, 20],
    interventionTemplates: "[]",
    createdBy: "admin@school.org",
    createdAt: "2026-02-12T00:00:00.000Z"
  };
}

test("queueNotificationsForInterventions deduplicates by notification idempotency key", async () => {
  const storage = createInMemoryStorage({
    parseRuns: [],
    rawIncidents: [],
    reviewTasks: [],
    students: [seedStudent()],
    approvedIncidents: [seedApprovedIncident()],
    interventions: [seedIntervention()],
    policies: [seedPolicy()]
  });

  await saveNotificationConfig({
    storage,
    actorEmail: "admin@school.org",
    payload: {
      sendStaffEmails: true,
      sendParentEmails: true,
      staffRecipients: ["staff@school.org"],
      parentRecipients: ["parent@home.org"],
      subjectTemplate: "Update {{milestoneLabel}}",
      bodyTemplate: "Student {{studentName}} reached {{milestoneLabel}}",
      maxAttempts: 3,
      provider: "console"
    }
  });

  const first = await queueNotificationsForInterventions({
    storage,
    actorEmail: "admin@school.org",
    interventionIds: ["int_1"]
  });
  const second = await queueNotificationsForInterventions({
    storage,
    actorEmail: "admin@school.org",
    interventionIds: ["int_1"]
  });

  assert.equal(first.queued, 2);
  assert.equal(second.queued, 0);
  assert.equal(second.skipped, 2);
});

test("dispatchNotificationQueue sends queued notifications and tracks failures", async () => {
  const storage = createInMemoryStorage({
    parseRuns: [],
    rawIncidents: [],
    reviewTasks: [],
    students: [seedStudent()],
    approvedIncidents: [seedApprovedIncident()],
    interventions: [seedIntervention()],
    policies: [seedPolicy()]
  });

  await saveNotificationConfig({
    storage,
    actorEmail: "admin@school.org",
    payload: {
      sendStaffEmails: true,
      sendParentEmails: true,
      staffRecipients: ["staff@school.org"],
      parentRecipients: ["fail@home.org"],
      subjectTemplate: "Update {{milestoneLabel}}",
      bodyTemplate: "Student {{studentName}} reached {{milestoneLabel}}",
      maxAttempts: 1,
      provider: "console"
    }
  });

  await queueNotificationsForInterventions({
    storage,
    actorEmail: "admin@school.org",
    interventionIds: ["int_1"]
  });

  const summary = await dispatchNotificationQueue({
    storage,
    actorEmail: "admin@school.org",
    limit: 10
  });

  assert.equal(summary.attempted, 2);
  assert.equal(summary.sent, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.deadLettered, 1);
});

test("queueManualOverrideNotification requires explicit reason and is auditable", async () => {
  const storage = createInMemoryStorage({
    parseRuns: [],
    rawIncidents: [],
    reviewTasks: [],
    students: [seedStudent()],
    approvedIncidents: [seedApprovedIncident()],
    interventions: [seedIntervention()],
    policies: [seedPolicy()]
  });

  const notification = await queueManualOverrideNotification({
    storage,
    actorEmail: "admin@school.org",
    payload: {
      studentId: "stu_1",
      interventionId: "int_1",
      recipient: "override@home.org",
      reason: "Parent requested duplicate copy",
      subject: "Manual override send",
      body: "This is an override notification."
    }
  });

  assert.match(notification.id, /^notif_/);
  const audit = await storage.auditEvents.listByEntity("notification", notification.id);
  assert.equal(audit.some((event) => event.eventType === "notification_override_queued"), true);
});

test("dispatchNotificationQueue scrubs recipient PII in provider logs", async () => {
  const storage = createInMemoryStorage({
    parseRuns: [],
    rawIncidents: [],
    reviewTasks: [],
    students: [seedStudent()],
    approvedIncidents: [seedApprovedIncident()],
    interventions: [seedIntervention()],
    policies: [seedPolicy()]
  });

  await saveNotificationConfig({
    storage,
    actorEmail: "admin@school.org",
    payload: {
      sendStaffEmails: true,
      sendParentEmails: false,
      staffRecipients: ["sensitive.person@school.org"],
      parentRecipients: [],
      subjectTemplate: "Update {{milestoneLabel}}",
      bodyTemplate: "Student {{studentName}} reached {{milestoneLabel}}",
      maxAttempts: 1,
      provider: "console"
    }
  });
  await queueNotificationsForInterventions({
    storage,
    actorEmail: "admin@school.org",
    interventionIds: ["int_1"]
  });

  const logged: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logged.push(args.map((arg) => inspect(arg, { depth: 6 })).join(" "));
  };
  try {
    await dispatchNotificationQueue({
      storage,
      actorEmail: "admin@school.org",
      limit: 5
    });
  } finally {
    console.log = originalLog;
  }

  const combined = logged.join("\n");
  assert.equal(combined.includes("sensitive.person@school.org"), false);
  assert.equal(combined.includes("s***@school.org"), true);
});
