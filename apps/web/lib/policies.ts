import { randomUUID } from "node:crypto";

import type { AuditEvent, Intervention, ParseRun, Policy, Student } from "@syc/domain";
import type { StorageRepositories } from "@syc/storage";
import { z } from "zod";

import { listDisciplineEvents } from "@/lib/discipline-events";

export const policyInputSchema = z.object({
  baseThreshold: z.number().int().nonnegative(),
  warningOffsets: z.array(z.number().int()),
  milestones: z.array(z.number().int()),
  interventionTemplates: z
    .array(
      z.object({
        label: z.string().min(1),
        dueDays: z.number().int().positive().default(7),
        assignedTo: z.string().nullable().optional(),
        notesTemplate: z.string().default("")
      })
    )
    .default([])
});
export type PolicyInput = z.infer<typeof policyInputSchema>;

export interface ParsedTemplate {
  label: string;
  dueDays: number;
  assignedTo: string | null;
  notesTemplate: string;
}

interface TriggerLevel {
  label: string;
  threshold: number;
  delta: number;
  kind: "warning" | "milestone";
}

export interface StudentScore {
  student: Student;
  totalPoints: number;
}

export interface PolicyEvaluationSummary {
  policyVersion: number;
  studentsEvaluated: number;
  triggeredInterventions: number;
  reopenedInterventions: number;
  closedInterventions: number;
  overdueInterventions: number;
  warnings: string[];
  triggeredInterventionIds: string[];
}

export async function createPolicyVersion(input: {
  storage: StorageRepositories;
  actorEmail: string;
  payload: PolicyInput;
}): Promise<Policy> {
  const { storage, actorEmail, payload } = input;
  const latest = await storage.policies.getLatest();
  const version = (latest?.version ?? 0) + 1;
  const now = new Date().toISOString();
  const normalized = normalizePolicyInput(payload);

  const policy: Policy = {
    version,
    baseThreshold: normalized.baseThreshold,
    warningOffsets: normalized.warningOffsets,
    milestones: normalized.milestones,
    interventionTemplates: JSON.stringify(normalized.interventionTemplates),
    createdBy: actorEmail,
    createdAt: now
  };

  await storage.policies.upsert(policy);
  await storage.auditEvents.append(
    createAuditEvent({
      eventType: "policy_created",
      entityType: "policy",
      entityId: String(policy.version),
      actor: actorEmail,
      payload: policy
    })
  );
  return policy;
}

