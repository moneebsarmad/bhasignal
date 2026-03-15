import assert from "node:assert/strict";
import test from "node:test";

import { processIngestionUpload } from "../lib/ingestion-workflow";
import { updateInterventionStatus } from "../lib/interventions";
import {
  dispatchNotificationQueue,
  queueNotificationsForInterventions,
  saveNotificationConfig
} from "../lib/notifications";
import { createPolicyVersion, evaluatePolicyAndInterventions } from "../lib/policies";
import { applyBulkReviewAction, applyReviewAction } from "../lib/review";
import { createInMemoryStorage } from "./review-actions.test";

test.skip("upload -> review -> policy -> notify -> intervention complete flow", async () => {
  const storage = createInMemoryStorage({
    parseRuns: [],
    rawIncidents: [],
    reviewTasks: []
  });

  await saveNotificationConfig({
    storage,
    actorEmail: "admin@school.org",
    payload: {
      sendStaffEmails: true,
      sendParentEmails: false,
      staffRecipients: ["staff@school.org"],
      parentRecipients: [],
      subjectTemplate: "Discipline: {{milestoneLabel}} {{studentName}}",
      bodyTemplate: "Student {{studentName}} points={{points}}",
      maxAttempts: 3,
      provider: "console"
    }
  });

  const ingestion = await processIngestionUpload({
    storage,
    actorEmail: "admin@school.org",
    fileName: "discipline.pdf",
    fileBuffer: Buffer.from("%PDF-1.4\n/Type /Page\n", "latin1"),
    parsePdf: async () => ({
      parserVersion: "parser-v1",
      parsedAt: "2026-02-12T00:00:00.000Z",
      records: [
        {
          student: { value: "Jane Doe", confidence: 0.98 },
          occurredAt: { value: "2026-02-11T08:00:00Z", confidence: 0.95 },
          points: { value: "12", confidence: 0.96 },
          reason: { value: "Disrespect", confidence: 0.93 },
          teacher: { value: "Ms Smith", confidence: 0.9 },
          comment: { value: "Multiple disruptions", confidence: 0.89 },
          sourceSnippet: "row_1",
          recordConfidence: 0.9,
          warnings: []
        }
      ],
      warnings: []
    }),
    sleep: async () => {}
  });

  const reviewTasks = await storage.reviewTasks.listByParseRun(ingestion.parseRun.id);
  assert.equal(reviewTasks.length, 1);
  const task = reviewTasks[0];
  assert.ok(task);

  await applyReviewAction({
    storage,
    taskId: task.id,
    actorEmail: "reviewer@school.org",
    action: "approve"
  });

  await createPolicyVersion({
    storage,
    actorEmail: "admin@school.org",
    payload: {
      baseThreshold: 10,
      warningOffsets: [-3, -1],
      milestones: [0, 10, 20],
      interventionTemplates: [
        { label: "X-3", dueDays: 3, assignedTo: "Dean", notesTemplate: "Warning at X-3" },
        { label: "X-1", dueDays: 3, assignedTo: "Dean", notesTemplate: "Warning at X-1" },
        { label: "X", dueDays: 7, assignedTo: "Dean", notesTemplate: "Reached threshold" },
        { label: "X+10", dueDays: 7, assignedTo: "Dean", notesTemplate: "Escalated threshold" },
        { label: "X+20", dueDays: 7, assignedTo: "Dean", notesTemplate: "Severe threshold" }
      ]
    }
  });

  const evaluation = await evaluatePolicyAndInterventions({
    storage,
    actorEmail: "admin@school.org"
  });
  assert.equal(evaluation.triggeredInterventions >= 3, true);

  const queued = await queueNotificationsForInterventions({
    storage,
    actorEmail: "admin@school.org",
    interventionIds: evaluation.triggeredInterventionIds
  });
  assert.equal(queued.queued > 0, true);

  const dispatch = await dispatchNotificationQueue({
    storage,
    actorEmail: "admin@school.org",
    limit: 100
  });
  assert.equal(dispatch.sent > 0, true);

  const interventions = await storage.interventions.list();
  const firstIntervention = interventions[0];
  assert.ok(firstIntervention);

  await updateInterventionStatus({
    storage,
    interventionId: firstIntervention.id,
    actorEmail: "reviewer@school.org",
    payload: { status: "in_progress", notes: "Started meeting", assignee: "Counselor" }
  });
  const completed = await updateInterventionStatus({
    storage,
    interventionId: firstIntervention.id,
    actorEmail: "reviewer@school.org",
    payload: { status: "completed", notes: "Completed intervention" }
  });
  assert.equal(completed.status, "completed");
  assert.equal(Boolean(completed.completedAt), true);

  const approvedIncidents = await storage.approvedIncidents.list();
  assert.equal(approvedIncidents.length, 1);

  const events = await storage.auditEvents.list();
  const types = new Set(events.map((event) => event.eventType));
  assert.equal(types.has("review_task_resolved"), true);
  assert.equal(types.has("policy_trigger_created"), true);
  assert.equal(types.has("notification_sent"), true);
  assert.equal(types.has("intervention_status_updated"), true);
});

