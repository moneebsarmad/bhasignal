import assert from "node:assert/strict";
import test from "node:test";

import type { ApprovedIncident, Policy, Student } from "@syc/domain";

import { evaluatePolicyAndInterventions } from "../lib/policies";
import { createInMemoryStorage } from "./review-actions.test";

function seedPolicy(): Policy {
  return {
    version: 1,
    baseThreshold: 10,
    warningOffsets: [-3, -1],
    milestones: [0, 10, 20],
    interventionTemplates: JSON.stringify([
      { label: "X-3", dueDays: 3, assignedTo: null, notesTemplate: "Warn at X-3" },
      { label: "X-1", dueDays: 2, assignedTo: null, notesTemplate: "Warn at X-1" },
      { label: "X", dueDays: 7, assignedTo: "Dean", notesTemplate: "Threshold reached" },
      { label: "X+10", dueDays: 7, assignedTo: "Principal", notesTemplate: "Escalated threshold" },
      { label: "X+20", dueDays: 5, assignedTo: "Principal", notesTemplate: "Severe threshold" }
    ]),
    createdBy: "admin@school.org",
    createdAt: "2026-02-12T00:00:00.000Z"
  };
}

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

function seedApprovedIncident(points: number): ApprovedIncident {
  return {
    id: `inc_${points}`,
    studentId: "stu_1",
    sourceType: "manual_pdf",
    sourceRecordId: `pdf_row_${String(Math.abs(points)).padStart(4, "0")}`,
    externalStudentId: null,
    gradeAtEvent: "8",
    eventType: null,
    occurredAt: "2026-02-12T00:00:00.000Z",
    points,
    reason: "Disrespect",
    comment: "Talking back",
    teacherName: "Mr. Adams",
    sourceJobId: "run-1",
    fingerprint: `fp_${points}`,
    reviewedBy: "reviewer@school.org",
    reviewedAt: "2026-02-12T00:00:00.000Z"
  };
}

test("policy evaluation creates transition-only interventions and avoids duplicates", async () => {
  const storage = createInMemoryStorage({
    parseRuns: [],
    rawIncidents: [],
    reviewTasks: [],
    students: [seedStudent()],
    approvedIncidents: [seedApprovedIncident(12)],
    policies: [seedPolicy()]
  });

  const first = await evaluatePolicyAndInterventions({
    storage,
    actorEmail: "admin@school.org"
  });
  assert.equal(first.triggeredInterventions, 3);

  const second = await evaluatePolicyAndInterventions({
    storage,
    actorEmail: "admin@school.org"
  });
  assert.equal(second.triggeredInterventions, 0);
  assert.equal(second.reopenedInterventions, 0);
});

test("policy recompute closes active interventions on downward correction", async () => {
  const storage = createInMemoryStorage({
    parseRuns: [],
    rawIncidents: [],
    reviewTasks: [],
    students: [seedStudent()],
    approvedIncidents: [seedApprovedIncident(12)],
    policies: [seedPolicy()]
  });

  await evaluatePolicyAndInterventions({
    storage,
    actorEmail: "admin@school.org"
  });

  await storage.approvedIncidents.upsert(seedApprovedIncident(-10));
  const summary = await evaluatePolicyAndInterventions({
    storage,
    actorEmail: "admin@school.org"
  });

  assert.equal(summary.closedInterventions >= 3, true);
  const interventions = await storage.interventions.list();
  const active = interventions.filter((item) => item.status !== "completed");
  assert.equal(active.length, 0);
});
