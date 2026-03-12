import { z } from "zod";

export type UUID = string;

export const parseRunStatuses = [
  "pending",
  "processing",
  "review_required",
  "completed",
  "failed"
] as const;
export type ParseRunStatus = (typeof parseRunStatuses)[number];

export const reviewTaskStatuses = [
  "open",
  "approved",
  "rejected",
  "edited"
] as const;
export type ReviewTaskStatus = (typeof reviewTaskStatuses)[number];

export const interventionStatuses = [
  "open",
  "in_progress",
  "completed",
  "overdue"
] as const;
export type InterventionStatus = (typeof interventionStatuses)[number];

export const notificationStatuses = [
  "queued",
  "sent",
  "failed"
] as const;
export type NotificationStatus = (typeof notificationStatuses)[number];

export const ingestionSourceTypes = ["manual_pdf", "sycamore_api"] as const;
export type IngestionSourceType = (typeof ingestionSourceTypes)[number];

const uuidSchema = z.string().min(1);
const isoDateSchema = z.string().min(1);
const nullableStringSchema = z.string().nullable().optional();
const nullableIntegerSchema = z.number().int().nullable().optional();

export const studentSchema = z.object({
  id: uuidSchema,
  externalId: z.string().nullable(),
  fullName: z.string().min(1),
  grade: z.string().min(1),
  active: z.boolean(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});
export type Student = z.infer<typeof studentSchema>;

export const rawIncidentSchema = z.object({
  id: uuidSchema,
  parseRunId: uuidSchema,
  sourceType: z.enum(ingestionSourceTypes),
  sourceRecordId: z.string().min(1),
  // Raw parser output may be incomplete; reviewers can fill missing fields before approval.
  studentReference: z.string(),
  externalStudentId: z.string().nullable(),
  gradeAtEvent: z.string().nullable(),
  eventType: z.string().nullable(),
  occurredAt: z.string(),
  writeupDate: nullableStringSchema,
  points: z.number(),
  reason: z.string(),
  violation: nullableStringSchema,
  violationRaw: nullableStringSchema,
  level: nullableIntegerSchema,
  comment: z.string(),
  description: nullableStringSchema,
  resolution: nullableStringSchema,
  teacherName: z.string(),
  authorName: nullableStringSchema,
  authorNameRaw: nullableStringSchema,
  sourcePayloadJson: z.string(),
  mappingWarningsJson: z.string(),
  confidenceJson: z.string(),
  status: z.enum(["pending_review", "approved", "rejected"])
});
export type RawIncident = z.infer<typeof rawIncidentSchema>;

export const approvedIncidentSchema = z.object({
  id: uuidSchema,
  studentId: uuidSchema,
  sourceType: z.enum(ingestionSourceTypes),
  sourceRecordId: z.string().min(1),
  externalStudentId: z.string().nullable(),
  gradeAtEvent: z.string().nullable(),
  eventType: z.string().nullable(),
  occurredAt: isoDateSchema,
  writeupDate: nullableStringSchema,
  points: z.number(),
  reason: z.string().min(1),
  violation: nullableStringSchema,
  violationRaw: nullableStringSchema,
  level: nullableIntegerSchema,
  comment: z.string(),
  description: nullableStringSchema,
  resolution: nullableStringSchema,
  teacherName: z.string(),
  authorName: nullableStringSchema,
  authorNameRaw: nullableStringSchema,
  sourceJobId: uuidSchema,
  fingerprint: z.string().min(1),
  reviewedBy: z.string().min(1),
  reviewedAt: isoDateSchema
});
export type ApprovedIncident = z.infer<typeof approvedIncidentSchema>;

export const parseRunSchema = z.object({
  id: uuidSchema,
  sourceType: z.enum(ingestionSourceTypes),
  fileName: z.string().min(1),
  uploadedBy: z.string().min(1),
  triggeredBy: z.string().min(1),
  metadataJson: z.string(),
  cursorJson: z.string().nullable(),
  status: z.enum(parseRunStatuses),
  rowsExtracted: z.number().int().nonnegative(),
  rowsFlagged: z.number().int().nonnegative(),
  startedAt: isoDateSchema,
  completedAt: z.string().nullable()
});
export type ParseRun = z.infer<typeof parseRunSchema>;

export const reviewTaskSchema = z.object({
  id: uuidSchema,
  parseRunId: uuidSchema,
  rawIncidentId: uuidSchema,
  assignee: z.string().nullable(),
  status: z.enum(reviewTaskStatuses),
  resolution: z.string(),
  createdAt: isoDateSchema,
  resolvedAt: z.string().nullable()
});
export type ReviewTask = z.infer<typeof reviewTaskSchema>;

export const policySchema = z.object({
  version: z.number().int().positive(),
  baseThreshold: z.number().int().nonnegative(),
  warningOffsets: z.array(z.number().int()),
  milestones: z.array(z.number().int()),
  interventionTemplates: z.string(),
  createdBy: z.string().min(1),
  createdAt: isoDateSchema
});
export type Policy = z.infer<typeof policySchema>;

export const interventionSchema = z.object({
  id: uuidSchema,
  studentId: uuidSchema,
  policyVersion: z.number().int().positive(),
  milestoneLabel: z.string().min(1),
  status: z.enum(interventionStatuses),
  dueDate: isoDateSchema,
  completedAt: z.string().nullable(),
  assignedTo: z.string().nullable(),
  notes: z.string()
});
export type Intervention = z.infer<typeof interventionSchema>;

export const notificationSchema = z.object({
  id: uuidSchema,
  studentId: uuidSchema,
  interventionId: uuidSchema,
  channel: z.enum(["email", "sms"]),
  recipient: z.string().min(1),
  status: z.enum(notificationStatuses),
  providerId: z.string(),
  sentAt: z.string().nullable(),
  error: z.string()
});
export type Notification = z.infer<typeof notificationSchema>;

export const auditEventSchema = z.object({
  id: uuidSchema,
  eventType: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  actor: z.string().min(1),
  payloadJson: z.string(),
  createdAt: isoDateSchema
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const domainSchemas = {
  student: studentSchema,
  rawIncident: rawIncidentSchema,
  approvedIncident: approvedIncidentSchema,
  parseRun: parseRunSchema,
  reviewTask: reviewTaskSchema,
  policy: policySchema,
  intervention: interventionSchema,
  notification: notificationSchema,
  auditEvent: auditEventSchema
};

export function parseStudent(input: unknown): Student {
  return studentSchema.parse(input);
}

export function parseApprovedIncident(input: unknown): ApprovedIncident {
  return approvedIncidentSchema.parse(input);
}

export interface IncidentFingerprintInput {
  sourceType?: IngestionSourceType;
  sourceRecordId?: string;
  studentReference: string;
  occurredAt: string;
  points: number;
  reason: string;
  comment: string;
  teacherName: string;
  sourceJobId: string;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function djb2Hash(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

export function createIncidentFingerprint(input: IncidentFingerprintInput): string {
  if (input.sourceType === "sycamore_api" && input.sourceRecordId?.trim()) {
    return `inc_${djb2Hash(
      [input.sourceType, normalizeToken(input.sourceRecordId)].join("|")
    )}`;
  }

  const normalized = [
    normalizeToken(input.studentReference),
    normalizeToken(input.occurredAt),
    String(input.points),
    normalizeToken(input.reason),
    normalizeToken(input.comment),
    normalizeToken(input.teacherName),
    normalizeToken(input.sourceJobId)
  ].join("|");
  return `inc_${djb2Hash(normalized)}`;
}
