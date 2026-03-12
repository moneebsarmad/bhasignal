import { randomUUID } from "node:crypto";

import type { AuditEvent, Notification } from "@syc/domain";
import type { StorageRepositories } from "@syc/storage";
import { z } from "zod";

const notificationConfigSchema = z.object({
  sendStaffEmails: z.boolean(),
  sendParentEmails: z.boolean(),
  staffRecipients: z.array(z.string().email()),
  parentRecipients: z.array(z.string().email()),
  subjectTemplate: z.string().min(1),
  bodyTemplate: z.string().min(1),
  maxAttempts: z.number().int().positive().max(10),
  provider: z.enum(["console"])
});
export type NotificationConfig = z.infer<typeof notificationConfigSchema>;

export interface NotificationQueueSummary {
  queued: number;
  skipped: number;
  warnings: string[];
}

export interface NotificationDispatchSummary {
  attempted: number;
  sent: number;
  failed: number;
  deadLettered: number;
  warnings: string[];
}

export interface ManualNotificationOverrideInput {
  studentId: string;
  interventionId: string;
  recipient: string;
  reason: string;
  subject: string;
  body: string;
}

const CONFIG_ENTITY_TYPE = "notification_config";
const CONFIG_ENTITY_ID = "active";
const DEFAULT_CONFIG: NotificationConfig = {
  sendStaffEmails: false,
  sendParentEmails: false,
  staffRecipients: [],
  parentRecipients: [],
  subjectTemplate: "",
  bodyTemplate: "",
  maxAttempts: 3,
  provider: "console"
};