export async function evaluatePolicyAndInterventions(input: {
  storage: StorageRepositories;
  actorEmail: string;
  policyVersion?: number;
}): Promise<PolicyEvaluationSummary> {
  const { storage, actorEmail } = input;
  const policy =
    input.policyVersion !== undefined
      ? await storage.policies.getByVersion(input.policyVersion)
      : await storage.policies.getLatest();
  if (!policy) {
    throw new Error("No policy found. Create a policy before evaluation.");
  }

  const templates = parseInterventionTemplates(policy);
  const triggers = buildTriggerLevels(policy);
  const students = await storage.students.list();
  const disciplineEvents = await listDisciplineEvents(storage, undefined, { sourceType: "sycamore_api" });
  const interventions = await storage.interventions.list();
  const now = new Date();
  const nowIso = now.toISOString();

  const studentMap = new Map(students.map((student) => [student.id, student] as const));
  const scoreByStudent = new Map<string, number>();
  for (const event of disciplineEvents) {
    const studentId = event.localStudentId ?? event.studentId;
    const current = scoreByStudent.get(studentId) ?? 0;
    scoreByStudent.set(studentId, current + event.points);
    if (!studentMap.has(studentId)) {
      studentMap.set(studentId, {
        id: studentId,
        externalId: event.studentExternalId,
        fullName: event.studentName ?? studentId,
        grade: event.grade ?? "unknown",
        active: true,
        createdAt: nowIso,
        updatedAt: nowIso
      });
    }
  }

  const existingById = new Map(
    interventions
      .filter((intervention) => intervention.policyVersion === policy.version)
      .map((intervention) => [intervention.id, intervention] as const)
  );

  let triggeredInterventions = 0;
  let reopenedInterventions = 0;
  let closedInterventions = 0;
  let overdueInterventions = 0;
  const warnings: string[] = [];
  const triggeredInterventionIds: string[] = [];
  const candidateStudentIds = [...new Set([...studentMap.keys(), ...scoreByStudent.keys()])];

  for (const studentId of candidateStudentIds) {
    const student = studentMap.get(studentId);
    if (!student) {
      continue;
    }
    const totalPoints = scoreByStudent.get(studentId) ?? 0;

    for (const trigger of triggers) {
      const id = interventionId(student.id, policy.version, trigger.label);
      const existing = existingById.get(id);
      const isCrossed = totalPoints >= trigger.threshold;
      const template = templateForLabel(templates, trigger.label);

      if (isCrossed && !existing) {
        const intervention = createIntervention({
          id,
          studentId: student.id,
          policyVersion: policy.version,
          milestoneLabel: trigger.label,
          template,
          now
        });
        await storage.interventions.upsert(intervention);
        triggeredInterventions += 1;
        triggeredInterventionIds.push(intervention.id);
        await storage.auditEvents.append(
          createAuditEvent({
            eventType: "policy_trigger_created",
            entityType: "intervention",
            entityId: intervention.id,
            actor: actorEmail,
            payload: {
              studentId: student.id,
              triggerLabel: trigger.label,
              threshold: trigger.threshold,
              totalPoints
            }
          })
        );
        continue;
      }

      if (!existing) {
        continue;
      }

      const isActive = existing.status === "open" || existing.status === "in_progress" || existing.status === "overdue";
      if (!isCrossed && isActive) {
        const closed: Intervention = {
          ...existing,
          status: "completed",
          completedAt: nowIso,
          notes: appendNote(existing.notes, "auto_closed_after_downward_correction")
        };
        await storage.interventions.upsert(closed);
        closedInterventions += 1;
        await storage.auditEvents.append(
          createAuditEvent({
            eventType: "policy_trigger_closed_after_recompute",
            entityType: "intervention",
            entityId: closed.id,
            actor: actorEmail,
            payload: {
              studentId: student.id,
              triggerLabel: trigger.label,
              threshold: trigger.threshold,
              totalPoints
            }
          })
        );
        continue;
      }

      if (isCrossed && existing.status === "completed") {
        const reopened: Intervention = {
          ...existing,
          status: "open",
          completedAt: null,
          dueDate: dueDateFromTemplate(now, template.dueDays),
          notes: appendNote(existing.notes, "reopened_after_recrossing_threshold")
        };
        await storage.interventions.upsert(reopened);
        reopenedInterventions += 1;
        triggeredInterventionIds.push(reopened.id);
        await storage.auditEvents.append(
          createAuditEvent({
            eventType: "policy_trigger_reopened",
            entityType: "intervention",
            entityId: reopened.id,
            actor: actorEmail,
            payload: {
              studentId: student.id,
              triggerLabel: trigger.label,
              threshold: trigger.threshold,
              totalPoints
            }
          })
        );
        continue;
      }

      if (isCrossed && (existing.status === "open" || existing.status === "in_progress")) {
        const dueEpoch = Date.parse(existing.dueDate);
        if (!Number.isNaN(dueEpoch) && dueEpoch < now.getTime()) {
          const overdue: Intervention = {
            ...existing,
            status: "overdue"
          };
          await storage.interventions.upsert(overdue);
          overdueInterventions += 1;
        }
      }
    }
  }

  if (candidateStudentIds.length === 0) {
    warnings.push("no_students_or_incidents_found");
  }

  await storage.auditEvents.append(
    createAuditEvent({
      eventType: "policy_evaluated",
      entityType: "policy",
      entityId: String(policy.version),
      actor: actorEmail,
      payload: {
        studentsEvaluated: candidateStudentIds.length,
        triggeredInterventions,
        reopenedInterventions,
        closedInterventions,
        overdueInterventions
      }
    })
  );

  return {
    policyVersion: policy.version,
    studentsEvaluated: candidateStudentIds.length,
    triggeredInterventions,
    reopenedInterventions,
    closedInterventions,
    overdueInterventions,
    warnings,
    triggeredInterventionIds
  };
}

export async function buildStudentScores(storage: StorageRepositories): Promise<StudentScore[]> {
  const students = await storage.students.list();
  const disciplineEvents = await listDisciplineEvents(storage, undefined, { sourceType: "sycamore_api" });
  const scoreByStudent = new Map<string, number>();

  for (const event of disciplineEvents) {
    const studentId = event.localStudentId ?? event.studentId;
    scoreByStudent.set(studentId, (scoreByStudent.get(studentId) ?? 0) + event.points);
  }

  const rows: StudentScore[] = students.map((student) => ({
    student,
    totalPoints: scoreByStudent.get(student.id) ?? 0
  }));

  rows.sort((left, right) => right.totalPoints - left.totalPoints);
  return rows;
}