test.skip("review approval automatically evaluates policy and queues notifications", async () => {
  const storage = createInMemoryStorage({
    parseRuns: [],
    rawIncidents: [],
    reviewTasks: []
  });

  await saveNotificationConfig({
    storage,
    actorEmail: "admin@school.org",
    payload: {
      sendStaffEmails: true,
      sendParentEmails: false,
      staffRecipients: ["staff@school.org"],
      parentRecipients: [],
      subjectTemplate: "Discipline: {{milestoneLabel}} {{studentName}}",
      bodyTemplate: "Student {{studentName}} points={{points}}",
      maxAttempts: 3,
      provider: "console"
    }
  });

  await createPolicyVersion({
    storage,
    actorEmail: "admin@school.org",
    payload: {
      baseThreshold: 10,
      warningOffsets: [-3, -1],
      milestones: [0, 10, 20],
      interventionTemplates: [
        { label: "X-3", dueDays: 3, assignedTo: "Dean", notesTemplate: "Warning at X-3" },
        { label: "X-1", dueDays: 3, assignedTo: "Dean", notesTemplate: "Warning at X-1" },
        { label: "X", dueDays: 7, assignedTo: "Dean", notesTemplate: "Reached threshold" }
      ]
    }
  });

  const ingestion = await processIngestionUpload({
    storage,
    actorEmail: "admin@school.org",
    fileName: "discipline.pdf",
    fileBuffer: Buffer.from("%PDF-1.4\n/Type /Page\n", "latin1"),
    parsePdf: async () => ({
      parserVersion: "parser-v1",
      parsedAt: "2026-02-12T00:00:00.000Z",
      records: [
        {
          student: { value: "Jane Doe", confidence: 0.98 },
          occurredAt: { value: "2026-02-11T08:00:00Z", confidence: 0.95 },
          points: { value: "12", confidence: 0.96 },
          reason: { value: "Disrespect", confidence: 0.93 },
          teacher: { value: "Ms Smith", confidence: 0.9 },
          comment: { value: "Multiple disruptions", confidence: 0.89 },
          sourceSnippet: "row_1",
          recordConfidence: 0.9,
          warnings: []
        }
      ],
      warnings: []
    }),
    sleep: async () => {}
  });

  const reviewTasks = await storage.reviewTasks.listByParseRun(ingestion.parseRun.id);
  const task = reviewTasks[0];
  assert.ok(task);

  const result = await applyReviewAction({
    storage,
    taskId: task.id,
    actorEmail: "reviewer@school.org",
    action: "approve"
  });

  assert.equal((result.automation?.policyEvaluation?.triggeredInterventions ?? 0) >= 1, true);
  assert.equal((result.automation?.notificationQueue?.queued ?? 0) >= 1, true);

  const interventions = await storage.interventions.list();
  const notifications = await storage.notifications.list();
  const events = await storage.auditEvents.list();
  const eventTypes = new Set(events.map((event) => event.eventType));

  assert.equal(interventions.length >= 1, true);
  assert.equal(notifications.length >= 1, true);
  assert.equal(eventTypes.has("review_approval_automation_completed"), true);
  assert.equal(eventTypes.has("policy_trigger_created"), true);
  assert.equal(eventTypes.has("notification_queued"), true);
});