export async function getNotificationConfig(storage: StorageRepositories): Promise<NotificationConfig> {
  const events = await storage.auditEvents.listByEntity(CONFIG_ENTITY_TYPE, CONFIG_ENTITY_ID);
  if (events.length === 0) {
    return DEFAULT_CONFIG;
  }
  const latest = events.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
  if (!latest) {
    return DEFAULT_CONFIG;
  }
  try {
    const parsedPayload = JSON.parse(latest.payloadJson) as { config?: unknown };
    return notificationConfigSchema.parse(parsedPayload.config ?? {});
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveNotificationConfig(input: {
  storage: StorageRepositories;
  actorEmail: string;
  payload: NotificationConfig;
}): Promise<NotificationConfig> {
  const normalized = notificationConfigSchema.parse(input.payload);
  await input.storage.auditEvents.append(
    createAuditEvent({
      eventType: "notification_config_saved",
      entityType: CONFIG_ENTITY_TYPE,
      entityId: CONFIG_ENTITY_ID,
      actor: input.actorEmail,
      payload: { config: normalized }
    })
  );
  return normalized;
}

export async function queueNotificationsForInterventions(input: {
  storage: StorageRepositories;
  actorEmail: string;
  interventionIds: string[];
}): Promise<NotificationQueueSummary> {
  const { storage, actorEmail } = input;
  const config = await getNotificationConfig(storage);
  const existing = await storage.notifications.list();
  const existingById = new Map(existing.map((notification) => [notification.id, notification] as const));
  const approvedIncidents = await storage.approvedIncidents.list();
  const studentHasApprovedIncident = new Set(approvedIncidents.map((incident) => incident.studentId));

  let queued = 0;
  let skipped = 0;
  const warnings: string[] = [];

  for (const interventionId of input.interventionIds) {
    const intervention = await storage.interventions.getById(interventionId);
    if (!intervention) {
      warnings.push(`intervention_not_found:${interventionId}`);
      continue;
    }

    const student = await storage.students.getById(intervention.studentId);
    const studentName = student?.fullName || intervention.studentId;
    const points = approvedIncidents
      .filter((incident) => incident.studentId === intervention.studentId)
      .reduce((sum, incident) => sum + incident.points, 0);

    const recipientPool = new Set<string>();
    if (config.sendStaffEmails) {
      for (const recipient of config.staffRecipients) {
        recipientPool.add(recipient.toLowerCase().trim());
      }
    }

    if (config.sendParentEmails) {
      const hasApprovedCriticalData = studentHasApprovedIncident.has(intervention.studentId);
      if (!hasApprovedCriticalData) {
        warnings.push(`parent_send_blocked_missing_approved_data:${intervention.id}`);
      } else {
        for (const recipient of config.parentRecipients) {
          recipientPool.add(recipient.toLowerCase().trim());
        }
      }
    }

    for (const recipient of recipientPool) {
      if (!recipient) {
        continue;
      }
      const notificationId = notificationIdFor(intervention.id, recipient, "email");
      const existingNotification = existingById.get(notificationId);
      if (existingNotification) {
        skipped += 1;
        continue;
      }

      const rendered = renderTemplate(config, {
        studentName,
        milestoneLabel: intervention.milestoneLabel,
        dueDate: intervention.dueDate,
        policyVersion: String(intervention.policyVersion),
        points: String(points)
      });

      const notification: Notification = {
        id: notificationId,
        studentId: intervention.studentId,
        interventionId: intervention.id,
        channel: "email",
        recipient,
        status: "queued",
        providerId: `idempotency:${notificationId}`,
        sentAt: null,
        error: JSON.stringify({
          attempts: 0,
          subject: rendered.subject,
          body: rendered.body
        })
      };
      await storage.notifications.upsert(notification);
      existingById.set(notification.id, notification);
      queued += 1;

      await storage.auditEvents.append(
        createAuditEvent({
          eventType: "notification_queued",
          entityType: "notification",
          entityId: notification.id,
          actor: actorEmail,
          payload: {
            recipient,
            interventionId: intervention.id,
            studentId: intervention.studentId
          }
        })
      );
    }
  }

  return {
    queued,
    skipped,
    warnings
  };
}

export async function dispatchNotificationQueue(input: {
  storage: StorageRepositories;
  actorEmail: string;
  limit?: number;
}): Promise<NotificationDispatchSummary> {
  const { storage, actorEmail } = input;
  const config = await getNotificationConfig(storage);
  const notifications = await storage.notifications.list();
  const candidates = notifications
    .filter((notification) => {
      if (notification.channel !== "email") {
        return false;
      }
      if (notification.status === "queued") {
        return true;
      }
      if (notification.status === "failed") {
        const attempts = getAttempts(notification);
        return attempts < config.maxAttempts;
      }
      return false;
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const limited = candidates.slice(0, input.limit ?? 50);

  let attempted = 0;
  let sent = 0;
  let failed = 0;
  let deadLettered = 0;
  const warnings: string[] = [];

  for (const notification of limited) {
    attempted += 1;
    const attempts = getAttempts(notification) + 1;
    try {
      const intervention = await storage.interventions.getById(notification.interventionId);
      const student = await storage.students.getById(notification.studentId);
      const points = (await storage.approvedIncidents.listByStudent(notification.studentId)).reduce(
        (sum, incident) => sum + incident.points,
        0
      );
      const rendered = renderFromNotificationMetadata(notification, config, {
        studentName: student?.fullName || notification.studentId,
        milestoneLabel: intervention?.milestoneLabel || "Unknown",
        dueDate: intervention?.dueDate || "",
        policyVersion: intervention ? String(intervention.policyVersion) : "",
        points: String(points)
      });

      const providerId = await sendEmail({
        provider: config.provider,
        recipient: notification.recipient,
        subject: rendered.subject,
        body: rendered.body
      });

      await storage.notifications.upsert({
        ...notification,
        status: "sent",
        providerId,
        sentAt: new Date().toISOString(),
        error: JSON.stringify({
          attempts,
          subject: rendered.subject,
          body: rendered.body
        })
      });
      sent += 1;
      await storage.auditEvents.append(
        createAuditEvent({
          eventType: "notification_sent",
          entityType: "notification",
          entityId: notification.id,
          actor: actorEmail,
          payload: { recipient: notification.recipient, providerId, attempts }
        })
      );
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "unknown_notification_error";
      const nextStatus = attempts >= config.maxAttempts ? "failed" : "failed";
      if (attempts >= config.maxAttempts) {
        deadLettered += 1;
      }
      await storage.notifications.upsert({
        ...notification,
        status: nextStatus,
        sentAt: null,
        error: JSON.stringify({
          attempts,
          lastError: message
        })
      });
      await storage.auditEvents.append(
        createAuditEvent({
          eventType:
            attempts >= config.maxAttempts ? "notification_dead_lettered" : "notification_send_failed",
          entityType: "notification",
          entityId: notification.id,
          actor: actorEmail,
          payload: {
            recipient: notification.recipient,
            attempts,
            error: message
          }
        })
      );
      warnings.push(`${notification.id}:${message}`);
    }
  }

  return {
    attempted,
    sent,
    failed,
    deadLettered,
    warnings
  };
}

export async function queueManualOverrideNotification(input: {
  storage: StorageRepositories;
  actorEmail: string;
  payload: ManualNotificationOverrideInput;
}): Promise<Notification> {
  const { storage, actorEmail } = input;
  const payload = {
    ...input.payload,
    studentId: input.payload.studentId.trim(),
    interventionId: input.payload.interventionId.trim(),
    recipient: input.payload.recipient.trim().toLowerCase(),
    reason: input.payload.reason.trim(),
    subject: input.payload.subject.trim(),
    body: input.payload.body.trim()
  };

  if (!payload.studentId || !payload.interventionId || !payload.recipient || !payload.reason) {
    throw new Error("Missing required override notification fields.");
  }

  const notificationId = notificationIdFor(
    `${payload.interventionId}:override:${payload.reason}`,
    payload.recipient,
    "email"
  );
  const existing = await storage.notifications.list();
  if (existing.some((item) => item.id === notificationId)) {
    throw new Error("Override notification already queued or sent for this key.");
  }

  const notification: Notification = {
    id: notificationId,
    studentId: payload.studentId,
    interventionId: payload.interventionId,
    channel: "email",
    recipient: payload.recipient,
    status: "queued",
    providerId: `idempotency:${notificationId}`,
    sentAt: null,
    error: JSON.stringify({
      attempts: 0,
      subject: payload.subject,
      body: payload.body,
      overrideReason: payload.reason
    })
  };
  await storage.notifications.upsert(notification);

  await storage.auditEvents.append(
    createAuditEvent({
      eventType: "notification_override_queued",
      entityType: "notification",
      entityId: notification.id,
      actor: actorEmail,
      payload: {
        studentId: payload.studentId,
        interventionId: payload.interventionId,
        recipient: payload.recipient,
        reason: payload.reason
      }
    })
  );

  return notification;
}

function notificationIdFor(interventionId: string, recipient: string, channel: string): string {
  const normalized = `${interventionId}|${recipient.trim().toLowerCase()}|${channel}`;
  return `notif_${djb2Hash(normalized)}`;
}

function djb2Hash(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function getAttempts(notification: Notification): number {
  try {
    const parsed = JSON.parse(notification.error || "{}") as { attempts?: unknown };
    if (typeof parsed.attempts === "number" && Number.isFinite(parsed.attempts)) {
      return Math.max(0, parsed.attempts);
    }
    return 0;
  } catch {
    return 0;
  }
}

function renderTemplate(
  config: NotificationConfig,
  vars: Record<string, string>
): { subject: string; body: string } {
  return {
    subject: replaceTokens(config.subjectTemplate, vars),
    body: replaceTokens(config.bodyTemplate, vars)
  };
}

function renderFromNotificationMetadata(
  notification: Notification,
  config: NotificationConfig,
  vars: Record<string, string>
): { subject: string; body: string } {
  try {
    const parsed = JSON.parse(notification.error || "{}") as { subject?: string; body?: string };
    if (parsed.subject && parsed.body) {
      return { subject: parsed.subject, body: parsed.body };
    }
  } catch {
    // fall through
  }
  return renderTemplate(config, vars);
}

function replaceTokens(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

async function sendEmail(input: {
  provider: NotificationConfig["provider"];
  recipient: string;
  subject: string;
  body: string;
}): Promise<string> {
  if (input.recipient.includes("fail@")) {
    throw new Error("Simulated provider failure for recipient.");
  }

  if (input.provider === "console") {
    console.log("Notification send", {
      to: redactEmail(input.recipient),
      subject: input.subject.slice(0, 80),
      bodyPreview: input.body.slice(0, 120)
    });
    return `console:${Date.now()}`;
  }

  throw new Error(`Unsupported notification provider: ${input.provider}`);
}

export function parseNotificationConfig(input: unknown): NotificationConfig {
  return notificationConfigSchema.parse(input);
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

function redactEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) {
    return "***";
  }
  const head = local.slice(0, 1);
  return `${head}***@${domain}`;
}
