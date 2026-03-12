import { randomUUID } from "node:crypto";

import { createIncidentFingerprint } from "@syc/domain";
import type {
  ApprovedIncident,
  AuditEvent,
  IngestionSourceType,
  ParseRun,
  RawIncident,
  ReviewTask
} from "@syc/domain";
import type { StorageRepositories } from "@syc/storage";
import { z } from "zod";

import type { NotificationQueueSummary } from "@/lib/notifications";
import { queueNotificationsForInterventions } from "@/lib/notifications";
import type { PolicyEvaluationSummary } from "@/lib/policies";
import { evaluatePolicyAndInterventions } from "@/lib/policies";
import { findOrCreateStudent, stableStudentId } from "@/lib/student-identity";

export const reviewActionSchema = z.object({
  action: z.enum(["approve", "edit_approve", "reject"]),
  reason: z.string().optional(),
  edits: z
    .object({
      studentReference: z.string().min(1).optional(),
      occurredAt: z.string().min(1).optional(),
      writeupDate: z.string().min(1).optional(),
      points: z.number().int().optional(),
      reason: z.string().min(1).optional(),
      violation: z.string().min(1).optional(),
      violationRaw: z.string().min(1).optional(),
      level: z.number().int().optional(),
      comment: z.string().optional(),
      description: z.string().optional(),
      resolution: z.string().optional(),
      teacherName: z.string().optional(),
      authorName: z.string().optional(),
      authorNameRaw: z.string().optional()
    })
    .optional()
});
export type ReviewActionInput = z.infer<typeof reviewActionSchema>;

export const bulkReviewActionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  taskIds: z.array(z.string().min(1)).min(1),
  reason: z.string().optional()
});
export type BulkReviewActionInput = z.infer<typeof bulkReviewActionSchema>;

export type ConfidenceBand = "low" | "medium" | "high" | "unknown";

export interface ReviewQueueFilters {
  status?: ReviewTask["status"] | "all";
  parseRunId?: string;
  assignee?: string;
  confidence?: ConfidenceBand | "all";
  sourceType?: IngestionSourceType | "all";
}

export interface ReviewQueueItem {
  task: ReviewTask;
  rawIncident: RawIncident;
  parseRun: ParseRun | null;
  recordConfidence: number | null;
  confidenceBand: ConfidenceBand;
  parseWarnings: string[];
  sourceSnippet: string;
}

export interface ApprovalAutomationSummary {
  policyEvaluation: PolicyEvaluationSummary | null;
  notificationQueue: NotificationQueueSummary | null;
  warnings: string[];
}

export interface BulkReviewActionItemResult {
  taskId: string;
  status: "processed" | "skipped";
  task?: ReviewTask;
  rawIncident?: RawIncident;
  approvedIncident?: ApprovedIncident;
  error?: string;
}

export interface BulkReviewActionResult {
  batchId: string;
  action: BulkReviewActionInput["action"];
  processedCount: number;
  skippedCount: number;
  results: BulkReviewActionItemResult[];
  automation?: ApprovalAutomationSummary;
}

interface ParsedConfidencePayload {
  recordConfidence: number | null;
  warnings: string[];
  sourceSnippet: string;
}

export function confidenceBand(score: number | null): ConfidenceBand {
  if (score === null || !Number.isFinite(score)) {
    return "unknown";
  }
  if (score < 0.75) {
    return "low";
  }
  if (score < 0.9) {
    return "medium";
  }
  return "high";
}