test("bulk review approval runs downstream automation once after the batch", async () => {
  const storage = createInMemoryStorage({
    parseRuns: [],
    rawIncidents: [],
    reviewTasks: []
  });

  await saveNotificationConfig({
    storage,
    actorEmail: "admin@school.org",
    payload: {
      sendStaffEmails: true,
      sendParentEmails: false,
      staffRecipients: ["staff@school.org"],
      parentRecipients: [],
      subjectTemplate: "Discipline: {{milestoneLabel}} {{studentName}}",
      bodyTemplate: "Student {{studentName}} points={{points}}",
      maxAttempts: 3,
      provider: "console"
    }
  });

  await createPolicyVersion({
    storage,
    actorEmail: "admin@school.org",
    payload: {
      baseThreshold: 10,
      warningOffsets: [-3, -1],
      milestones: [0, 10, 20],
      interventionTemplates: [
        { label: "X-3", dueDays: 3, assignedTo: "Dean", notesTemplate: "Warning at X-3" },
        { label: "X-1", dueDays: 3, assignedTo: "Dean", notesTemplate: "Warning at X-1" },
        { label: "X", dueDays: 7, assignedTo: "Dean", notesTemplate: "Reached threshold" }
      ]
    }
  });

  const ingestion = await processIngestionUpload({
    storage,
    actorEmail: "admin@school.org",
    fileName: "discipline.pdf",
    fileBuffer: Buffer.from("%PDF-1.4\n/Type /Page\n", "latin1"),
    parsePdf: async () => ({
      parserVersion: "parser-v1",
      parsedAt: "2026-02-12T00:00:00.000Z",
      records: [
        {
          student: { value: "Jane Doe", confidence: 0.98 },
          occurredAt: { value: "2026-02-11T08:00:00Z", confidence: 0.95 },
          points: { value: "6", confidence: 0.96 },
          reason: { value: "Disrespect", confidence: 0.93 },
          teacher: { value: "Ms Smith", confidence: 0.9 },
          comment: { value: "Multiple disruptions", confidence: 0.89 },
          sourceSnippet: "row_1",
          recordConfidence: 0.96,
          warnings: []
        },
        {
          student: { value: "Jane Doe", confidence: 0.98 },
          occurredAt: { value: "2026-02-12T08:00:00Z", confidence: 0.95 },
          points: { value: "6", confidence: 0.96 },
          reason: { value: "Defiance", confidence: 0.93 },
          teacher: { value: "Ms Smith", confidence: 0.9 },
          comment: { value: "Ignored repeated instructions", confidence: 0.89 },
          sourceSnippet: "row_2",
          recordConfidence: 0.96,
          warnings: []
        }
      ],
      warnings: []
    }),
    sleep: async () => {}
  });

  const reviewTasks = await storage.reviewTasks.listByParseRun(ingestion.parseRun.id);
  assert.equal(reviewTasks.length, 2);

  const result = await applyBulkReviewAction({
    storage,
    taskIds: reviewTasks.map((task) => task.id),
    actorEmail: "reviewer@school.org",
    action: "approve"
  });

  assert.equal(result.processedCount, 2);
  assert.equal((result.automation?.policyEvaluation?.triggeredInterventions ?? 0) >= 1, true);
  assert.equal((result.automation?.notificationQueue?.queued ?? 0) >= 1, true);

  const events = await storage.auditEvents.list();
  const automationEvents = events.filter((event) => event.eventType === "review_approval_automation_completed");
  assert.equal(automationEvents.length, 1);
  assert.equal(automationEvents[0]?.entityType, "review_batch");
});
