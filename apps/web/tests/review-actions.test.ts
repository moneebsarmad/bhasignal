import assert from "node:assert/strict";
import test from "node:test";

import type {
  ApprovedIncident,
  AuditEvent,
  GuardianContact,
  Intervention,
  Notification,
  ParseRun,
  Policy,
  RawIncident,
  ReviewTask,
  Student
} from "@syc/domain";
import type { StorageRepositories } from "@syc/storage";

import { applyBulkReviewAction, applyReviewAction, confidenceBand, listReviewQueue } from "../lib/review";

export function createInMemoryStorage(seed: {
  parseRuns: ParseRun[];
  rawIncidents: RawIncident[];
  reviewTasks: ReviewTask[];
  students?: Student[];
  guardianContacts?: GuardianContact[];
  approvedIncidents?: ApprovedIncident[];
  policies?: Policy[];
  interventions?: Intervention[];
  notifications?: Notification[];
  auditEvents?: AuditEvent[];
}): StorageRepositories {
  const students = [...(seed.students ?? [])];
  const guardianContacts: GuardianContact[] = [...(seed.guardianContacts ?? [])];
  const rawIncidents = [...seed.rawIncidents];
  const approvedIncidents: ApprovedIncident[] = [...(seed.approvedIncidents ?? [])];
  const parseRuns = [...seed.parseRuns];
  const reviewTasks = [...seed.reviewTasks];
  const policies: Policy[] = [...(seed.policies ?? [])];
  const interventions: Intervention[] = [...(seed.interventions ?? [])];
  const notifications: Notification[] = [...(seed.notifications ?? [])];
  const auditEvents: AuditEvent[] = [...(seed.auditEvents ?? [])];

  return {
    students: {
      async upsert(student) {
        const index = students.findIndex((item) => item.id === student.id);
        if (index >= 0) {
          students[index] = student;
        } else {
          students.push(student);
        }
      },
      async getById(id) {
        return students.find((student) => student.id === id) ?? null;
      },
      async list() {
        return [...students];
      }
    },
    guardianContacts: {
      async upsert(contact) {
        const index = guardianContacts.findIndex((item) => item.id === contact.id);
        if (index >= 0) {
          guardianContacts[index] = contact;
        } else {
          guardianContacts.push(contact);
        }
      },
      async getById(id) {
        return guardianContacts.find((contact) => contact.id === id) ?? null;
      },
      async listByStudent(studentId) {
        return guardianContacts.filter((contact) => contact.studentId === studentId);
      },
      async list() {
        return [...guardianContacts];
      }
    },
    rawIncidents: {
      async upsert(incident) {
        const index = rawIncidents.findIndex((item) => item.id === incident.id);
        if (index >= 0) {
          rawIncidents[index] = incident;
        } else {
          rawIncidents.push(incident);
        }
      },
      async getById(id) {
        return rawIncidents.find((incident) => incident.id === id) ?? null;
      },
      async listByParseRun(parseRunId) {
        return rawIncidents.filter((incident) => incident.parseRunId === parseRunId);
      },
      async listByStatus(status) {
        return rawIncidents.filter((incident) => incident.status === status);
      },
      async list() {
        return [...rawIncidents];
      }
    },
    approvedIncidents: {
      async upsert(incident) {
        const index = approvedIncidents.findIndex(
          (item) =>
            item.id === incident.id ||
            item.fingerprint === incident.fingerprint ||
            (incident.sourceType === "sycamore_api" &&
              item.sourceType === incident.sourceType &&
              item.sourceRecordId === incident.sourceRecordId)
        );
        if (index >= 0) {
          approvedIncidents[index] = { ...incident, id: approvedIncidents[index]?.id ?? incident.id };
        } else {
          approvedIncidents.push(incident);
        }
      },
      async getById(id) {
        return approvedIncidents.find((incident) => incident.id === id) ?? null;
      },
      async getByFingerprint(fingerprint) {
        return approvedIncidents.find((incident) => incident.fingerprint === fingerprint) ?? null;
      },
      async listByStudent(studentId) {
        return approvedIncidents.filter((incident) => incident.studentId === studentId);
      },
      async list() {
        return [...approvedIncidents];
      }
    },
    parseRuns: {
      async upsert(parseRun) {
        const index = parseRuns.findIndex((item) => item.id === parseRun.id);
        if (index >= 0) {
          parseRuns[index] = parseRun;
        } else {
          parseRuns.push(parseRun);
        }
      },
      async getById(id) {
        return parseRuns.find((parseRun) => parseRun.id === id) ?? null;
      },
      async list() {
        return [...parseRuns];
      }
    },
    reviewTasks: {
      async upsert(task) {
        const index = reviewTasks.findIndex((item) => item.id === task.id);
        if (index >= 0) {
          reviewTasks[index] = task;
        } else {
          reviewTasks.push(task);
        }
      },
      async getById(id) {
        return reviewTasks.find((task) => task.id === id) ?? null;
      },
      async listByParseRun(parseRunId) {
        return reviewTasks.filter((task) => task.parseRunId === parseRunId);
      },
      async listByStatus(status) {
        return reviewTasks.filter((task) => task.status === status);
      }
    },
    policies: {
      async upsert(policy) {
        const index = policies.findIndex((item) => item.version === policy.version);
        if (index >= 0) {
          policies[index] = policy;
        } else {
          policies.push(policy);
        }
      },
      async getByVersion(version) {
        return policies.find((policy) => policy.version === version) ?? null;
      },
      async getLatest() {
        return policies.at(-1) ?? null;
      },
      async list() {
        return [...policies];
      }
    },
    interventions: {
      async upsert(intervention) {
        const index = interventions.findIndex((item) => item.id === intervention.id);
        if (index >= 0) {
          interventions[index] = intervention;
        } else {
          interventions.push(intervention);
        }
      },
      async getById(id) {
        return interventions.find((intervention) => intervention.id === id) ?? null;
      },
      async listByStudent(studentId) {
        return interventions.filter((intervention) => intervention.studentId === studentId);
      },
      async list() {
        return [...interventions];
      }
    },
    notifications: {
      async upsert(notification) {
        const index = notifications.findIndex((item) => item.id === notification.id);
        if (index >= 0) {
          notifications[index] = notification;
        } else {
          notifications.push(notification);
        }
      },
      async listByStudent(studentId) {
        return notifications.filter((notification) => notification.studentId === studentId);
      },
      async list() {
        return [...notifications];
      }
    },
    auditEvents: {
      async append(event) {
        auditEvents.push(event);
      },
      async listByEntity(entityType, entityId) {
        return auditEvents.filter(
          (event) => event.entityType === entityType && event.entityId === entityId
        );
      },
      async list() {
        return [...auditEvents];
      }
    }
  };
}

