import { randomUUID } from "node:crypto";

import type { AuditEvent, Intervention } from "@syc/domain";
import type { StorageRepositories } from "@syc/storage";
import { z } from "zod";

export const interventionStatusUpdateSchema = z.object({
  status: z.enum(["open", "in_progress", "completed", "overdue"]),
  notes: z.string().optional(),
  assignee: z.string().nullable().optional()
});
export type InterventionStatusUpdateInput = z.infer<typeof interventionStatusUpdateSchema>;

const allowedStatusTransitions: Record<Intervention["status"], Intervention["status"][]> = {
  open: ["in_progress", "completed", "overdue"],
  in_progress: ["open", "completed", "overdue"],
  overdue: ["in_progress", "completed"],
  completed: []
};

function canTransition(from: Intervention["status"], to: Intervention["status"]): boolean {
  if (from === to) {
    return true;
  }
  return allowedStatusTransitions[from].includes(to);
}

export async function updateInterventionStatus(input: {
  storage: StorageRepositories;
  interventionId: string;
  actorEmail: string;
  payload: InterventionStatusUpdateInput;
}): Promise<Intervention> {
  const intervention = await input.storage.interventions.getById(input.interventionId);
  if (!intervention) {
    throw new Error("Intervention not found.");
  }
  if (!canTransition(intervention.status, input.payload.status)) {
    throw new Error(`Invalid intervention transition: ${intervention.status} -> ${input.payload.status}`);
  }

  const next: Intervention = {
    ...intervention,
    status: input.payload.status,
    completedAt:
      input.payload.status === "completed"
        ? new Date().toISOString()
        : intervention.completedAt && intervention.status === "completed"
          ? null
          : intervention.completedAt,
    assignedTo: input.payload.assignee ?? intervention.assignedTo,
    notes: input.payload.notes ? `${intervention.notes}\n${input.payload.notes}`.trim() : intervention.notes
  };
  await input.storage.interventions.upsert(next);

  const event: AuditEvent = {
    id: randomUUID(),
    eventType: "intervention_status_updated",
    entityType: "intervention",
    entityId: intervention.id,
    actor: input.actorEmail,
    payloadJson: JSON.stringify({
      previousStatus: intervention.status,
      nextStatus: next.status,
      assignee: next.assignedTo,
      notesAdded: input.payload.notes ?? ""
    }),
    createdAt: new Date().toISOString()
  };
  await input.storage.auditEvents.append(event);

  return next;
}