export function parseInterventionTemplates(policy: Policy): ParsedTemplate[] {
  const fallback = buildTriggerLevels(policy).map((trigger) => ({
    label: trigger.label,
    dueDays: trigger.kind === "warning" ? 3 : 7,
    assignedTo: null,
    notesTemplate: ""
  }));

  try {
    const parsed = JSON.parse(policy.interventionTemplates) as unknown;
    if (!Array.isArray(parsed)) {
      return fallback;
    }
    const templates = parsed
      .filter((item): item is ParsedTemplate => {
        return Boolean(
          item &&
            typeof item === "object" &&
            "label" in item &&
            typeof (item as { label: unknown }).label === "string"
        );
      })
      .map((item) => ({
        label: item.label,
        dueDays: Number.isFinite(item.dueDays) && item.dueDays > 0 ? Math.trunc(item.dueDays) : 7,
        assignedTo: item.assignedTo ?? null,
        notesTemplate: item.notesTemplate || ""
      }));

    return templates.length > 0 ? templates : fallback;
  } catch {
    return fallback;
  }
}

export function normalizePolicyInput(input: PolicyInput): PolicyInput {
  const warningOffsets = [...new Set(input.warningOffsets)].sort((a, b) => a - b);
  const milestones = [...new Set([0, ...input.milestones])].sort((a, b) => a - b);
  const templates = input.interventionTemplates.map((template) => ({
    ...template,
    label: template.label.trim(),
    notesTemplate: template.notesTemplate.trim(),
    assignedTo: template.assignedTo?.trim() || null
  }));

  return {
    baseThreshold: input.baseThreshold,
    warningOffsets,
    milestones,
    interventionTemplates: templates
  };
}

export function buildTriggerLevels(policy: Policy): TriggerLevel[] {
  const warningTriggers: TriggerLevel[] = policy.warningOffsets.map((offset) => ({
    label: offset < 0 ? `X${offset}` : `X+${offset}`,
    threshold: policy.baseThreshold + offset,
    delta: offset,
    kind: "warning"
  }));

  const milestoneTriggers: TriggerLevel[] = [...new Set([0, ...policy.milestones])].map((delta) => ({
    label: delta === 0 ? "X" : delta < 0 ? `X${delta}` : `X+${delta}`,
    threshold: policy.baseThreshold + delta,
    delta,
    kind: "milestone"
  }));

  const triggerMap = new Map<string, TriggerLevel>();
  for (const trigger of [...warningTriggers, ...milestoneTriggers]) {
    triggerMap.set(trigger.label, trigger);
  }

  return [...triggerMap.values()].sort((left, right) => left.threshold - right.threshold);
}

export function interventionId(studentId: string, policyVersion: number, milestoneLabel: string): string {
  return `int_${policyVersion}_${sanitizeId(studentId)}_${sanitizeId(milestoneLabel)}`;
}

function createIntervention(input: {
  id: string;
  studentId: string;
  policyVersion: number;
  milestoneLabel: string;
  template: ParsedTemplate;
  now: Date;
}): Intervention {
  return {
    id: input.id,
    studentId: input.studentId,
    policyVersion: input.policyVersion,
    milestoneLabel: input.milestoneLabel,
    status: "open",
    dueDate: dueDateFromTemplate(input.now, input.template.dueDays),
    completedAt: null,
    assignedTo: input.template.assignedTo,
    notes: input.template.notesTemplate
  };
}

function templateForLabel(templates: ParsedTemplate[], label: string): ParsedTemplate {
  const exact = templates.find((template) => template.label === label);
  if (exact) {
    return exact;
  }
  return {
    label,
    dueDays: label.startsWith("X-") ? 3 : 7,
    assignedTo: null,
    notesTemplate: ""
  };
}

function dueDateFromTemplate(now: Date, dueDays: number): string {
  const due = new Date(now);
  due.setDate(due.getDate() + dueDays);
  return due.toISOString();
}

function sanitizeId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function appendNote(existing: string, next: string): string {
  if (!existing.trim()) {
    return next;
  }
  return `${existing}\n${next}`;
}

function createAuditEvent(input: {
  eventType: string;
  entityType: string;
  entityId: string;
  actor: string;
  payload: unknown;
}): AuditEvent {
  return {
    id: randomUUID(),
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: input.entityId,
    actor: input.actor,
    payloadJson: JSON.stringify(input.payload),
    createdAt: new Date().toISOString()
  };
}

export function parseRunStatusSummary(parseRuns: ParseRun[]): Record<string, number> {
  const summary: Record<string, number> = {
    pending: 0,
    processing: 0,
    review_required: 0,
    completed: 0,
    failed: 0
  };
  for (const parseRun of parseRuns) {
    summary[parseRun.status] = (summary[parseRun.status] ?? 0) + 1;
  }
  return summary;
}