function seedData() {
  const parseRun: ParseRun = {
    id: "run-1",
    sourceType: "manual_pdf",
    fileName: "discipline.pdf",
    uploadedBy: "admin@school.org",
    triggeredBy: "admin@school.org",
    metadataJson: "{}",
    cursorJson: null,
    status: "review_required",
    rowsExtracted: 1,
    rowsFlagged: 1,
    startedAt: "2026-02-12T00:00:00.000Z",
    completedAt: null
  };
  const rawIncident: RawIncident = {
    id: "raw-1",
    parseRunId: "run-1",
    sourceType: "manual_pdf",
    sourceRecordId: "pdf_row_0001",
    studentReference: "Jane Doe",
    externalStudentId: null,
    gradeAtEvent: null,
    eventType: null,
    occurredAt: "2026-02-11T08:15:00Z",
    writeupDate: "2026-02-11",
    points: 3,
    reason: "Disrespect",
    violation: "Disrespect",
    violationRaw: "Level 2: Disrespect",
    level: 2,
    comment: "Talking back",
    description: "Talking back",
    resolution: null,
    teacherName: "Mr. Adams",
    authorName: "Mr. Adams",
    authorNameRaw: "Adams, Mr.",
    sourcePayloadJson: "{}",
    mappingWarningsJson: "[]",
    confidenceJson: JSON.stringify({ recordConfidence: 0.65, warnings: ["low_confidence_reason"] }),
    status: "pending_review"
  };
  const reviewTask: ReviewTask = {
    id: "task-1",
    parseRunId: "run-1",
    rawIncidentId: "raw-1",
    assignee: null,
    status: "open",
    resolution: "",
    createdAt: "2026-02-12T00:00:00.000Z",
    resolvedAt: null
  };

  return { parseRun, rawIncident, reviewTask };
}

test("applyReviewAction approve promotes incident and closes parse run when queue is clear", async () => {
  const { parseRun, rawIncident, reviewTask } = seedData();
  const storage = createInMemoryStorage({
    parseRuns: [parseRun],
    rawIncidents: [rawIncident],
    reviewTasks: [reviewTask]
  });

  const result = await applyReviewAction({
    storage,
    taskId: "task-1",
    actorEmail: "reviewer@school.org",
    action: "approve"
  });

  assert.equal(result.task.status, "approved");
  assert.equal(result.rawIncident.status, "approved");
  assert.equal(Boolean(result.approvedIncident), true);
  assert.equal(result.approvedIncident?.writeupDate, "2026-02-11");
  assert.equal(result.approvedIncident?.level, 2);
  assert.equal(result.approvedIncident?.authorNameRaw, "Adams, Mr.");
  const run = await storage.parseRuns.getById("run-1");
  assert.equal(run?.status, "completed");
});

