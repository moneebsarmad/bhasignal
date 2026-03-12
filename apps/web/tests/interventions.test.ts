import assert from "node:assert/strict";
import test from "node:test";

import type { Intervention } from "@syc/domain";

import { updateInterventionStatus } from "../lib/interventions";
import { createInMemoryStorage } from "./review-actions.test";

function seedIntervention(status: Intervention["status"] = "open"): Intervention {
  return {
    id: "int_1",
    studentId: "stu_1",
    policyVersion: 1,
    milestoneLabel: "X",
    status,
    dueDate: "2026-02-20T00:00:00.000Z",
    completedAt: null,
    assignedTo: "Dean",
    notes: "Initial intervention"
  };
}

test("updateInterventionStatus allows valid transition and appends audit event", async () => {
  const storage = createInMemoryStorage({
    parseRuns: [],
    rawIncidents: [],
    reviewTasks: [],
    interventions: [seedIntervention("open")]
  });

  const updated = await updateInterventionStatus({
    storage,
    interventionId: "int_1",
    actorEmail: "admin@school.org",
    payload: {
      status: "in_progress",
      notes: "Assigned to advisor",
      assignee: "Advisor"
    }
  });

  assert.equal(updated.status, "in_progress");
  assert.equal(updated.assignedTo, "Advisor");
  assert.match(updated.notes, /Assigned to advisor/);

  const events = await storage.auditEvents.listByEntity("intervention", "int_1");
  assert.equal(events.some((event) => event.eventType === "intervention_status_updated"), true);
});

test("updateInterventionStatus rejects invalid transition", async () => {
  const storage = createInMemoryStorage({
    parseRuns: [],
    rawIncidents: [],
    reviewTasks: [],
    interventions: [seedIntervention("completed")]
  });

  await assert.rejects(
    async () =>
      updateInterventionStatus({
        storage,
        interventionId: "int_1",
        actorEmail: "admin@school.org",
        payload: {
          status: "open"
        }
      }),
    /Invalid intervention transition/
  );
});
