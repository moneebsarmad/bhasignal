import assert from "node:assert/strict";
import test from "node:test";
import { inspect } from "node:util";

import type { ApprovedIncident, GuardianContact, Intervention, Policy, Student } from "@syc/domain";

import {
  approveParentOutreachNotifications,
  dispatchNotificationQueue,
  listParentOutreachQueue,
  queueManualOverrideNotification,
  queueNotificationsForInterventions,
  saveNotificationConfig,
  updateParentOutreachDraft
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
    sourceType: "sycamore_api",
    sourceRecordId: "sycamore_log_0001",
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

function seedSycamoreApprovedIncident(): ApprovedIncident {
  return {
    id: "inc_sycamore_1",
    studentId: "stu_1",
    sourceType: "sycamore_api",
    sourceRecordId: "sycamore_row_0001",
    externalStudentId: "1575220",
    gradeAtEvent: "8",
    eventType: null,
    occurredAt: "2026-02-12T00:00:00.000Z",
    points: 12,
    reason: "Disrespect",
    comment: "Talking back",
    teacherName: "Mr. Adams",
    sourceJobId: "run-1",
    fingerprint: "fp_sycamore_1",
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

function seedGuardianContact(): GuardianContact {
  return {
    id: "guardian_1",
    studentId: "stu_1",
    guardianName: "Jane Doe Sr.",
    relationship: "Mother",
    email: "parent.primary@home.org",
    phone: null,
    isPrimary: true,
    allowEmail: true,
    sourceType: "manual",
    sourceRecordId: null,
    lastSyncedAt: null,
    isActive: true,
    notes: ""
  };
}

function withoutSupabaseEnv<T>(run: () => Promise<T>): Promise<T> {
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalPublicSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  delete process.env.SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  return run().finally(() => {
    process.env.SUPABASE_URL = originalSupabaseUrl;
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalPublicSupabaseUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
  });
}

test("queueNotificationsForInterventions deduplicates by notification idempotency key", async () => {
  await withoutSupabaseEnv(async () => {
    const storage = createInMemoryStorage({
      parseRuns: [],
      rawIncidents: [],
      reviewTasks: [],
      students: [seedStudent()],
      approvedIncidents: [seedSycamoreApprovedIncident()],
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
});

test("dispatchNotificationQueue sends queued notifications and tracks failures", async () => {
  await withoutSupabaseEnv(async () => {
    const storage = createInMemoryStorage({
      parseRuns: [],
      rawIncidents: [],
      reviewTasks: [],
      students: [seedStudent()],
      approvedIncidents: [seedSycamoreApprovedIncident()],
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

    assert.equal(summary.attempted, 1);
    assert.equal(summary.sent, 1);
    assert.equal(summary.failed, 0);
    assert.equal(summary.deadLettered, 0);

    const notifications = await storage.notifications.list();
    const parentDraft = notifications.find((notification) => notification.kind === "parent_outreach") ?? null;
    assert.equal(parentDraft?.status, "draft");
  });
});

test("parent outreach drafts use guardian contacts, require approval, and dispatch after approval", async () => {
  await withoutSupabaseEnv(async () => {
    const storage = createInMemoryStorage({
      parseRuns: [],
      rawIncidents: [],
      reviewTasks: [],
      students: [seedStudent()],
      guardianContacts: [seedGuardianContact()],
      approvedIncidents: [seedSycamoreApprovedIncident()],
      interventions: [seedIntervention()],
      policies: [seedPolicy()]
    });

    await saveNotificationConfig({
      storage,
      actorEmail: "admin@school.org",
      payload: {
        sendStaffEmails: false,
        sendParentEmails: true,
        staffRecipients: [],
        parentRecipients: ["fallback@home.org"],
        subjectTemplate: "Update {{milestoneLabel}}",
        bodyTemplate: "Student {{studentName}} is currently in {{bandLabel}}.",
        maxAttempts: 1,
        provider: "console"
      }
    });

    const queued = await queueNotificationsForInterventions({
      storage,
      actorEmail: "admin@school.org",
      interventionIds: ["int_1"]
    });

    assert.equal(queued.queued, 1);

    const queue = await listParentOutreachQueue(storage);
    assert.equal(queue.length, 1);
    assert.equal(queue[0]?.recipient, "parent.primary@home.org");
    assert.equal(queue[0]?.guardianName, "Jane Doe Sr.");
    assert.equal(queue[0]?.status, "draft");
    assert.equal(queue[0]?.recipientSource, "manual");

    const beforeApproval = await dispatchNotificationQueue({
      storage,
      actorEmail: "admin@school.org",
      limit: 10
    });
    assert.equal(beforeApproval.attempted, 0);

    const draftId = queue[0]?.id;
    assert.ok(draftId);

    await updateParentOutreachDraft({
      storage,
      actorEmail: "admin@school.org",
      notificationId: draftId,
      subject: "Parent outreach for Jane Doe",
      body: "Jane Doe has entered the 10-19 demerit band. Please review the current intervention plan."
    });

    const approved = await approveParentOutreachNotifications({
      storage,
      actorEmail: "admin@school.org",
      notificationIds: [draftId]
    });
    assert.equal(approved.approved, 1);

    const afterApproval = await dispatchNotificationQueue({
      storage,
      actorEmail: "admin@school.org",
      limit: 10
    });
    assert.equal(afterApproval.attempted, 1);
    assert.equal(afterApproval.sent, 1);
    assert.equal(afterApproval.failed, 0);

    const notifications = await storage.notifications.list();
    const parentNotification = notifications.find((notification) => notification.id === draftId) ?? null;
    assert.equal(parentNotification?.status, "sent");
    assert.equal(parentNotification?.draftSubject, "Parent outreach for Jane Doe");
    assert.match(parentNotification?.draftBody ?? "", /10-19 demerit band/);
  });
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
  await withoutSupabaseEnv(async () => {
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
});