test("applyReviewAction reject marks incident rejected and does not promote", async () => {
  const { parseRun, rawIncident, reviewTask } = seedData();
  const storage = createInMemoryStorage({
    parseRuns: [parseRun],
    rawIncidents: [rawIncident],
    reviewTasks: [reviewTask]
  });

  const result = await applyReviewAction({
    storage,
    taskId: "task-1",
    actorEmail: "reviewer@school.org",
    action: "reject",
    reason: "not_discipline_event"
  });

  assert.equal(result.task.status, "rejected");
  assert.equal(result.rawIncident.status, "rejected");
  assert.equal(result.approvedIncident, undefined);
});

test("applyReviewAction edit_approve persists discipline-specific field edits", async () => {
  const { parseRun, rawIncident, reviewTask } = seedData();
  const storage = createInMemoryStorage({
    parseRuns: [parseRun],
    rawIncidents: [rawIncident],
    reviewTasks: [reviewTask]
  });

  const result = await applyReviewAction({
    storage,
    taskId: "task-1",
    actorEmail: "reviewer@school.org",
    action: "edit_approve",
    edits: {
      studentReference: "Danah Ginawi",
      occurredAt: "2026-02-11T09:00:00Z",
      writeupDate: "2026-02-11",
      points: 4,
      reason: "Disruptive Behavior",
      violation: "Disruptive Behavior",
      violationRaw: "Level 2: Disruptive Behavior",
      level: 2,
      comment: "Student disrupted instruction repeatedly.",
      description: "Student disrupted instruction repeatedly.",
      resolution: "Conference held after class.",
      teacherName: "Abir Bou Imajjane",
      authorName: "Abir Bou Imajjane",
      authorNameRaw: "Bou Imajjane, Abir"
    }
  });

  assert.equal(result.task.status, "edited");
  assert.equal(result.rawIncident.studentReference, "Danah Ginawi");
  assert.equal(result.rawIncident.violation, "Disruptive Behavior");
  assert.equal(result.rawIncident.description, "Student disrupted instruction repeatedly.");
  assert.equal(result.rawIncident.resolution, "Conference held after class.");
  assert.equal(result.rawIncident.authorName, "Abir Bou Imajjane");
  assert.equal(result.approvedIncident?.violationRaw, "Level 2: Disruptive Behavior");
  assert.equal(result.approvedIncident?.authorNameRaw, "Bou Imajjane, Abir");
});

test("listReviewQueue supports confidence filtering", async () => {
  const { parseRun, rawIncident, reviewTask } = seedData();
  const storage = createInMemoryStorage({
    parseRuns: [parseRun],
    rawIncidents: [rawIncident],
    reviewTasks: [reviewTask]
  });

  const lowItems = await listReviewQueue(storage, { status: "open", confidence: "low" });
  const highItems = await listReviewQueue(storage, { status: "open", confidence: "high" });
  assert.equal(lowItems.length, 1);
  assert.equal(highItems.length, 0);
  assert.equal(confidenceBand(lowItems[0]?.recordConfidence ?? null), "low");
});

test("listReviewQueue supports source type filtering", async () => {
  const { parseRun, rawIncident, reviewTask } = seedData();
  const sycamoreRun: ParseRun = {
    ...parseRun,
    id: "run-2",
    sourceType: "sycamore_api",
    fileName: "sycamore-discipline-2026-03-10_to_2026-03-10.json"
  };
  const sycamoreIncident: RawIncident = {
    ...rawIncident,
    id: "raw-2",
    parseRunId: "run-2",
    sourceType: "sycamore_api",
    sourceRecordId: "disc-1"
  };
  const sycamoreTask: ReviewTask = {
    ...reviewTask,
    id: "task-2",
    parseRunId: "run-2",
    rawIncidentId: "raw-2"
  };

  const storage = createInMemoryStorage({
    parseRuns: [parseRun, sycamoreRun],
    rawIncidents: [rawIncident, sycamoreIncident],
    reviewTasks: [reviewTask, sycamoreTask]
  });

  const manualItems = await listReviewQueue(storage, { status: "open", sourceType: "manual_pdf" });
  const sycamoreItems = await listReviewQueue(storage, { status: "open", sourceType: "sycamore_api" });

  assert.equal(manualItems.length, 1);
  assert.equal(manualItems[0]?.rawIncident.sourceType, "manual_pdf");
  assert.equal(sycamoreItems.length, 1);
  assert.equal(sycamoreItems[0]?.rawIncident.sourceType, "sycamore_api");
});