export async function listReviewQueue(
  storage: StorageRepositories,
  filters: ReviewQueueFilters
): Promise<ReviewQueueItem[]> {
  const statusFilter = filters.status && filters.status !== "all" ? filters.status : null;
  const confidenceFilter =
    filters.confidence && filters.confidence !== "all" ? filters.confidence : null;
  const parseRunFilter = filters.parseRunId?.trim() || null;
  const assigneeFilter = filters.assignee?.trim() || null;
  const sourceTypeFilter = filters.sourceType && filters.sourceType !== "all" ? filters.sourceType : null;

  const tasks = parseRunFilter
    ? await storage.reviewTasks.listByParseRun(parseRunFilter)
    : statusFilter
      ? await storage.reviewTasks.listByStatus(statusFilter)
      : await storage.reviewTasks.listByStatus("open");

  const filteredTasks = tasks.filter((task) => {
    if (statusFilter && task.status !== statusFilter) {
      return false;
    }
    if (assigneeFilter && task.assignee !== assigneeFilter) {
      return false;
    }
    return true;
  });

  const parseRunCache = new Map<string, ParseRun | null>();
  const queueItems: ReviewQueueItem[] = [];

  for (const task of filteredTasks) {
    const rawIncident = await storage.rawIncidents.getById(task.rawIncidentId);
    if (!rawIncident) {
      continue;
    }
    if (sourceTypeFilter && rawIncident.sourceType !== sourceTypeFilter) {
      continue;
    }

    if (!parseRunCache.has(task.parseRunId)) {
      const run = await storage.parseRuns.getById(task.parseRunId);
      parseRunCache.set(task.parseRunId, run);
    }
    const parseRun = parseRunCache.get(task.parseRunId) ?? null;

    const parsed = parseConfidencePayload(rawIncident.confidenceJson);
    const band = confidenceBand(parsed.recordConfidence);
    if (confidenceFilter && band !== confidenceFilter) {
      continue;
    }

    queueItems.push({
      task,
      rawIncident,
      parseRun,
      recordConfidence: parsed.recordConfidence,
      confidenceBand: band,
      parseWarnings: parsed.warnings,
      sourceSnippet: parsed.sourceSnippet
    });
  }

  return queueItems.sort((left, right) => Date.parse(left.task.createdAt) - Date.parse(right.task.createdAt));
}

export async function applyReviewAction(input: {
  storage: StorageRepositories;
  taskId: string;
  actorEmail: string;
  action: ReviewActionInput["action"];
  reason?: string;
  edits?: ReviewActionInput["edits"];
}): Promise<{
  task: ReviewTask;
  rawIncident: RawIncident;
  approvedIncident?: ApprovedIncident;
  automation?: ApprovalAutomationSummary;
}> {
  return resolveReviewTaskAction(input);
}

export async function applyBulkReviewAction(input: {
  storage: StorageRepositories;
  taskIds: string[];
  actorEmail: string;
  action: BulkReviewActionInput["action"];
  reason?: string;
}): Promise<BulkReviewActionResult> {
  const batchId = randomUUID();
  const uniqueTaskIds = [...new Set(input.taskIds.map((taskId) => taskId.trim()).filter(Boolean))];
  const results: BulkReviewActionItemResult[] = [];
  const approvedIncidentIds: string[] = [];

  for (const taskId of uniqueTaskIds) {
    try {
      const result = await resolveReviewTaskAction({
        storage: input.storage,
        taskId,
        actorEmail: input.actorEmail,
        action: input.action,
        reason: input.reason,
        skipAutomation: true
      });

      results.push({
        taskId,
        status: "processed",
        task: result.task,
        rawIncident: result.rawIncident,
        approvedIncident: result.approvedIncident
      });

      if (result.approvedIncident) {
        approvedIncidentIds.push(result.approvedIncident.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown review action failure.";
      results.push({
        taskId,
        status: "skipped",
        error: message
      });
    }
  }

  let automation: ApprovalAutomationSummary | undefined;
  if (input.action === "approve" && approvedIncidentIds.length > 0) {
    automation = await runBatchApprovalAutomation({
      storage: input.storage,
      actorEmail: input.actorEmail,
      batchId,
      approvedIncidentIds,
      taskIds: results
        .filter((result): result is BulkReviewActionItemResult & { status: "processed" } => result.status === "processed")
        .map((result) => result.taskId)
    });
  }

  await input.storage.auditEvents.append(
    createAuditEvent({
      eventType: "review_batch_resolved",
      entityType: "review_batch",
      entityId: batchId,
      actor: input.actorEmail,
      payload: {
        action: input.action,
        reason: input.reason ?? "",
        processedCount: results.filter((result) => result.status === "processed").length,
        skippedCount: results.filter((result) => result.status === "skipped").length,
        taskIds: uniqueTaskIds,
        automation: automation ?? null,
        results: results.map((result) => ({
          taskId: result.taskId,
          status: result.status,
          error: result.error ?? null,
          approvedIncidentId: result.approvedIncident?.id ?? null
        }))
      }
    })
  );

  return {
    batchId,
    action: input.action,
    processedCount: results.filter((result) => result.status === "processed").length,
    skippedCount: results.filter((result) => result.status === "skipped").length,
    results,
    automation
  };
}

async function resolveReviewTaskAction(input: {
  storage: StorageRepositories;
  taskId: string;
  actorEmail: string;
  action: ReviewActionInput["action"];
  reason?: string;
  edits?: ReviewActionInput["edits"];
  skipAutomation?: boolean;
}): Promise<{
  task: ReviewTask;
  rawIncident: RawIncident;
  approvedIncident?: ApprovedIncident;
  automation?: ApprovalAutomationSummary;
}> {
  const { storage, taskId, actorEmail, action, reason, edits } = input;
  const task = await storage.reviewTasks.getById(taskId);
  if (!task) {
    throw new Error("Review task not found.");
  }
  if (task.status !== "open") {
    throw new Error("Review task is already resolved.");
  }

  const rawIncident = await storage.rawIncidents.getById(task.rawIncidentId);
  if (!rawIncident) {
    throw new Error("Raw incident for review task not found.");
  }

  const now = new Date().toISOString();
  let updatedRaw: RawIncident = rawIncident;
  let updatedTask: ReviewTask = {
    ...task,
    assignee: actorEmail,
    resolvedAt: now
  };
  let approvedIncident: ApprovedIncident | undefined;
  let automation: ApprovalAutomationSummary | undefined;

  if (action === "reject") {
    updatedRaw = {
      ...rawIncident,
      status: "rejected",
      confidenceJson: mergeReviewMetadata(rawIncident.confidenceJson, {
        action,
        actor: actorEmail,
        reason: reason ?? ""
      })
    };
    updatedTask = {
      ...updatedTask,
      status: "rejected",
      resolution: reason ?? "rejected_by_reviewer"
    };
  } else {
    const candidateRaw = applyEdits(rawIncident, edits);
    const student = await findOrCreateStudent(
      storage,
      candidateRaw.studentReference,
      candidateRaw.externalStudentId,
      candidateRaw.gradeAtEvent,
      now
    );
    const existingApprovedIncident = await findExistingApprovedIncident(storage, candidateRaw);
    const fingerprint = createIncidentFingerprint({
      sourceType: candidateRaw.sourceType,
      sourceRecordId: candidateRaw.sourceRecordId,
      studentReference: candidateRaw.studentReference,
      occurredAt: candidateRaw.occurredAt,
      points: candidateRaw.points,
      reason: candidateRaw.reason,
      comment: candidateRaw.comment,
      teacherName: candidateRaw.teacherName,
      sourceJobId: candidateRaw.parseRunId
    });

    approvedIncident = {
      id: existingApprovedIncident?.id ?? `${candidateRaw.parseRunId}:approved:${candidateRaw.id}`,
      studentId: student.id,
      sourceType: candidateRaw.sourceType,
      sourceRecordId: candidateRaw.sourceRecordId,
      externalStudentId: candidateRaw.externalStudentId,
      gradeAtEvent: candidateRaw.gradeAtEvent,
      eventType: candidateRaw.eventType,
      occurredAt: candidateRaw.occurredAt,
      writeupDate: candidateRaw.writeupDate ?? null,
      points: candidateRaw.points,
      reason: candidateRaw.reason,
      violation: candidateRaw.violation ?? candidateRaw.reason,
      violationRaw: candidateRaw.violationRaw ?? candidateRaw.reason,
      level: candidateRaw.level ?? null,
      comment: candidateRaw.comment,
      description: candidateRaw.description ?? candidateRaw.comment,
      resolution: candidateRaw.resolution ?? null,
      teacherName: candidateRaw.teacherName,
      authorName: candidateRaw.authorName ?? candidateRaw.teacherName,
      authorNameRaw: candidateRaw.authorNameRaw ?? candidateRaw.teacherName,
      sourceJobId: candidateRaw.parseRunId,
      fingerprint,
      reviewedBy: actorEmail,
      reviewedAt: now
    };

    await storage.approvedIncidents.upsert(approvedIncident);

    updatedRaw = {
      ...candidateRaw,
      status: "approved",
      confidenceJson: mergeReviewMetadata(candidateRaw.confidenceJson, {
        action,
        actor: actorEmail,
        reason: reason ?? "",
        edits: edits ?? {}
      })
    };
    updatedTask = {
      ...updatedTask,
      status: action === "edit_approve" ? "edited" : "approved",
      resolution: reason ?? (action === "edit_approve" ? "edited_and_approved" : "approved")
    };
  }

  await storage.rawIncidents.upsert(updatedRaw);
  await storage.reviewTasks.upsert(updatedTask);
  await maybeCloseParseRun(storage, task.parseRunId, now);
  await storage.auditEvents.append(
    createAuditEvent({
      eventType: "review_task_resolved",
      entityType: "review_task",
      entityId: task.id,
      actor: actorEmail,
      payload: {
        action,
        reason: reason ?? "",
        rawIncidentId: rawIncident.id,
        parseRunId: rawIncident.parseRunId,
        edits: edits ?? {}
      }
    })
  );

  if (approvedIncident && !input.skipAutomation) {
    automation = await runApprovalAutomation({
      storage,
      actorEmail,
      taskId: task.id,
      approvedIncident
    });
  }

  return {
    task: updatedTask,
    rawIncident: updatedRaw,
    approvedIncident,
    automation
  };
}

async function findExistingApprovedIncident(
  storage: StorageRepositories,
  rawIncident: RawIncident
): Promise<ApprovedIncident | null> {
  if (rawIncident.sourceType === "sycamore_api") {
    const approvedIncidents = await storage.approvedIncidents.list();
    const bySourceRecord = approvedIncidents.find(
      (incident) =>
        incident.sourceType === rawIncident.sourceType &&
        incident.sourceRecordId === rawIncident.sourceRecordId
    );
    if (bySourceRecord) {
      return bySourceRecord;
    }
  }

  const fingerprint = createIncidentFingerprint({
    sourceType: rawIncident.sourceType,
    sourceRecordId: rawIncident.sourceRecordId,
    studentReference: rawIncident.studentReference,
    occurredAt: rawIncident.occurredAt,
    points: rawIncident.points,
    reason: rawIncident.reason,
    comment: rawIncident.comment,
    teacherName: rawIncident.teacherName,
    sourceJobId: rawIncident.parseRunId
  });
  return storage.approvedIncidents.getByFingerprint(fingerprint);
}

function parseConfidencePayload(confidenceJson: string): ParsedConfidencePayload {
  try {
    const parsed = JSON.parse(confidenceJson) as {
      recordConfidence?: number;
      warnings?: unknown;
      sourceSnippet?: string;
    };
    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((warning): warning is string => typeof warning === "string")
      : [];
    return {
      recordConfidence: typeof parsed.recordConfidence === "number" ? parsed.recordConfidence : null,
      warnings,
      sourceSnippet: typeof parsed.sourceSnippet === "string" ? parsed.sourceSnippet : ""
    };
  } catch {
    return {
      recordConfidence: null,
      warnings: [],
      sourceSnippet: ""
    };
  }
}

function applyEdits(rawIncident: RawIncident, edits: ReviewActionInput["edits"]): RawIncident {
  if (!edits) {
    return rawIncident;
  }
  return {
    ...rawIncident,
    studentReference: edits.studentReference?.trim() || rawIncident.studentReference,
    occurredAt: edits.occurredAt?.trim() || rawIncident.occurredAt,
    writeupDate: normalizeWriteupDateEdit(
      edits.writeupDate?.trim() || edits.occurredAt?.trim() || rawIncident.writeupDate || rawIncident.occurredAt
    ),
    points: edits.points ?? rawIncident.points,
    reason: edits.reason?.trim() || edits.violation?.trim() || rawIncident.reason,
    violation: edits.violation?.trim() || edits.reason?.trim() || rawIncident.violation || rawIncident.reason,
    violationRaw:
      edits.violationRaw?.trim() ||
      edits.violation?.trim() ||
      edits.reason?.trim() ||
      rawIncident.violationRaw ||
      rawIncident.reason,
    level: edits.level ?? rawIncident.level ?? null,
    comment: edits.comment?.trim() || edits.description?.trim() || rawIncident.comment,
    description: edits.description?.trim() || edits.comment?.trim() || rawIncident.description || rawIncident.comment,
    resolution:
      typeof edits.resolution === "string" ? edits.resolution.trim() || null : rawIncident.resolution ?? null,
    teacherName: edits.teacherName?.trim() || edits.authorName?.trim() || rawIncident.teacherName,
    authorName: edits.authorName?.trim() || edits.teacherName?.trim() || rawIncident.authorName || rawIncident.teacherName,
    authorNameRaw:
      edits.authorNameRaw?.trim() ||
      edits.authorName?.trim() ||
      edits.teacherName?.trim() ||
      rawIncident.authorNameRaw ||
      rawIncident.teacherName
  };
}

function normalizeWriteupDateEdit(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function mergeReviewMetadata(confidenceJson: string, reviewPayload: unknown): string {
  let parsed: Record<string, unknown> = {};
  try {
    const initial = JSON.parse(confidenceJson) as Record<string, unknown>;
    parsed = initial && typeof initial === "object" ? initial : {};
  } catch {
    parsed = {};
  }

  return JSON.stringify({
    ...parsed,
    review: reviewPayload
  });
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }
  return !["0", "false", "off", "no"].includes(raw.trim().toLowerCase());
}

async function runApprovalAutomation(input: {
  storage: StorageRepositories;
  actorEmail: string;
  taskId: string;
  approvedIncident: ApprovedIncident;
}): Promise<ApprovalAutomationSummary> {
  return runApprovalAutomationForApprovedIncidents({
    storage: input.storage,
    actorEmail: input.actorEmail,
    entityType: "review_task",
    entityId: input.taskId,
    approvedIncidentIds: [input.approvedIncident.id]
  });
}

async function runBatchApprovalAutomation(input: {
  storage: StorageRepositories;
  actorEmail: string;
  batchId: string;
  approvedIncidentIds: string[];
  taskIds: string[];
}): Promise<ApprovalAutomationSummary> {
  return runApprovalAutomationForApprovedIncidents({
    storage: input.storage,
    actorEmail: input.actorEmail,
    entityType: "review_batch",
    entityId: input.batchId,
    approvedIncidentIds: input.approvedIncidentIds,
    taskIds: input.taskIds
  });
}

async function runApprovalAutomationForApprovedIncidents(input: {
  storage: StorageRepositories;
  actorEmail: string;
  entityType: string;
  entityId: string;
  approvedIncidentIds: string[];
  taskIds?: string[];
}): Promise<ApprovalAutomationSummary> {
  const warnings: string[] = [];
  const policyExists = await input.storage.policies.getLatest();
  if (!policyExists) {
    warnings.push("policy_missing");
    return {
      policyEvaluation: null,
      notificationQueue: null,
      warnings
    };
  }

  const shouldEvaluatePolicy = envFlag("AUTO_POLICY_EVALUATION_ON_APPROVAL", true);
  const shouldQueueNotifications = envFlag("AUTO_NOTIFICATION_QUEUE_ON_APPROVAL", true);

  let policyEvaluation: PolicyEvaluationSummary | null = null;
  let notificationQueue: NotificationQueueSummary | null = null;

  try {
    if (shouldEvaluatePolicy) {
      policyEvaluation = await evaluatePolicyAndInterventions({
        storage: input.storage,
        actorEmail: input.actorEmail,
        policyVersion: policyExists.version
      });
    }

    if (
      shouldQueueNotifications &&
      policyEvaluation &&
      policyEvaluation.triggeredInterventionIds.length > 0
    ) {
      notificationQueue = await queueNotificationsForInterventions({
        storage: input.storage,
        actorEmail: input.actorEmail,
        interventionIds: policyEvaluation.triggeredInterventionIds
      });
    }

    await input.storage.auditEvents.append(
      createAuditEvent({
        eventType: "review_approval_automation_completed",
        entityType: input.entityType,
        entityId: input.entityId,
        actor: input.actorEmail,
        payload: {
          approvedIncidentIds: input.approvedIncidentIds,
          taskIds: input.taskIds ?? [],
          policyEvaluation,
          notificationQueue,
          warnings
        }
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_review_automation_failure";
    warnings.push(message);
    await input.storage.auditEvents.append(
      createAuditEvent({
        eventType: "review_approval_automation_failed",
        entityType: input.entityType,
        entityId: input.entityId,
        actor: input.actorEmail,
        payload: {
          approvedIncidentIds: input.approvedIncidentIds,
          taskIds: input.taskIds ?? [],
          error: message
        }
      })
    );
  }

  return {
    policyEvaluation,
    notificationQueue,
    warnings
  };
}

async function maybeCloseParseRun(
  storage: StorageRepositories,
  parseRunId: string,
  nowIso: string
): Promise<void> {
  const run = await storage.parseRuns.getById(parseRunId);
  if (!run) {
    return;
  }
  const tasks = await storage.reviewTasks.listByParseRun(parseRunId);
  const openCount = tasks.filter((task) => task.status === "open").length;
  if (openCount > 0) {
    return;
  }

  if (run.status === "review_required" || run.status === "processing" || run.status === "pending") {
    await storage.parseRuns.upsert({
      ...run,
      status: "completed",
      completedAt: run.completedAt || nowIso
    });
  }
}

export { stableStudentId };

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