test("applyReviewAction reuses the same approved incident for repeated Sycamore source records", async () => {
  const now = "2026-03-11T12:00:00.000Z";
  const existingApprovedIncident: ApprovedIncident = {
    id: "run-old:approved:raw-old",
    studentId: "stu_123",
    sourceType: "sycamore_api",
    sourceRecordId: "disc-1",
    externalStudentId: "student-1",
    gradeAtEvent: "7",
    eventType: "discipline",
    occurredAt: "2026-03-10T14:05:00.000Z",
    writeupDate: "2026-03-10",
    points: 4,
    reason: "Disrespect",
    violation: "Disrespect",
    violationRaw: "Level 2: Disrespect",
    level: 2,
    comment: "Repeated classroom disruption",
    description: "Repeated classroom disruption",
    resolution: null,
    teacherName: "Ms Smith",
    authorName: "Ms Smith",
    authorNameRaw: "Smith, Ms",
    sourceJobId: "run-old",
    fingerprint: "legacy-fingerprint",
    reviewedBy: "reviewer@school.org",
    reviewedAt: now
  };
  const parseRun: ParseRun = {
    id: "run-new",
    sourceType: "sycamore_api",
    fileName: "sycamore-discipline-2026-03-10_to_2026-03-10.json",
    uploadedBy: "admin@school.org",
    triggeredBy: "admin@school.org",
    metadataJson: "{}",
    cursorJson: "{\"endDate\":\"2026-03-10\"}",
    status: "review_required",
    rowsExtracted: 1,
    rowsFlagged: 1,
    startedAt: now,
    completedAt: null
  };
  const rawIncident: RawIncident = {
    id: "raw-new",
    parseRunId: "run-new",
    sourceType: "sycamore_api",
    sourceRecordId: "disc-1",
    studentReference: "Jane Doe",
    externalStudentId: "student-1",
    gradeAtEvent: "7",
    eventType: "discipline",
    occurredAt: "2026-03-10T14:05:00.000Z",
    writeupDate: "2026-03-10",
    points: 4,
    reason: "Disrespect",
    violation: "Disrespect",
    violationRaw: "Level 2: Disrespect",
    level: 2,
    comment: "Repeated classroom disruption",
    description: "Repeated classroom disruption",
    resolution: null,
    teacherName: "Ms Smith",
    authorName: "Ms Smith",
    authorNameRaw: "Smith, Ms",
    sourcePayloadJson: "{}",
    mappingWarningsJson: "[]",
    confidenceJson: JSON.stringify({ recordConfidence: 1, warnings: [] }),
    status: "pending_review"
  };
  const reviewTask: ReviewTask = {
    id: "task-new",
    parseRunId: "run-new",
    rawIncidentId: "raw-new",
    assignee: null,
    status: "open",
    resolution: "",
    createdAt: now,
    resolvedAt: null
  };
  const storage = createInMemoryStorage({
    parseRuns: [parseRun],
    rawIncidents: [rawIncident],
    reviewTasks: [reviewTask],
    students: [
      {
        id: "stu_123",
        externalId: "student-1",
        fullName: "Jane Doe",
        grade: "7",
        active: true,
        createdAt: now,
        updatedAt: now
      }
    ],
    approvedIncidents: [existingApprovedIncident]
  });

  const result = await applyReviewAction({
    storage,
    taskId: "task-new",
    actorEmail: "reviewer@school.org",
    action: "approve"
  });

  assert.equal(result.approvedIncident?.id, existingApprovedIncident.id);
  const approvedIncidents = await storage.approvedIncidents.list();
  assert.equal(approvedIncidents.length, 1);
  assert.equal(approvedIncidents[0]?.sourceJobId, "run-new");
});

test("applyBulkReviewAction processes open tasks and skips already resolved ones", async () => {
  const { parseRun, rawIncident, reviewTask } = seedData();
  const secondRawIncident: RawIncident = {
    ...rawIncident,
    id: "raw-2",
    sourceRecordId: "pdf_row_0002",
    studentReference: "John Doe"
  };
  const resolvedTask: ReviewTask = {
    ...reviewTask,
    id: "task-2",
    rawIncidentId: "raw-2",
    status: "approved",
    resolvedAt: "2026-02-12T00:10:00.000Z"
  };

  const storage = createInMemoryStorage({
    parseRuns: [parseRun],
    rawIncidents: [rawIncident, secondRawIncident],
    reviewTasks: [reviewTask, resolvedTask]
  });

  const result = await applyBulkReviewAction({
    storage,
    taskIds: ["task-1", "task-2"],
    actorEmail: "reviewer@school.org",
    action: "approve"
  });

  assert.equal(result.processedCount, 1);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.results.find((item) => item.taskId === "task-1")?.status, "processed");
  assert.equal(result.results.find((item) => item.taskId === "task-2")?.status, "skipped");
  assert.match(result.results.find((item) => item.taskId === "task-2")?.error ?? "", /already resolved/i);
});
