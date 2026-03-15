import { randomUUID } from "node:crypto";

import type { AuditEvent, GuardianContact, Notification } from "@syc/domain";
import type { StorageRepositories } from "@syc/storage";
import { z } from "zod";

import { type DisciplineEventRecord, listDisciplineEvents } from "@/lib/discipline-events";
import { getDemeritEscalationBand } from "@/lib/demerit-escalation";

const notificationConfigSchema = z.object({
  sendStaffEmails: z.boolean(),
  sendParentEmails: z.boolean(),
  staffRecipients: z.array(z.string().email()),
  parentRecipients: z.array(z.string().email()),
  subjectTemplate: z.string().min(1),
  bodyTemplate: z.string().min(1),
  maxAttempts: z.number().int().positive().max(10),
  provider: z.enum(["console", "resend"])
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

export interface ParentOutreachQueueRow {
  id: string;
  studentId: string;
  studentName: string;
  grade: string;
  totalPoints: number;
  bandId: string | null;
  bandLabel: string;
  recipient: string;
  guardianName: string | null;
  relationship: string | null;
  interventionId: string;
  milestoneLabel: string;
  dueDate: string;
  latestIncidentAt: string | null;
  status: Notification["status"];
  draftSubject: string;
  draftBody: string;
  approvedBy: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  suppressedReason: string | null;
  recipientSource: string;
}

export interface ManualNotificationOverrideInput {
  studentId: string;
  interventionId: string;
  recipient: string;
  reason: string;
  subject: string;
  body: string;
}

interface NotificationMetadata {
  attempts: number;
  lastError?: string;
  recipientSource?: string;
  subject?: string;
  body?: string;
  overrideReason?: string;
}

const CONFIG_ENTITY_TYPE = "notification_config";
const CONFIG_ENTITY_ID = "active";
const PARENT_OUTREACH_BAND_ID = "points_10_19";
const PARENT_OUTREACH_TEMPLATE_KEY = "parent_outreach_10_19";
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

function notificationKind(notification: Notification): NonNullable<Notification["kind"]> {
  return notification.kind ?? "policy";
}

function notificationMetadata(notification: Notification): NotificationMetadata {
  const sources = [notification.metadataJson, notification.error];
  for (const source of sources) {
    if (!source?.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(source) as NotificationMetadata;
      return {
        attempts:
          typeof parsed.attempts === "number" && Number.isFinite(parsed.attempts)
            ? Math.max(0, parsed.attempts)
            : 0,
        lastError: parsed.lastError,
        recipientSource: parsed.recipientSource,
        subject: parsed.subject,
        body: parsed.body,
        overrideReason: parsed.overrideReason
      };
    } catch {
      // Ignore and continue to the next source.
    }
  }
  return { attempts: 0 };
}

function serializeMetadata(metadata: NotificationMetadata): string {
  return JSON.stringify({
    attempts: metadata.attempts,
    ...(metadata.lastError ? { lastError: metadata.lastError } : {}),
    ...(metadata.recipientSource ? { recipientSource: metadata.recipientSource } : {}),
    ...(metadata.subject ? { subject: metadata.subject } : {}),
    ...(metadata.body ? { body: metadata.body } : {}),
    ...(metadata.overrideReason ? { overrideReason: metadata.overrideReason } : {})
  });
}

function notificationAttempts(notification: Notification): number {
  return notificationMetadata(notification).attempts;
}

function renderedDraft(notification: Notification): { subject: string; body: string } {
  const metadata = notificationMetadata(notification);
  return {
    subject: notification.draftSubject ?? metadata.subject ?? "",
    body: notification.draftBody ?? metadata.body ?? ""
  };
}

function normalizeRecipient(recipient: string): string {
  return recipient.trim().toLowerCase();
}

function notificationIdFor(interventionId: string, recipient: string, channel: string): string {
  const normalized = `${interventionId}|${normalizeRecipient(recipient)}|${channel}`;
  return `notif_${djb2Hash(normalized)}`;
}

function djb2Hash(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function replaceTokens(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
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

function redactEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) {
    return "***";
  }
  return `${local.slice(0, 1)}***@${domain}`;
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

function eventStudentId(event: DisciplineEventRecord): string {
  return event.localStudentId ?? event.studentId;
}

function eventTimestamp(event: DisciplineEventRecord): string | null {
  return event.occurredAt ?? event.incidentDate;
}

function latestIncidentAtByStudent(events: DisciplineEventRecord[]): Map<string, string | null> {
  const latest = new Map<string, string | null>();
  for (const event of events) {
    const studentId = eventStudentId(event);
    const occurredAt = eventTimestamp(event);
    if (!occurredAt) {
      continue;
    }
    const current = latest.get(studentId) ?? null;
    if (!current || Date.parse(occurredAt) > Date.parse(current)) {
      latest.set(studentId, occurredAt);
    }
  }
  return latest;
}

function pointsByStudent(events: DisciplineEventRecord[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const event of events) {
    const studentId = eventStudentId(event);
    totals.set(studentId, (totals.get(studentId) ?? 0) + event.points);
  }
  return totals;
}

function eligibleGuardianContacts(contacts: GuardianContact[]): GuardianContact[] {
  return contacts
    .filter((contact) => contact.isActive && contact.allowEmail && Boolean(contact.email))
    .sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) {
        return left.isPrimary ? -1 : 1;
      }
      return (left.guardianName ?? "").localeCompare(right.guardianName ?? "");
    });
}

function templateVars(input: {
  studentName: string;
  milestoneLabel: string;
  dueDate: string;
  policyVersion: string;
  points: number;
  bandLabel: string;
  grade: string;
  latestIncidentAt: string;
}): Record<string, string> {
  return {
    studentName: input.studentName,
    milestoneLabel: input.milestoneLabel,
    dueDate: input.dueDate,
    policyVersion: input.policyVersion,
    points: String(input.points),
    bandLabel: input.bandLabel,
    grade: input.grade,
    latestIncidentDate: input.latestIncidentAt
  };
}

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
  const [existingNotifications, disciplineEvents, students, allContacts] = await Promise.all([
    storage.notifications.list(),
    listDisciplineEvents(storage, undefined, { sourceType: "sycamore_api" }),
    storage.students.list(),
    storage.guardianContacts.list()
  ]);

  const pointsMap = pointsByStudent(disciplineEvents);
  const latestIncidentMap = latestIncidentAtByStudent(disciplineEvents);
  const studentMap = new Map(students.map((student) => [student.id, student] as const));
  const contactsByStudent = new Map<string, GuardianContact[]>();
  for (const contact of allContacts) {
    const entries = contactsByStudent.get(contact.studentId) ?? [];
    entries.push(contact);
    contactsByStudent.set(contact.studentId, entries);
  }

  const existingById = new Map(existingNotifications.map((notification) => [notification.id, notification] as const));
  const syncedStudentIds = new Set(disciplineEvents.map((event) => eventStudentId(event)));

  let queued = 0;
  let skipped = 0;
  const warnings: string[] = [];

  for (const interventionId of input.interventionIds) {
    const intervention = await storage.interventions.getById(interventionId);
    if (!intervention) {
      warnings.push(`intervention_not_found:${interventionId}`);
      continue;
    }

    const student = studentMap.get(intervention.studentId);
    const studentName = student?.fullName || intervention.studentId;
    const grade = student?.grade || "unknown";
    const totalPoints = pointsMap.get(intervention.studentId) ?? 0;
    const band = getDemeritEscalationBand(totalPoints);
    const latestIncidentAt = latestIncidentMap.get(intervention.studentId) ?? "";
    const vars = templateVars({
      studentName,
      milestoneLabel: intervention.milestoneLabel,
      dueDate: intervention.dueDate,
      policyVersion: String(intervention.policyVersion),
      points: totalPoints,
      bandLabel: band.label,
      grade,
      latestIncidentAt
    });

    if (config.sendStaffEmails) {
      for (const recipient of config.staffRecipients.map(normalizeRecipient).filter(Boolean)) {
        const notificationId = notificationIdFor(intervention.id, recipient, "email");
        if (existingById.has(notificationId)) {
          skipped += 1;
          continue;
        }

        const rendered = renderTemplate(config, vars);
        const notification: Notification = {
          id: notificationId,
          studentId: intervention.studentId,
          interventionId: intervention.id,
          channel: "email",
          recipient,
          status: "queued",
          providerId: `idempotency:${notificationId}`,
          sentAt: null,
          error: "",
          kind: "policy",
          draftSubject: rendered.subject,
          draftBody: rendered.body,
          metadataJson: serializeMetadata({
            attempts: 0,
            recipientSource: "staff_configured"
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
              studentId: intervention.studentId,
              kind: notification.kind
            }
          })
        );
      }
    }

    if (!config.sendParentEmails || band.id !== PARENT_OUTREACH_BAND_ID) {
      continue;
    }

    if (!syncedStudentIds.has(intervention.studentId)) {
      warnings.push(`parent_send_blocked_missing_sycamore_data:${intervention.id}`);
      continue;
    }

    const eligibleContacts = eligibleGuardianContacts(contactsByStudent.get(intervention.studentId) ?? []);
    const parentRecipients =
      eligibleContacts.length > 0
        ? eligibleContacts.map((contact) => ({
            recipient: contact.email ?? "",
            guardianContactId: contact.id,
            guardianName: contact.guardianName ?? null,
            relationship: contact.relationship ?? null,
            recipientSource: contact.sourceType
          }))
        : config.parentRecipients.map((recipient) => ({
            recipient: normalizeRecipient(recipient),
            guardianContactId: null,
            guardianName: null,
            relationship: null,
            recipientSource: "configured_parent_fallback"
          }));

    if (parentRecipients.length === 0) {
      warnings.push(`parent_contact_missing:${intervention.studentId}`);
      continue;
    }

    const rendered = renderTemplate(config, vars);
    for (const parentRecipient of parentRecipients) {
      if (!parentRecipient.recipient) {
        continue;
      }

      const draftId = notificationIdFor(
        `${intervention.id}:parent_outreach:${PARENT_OUTREACH_BAND_ID}`,
        parentRecipient.recipient,
        "email"
      );
      if (existingById.has(draftId)) {
        skipped += 1;
        continue;
      }

      const notification: Notification = {
        id: draftId,
        studentId: intervention.studentId,
        interventionId: intervention.id,
        channel: "email",
        recipient: parentRecipient.recipient,
        status: "draft",
        providerId: `idempotency:${draftId}`,
        sentAt: null,
        error: "",
        kind: "parent_outreach",
        bandId: PARENT_OUTREACH_BAND_ID,
        templateKey: PARENT_OUTREACH_TEMPLATE_KEY,
        draftSubject: rendered.subject,
        draftBody: rendered.body,
        guardianContactId: parentRecipient.guardianContactId,
        metadataJson: serializeMetadata({
          attempts: 0,
          recipientSource: parentRecipient.recipientSource
        })
      };
      await storage.notifications.upsert(notification);
      existingById.set(notification.id, notification);
      queued += 1;

      await storage.auditEvents.append(
        createAuditEvent({
          eventType: "parent_outreach_draft_created",
          entityType: "notification",
          entityId: notification.id,
          actor: actorEmail,
          payload: {
            recipient: notification.recipient,
            interventionId: intervention.id,
            studentId: intervention.studentId,
            bandId: notification.bandId,
            guardianContactId: notification.guardianContactId
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

export async function listParentOutreachQueue(
  storage: StorageRepositories
): Promise<ParentOutreachQueueRow[]> {
  const [notifications, students, interventions, disciplineEvents, guardianContacts] = await Promise.all([
    storage.notifications.list(),
    storage.students.list(),
    storage.interventions.list(),
    listDisciplineEvents(storage, undefined, { sourceType: "sycamore_api" }),
    storage.guardianContacts.list()
  ]);

  const studentMap = new Map(students.map((student) => [student.id, student] as const));
  const interventionMap = new Map(interventions.map((intervention) => [intervention.id, intervention] as const));
  const guardianContactMap = new Map(guardianContacts.map((contact) => [contact.id, contact] as const));
  const pointsMap = pointsByStudent(disciplineEvents);
  const latestIncidentMap = latestIncidentAtByStudent(disciplineEvents);

  const statusPriority: Record<Notification["status"], number> = {
    draft: 0,
    approved: 1,
    queued: 2,
    failed: 3,
    sent: 4,
    suppressed: 5
  };

  return notifications
    .filter((notification) => notificationKind(notification) === "parent_outreach")
    .map((notification) => {
      const student = studentMap.get(notification.studentId);
      const intervention = interventionMap.get(notification.interventionId);
      const contact = notification.guardianContactId
        ? guardianContactMap.get(notification.guardianContactId) ?? null
        : null;
      const band = getDemeritEscalationBand(pointsMap.get(notification.studentId) ?? 0);
      const draft = renderedDraft(notification);
      return {
        id: notification.id,
        studentId: notification.studentId,
        studentName: student?.fullName || notification.studentId,
        grade: student?.grade || "unknown",
        totalPoints: pointsMap.get(notification.studentId) ?? 0,
        bandId: notification.bandId ?? null,
        bandLabel: band.label,
        recipient: notification.recipient,
        guardianName: contact?.guardianName ?? null,
        relationship: contact?.relationship ?? null,
        interventionId: notification.interventionId,
        milestoneLabel: intervention?.milestoneLabel || "Unknown",
        dueDate: intervention?.dueDate || "",
        latestIncidentAt: latestIncidentMap.get(notification.studentId) ?? null,
        status: notification.status,
        draftSubject: draft.subject,
        draftBody: draft.body,
        approvedBy: notification.approvedBy ?? null,
        approvedAt: notification.approvedAt ?? null,
        sentAt: notification.sentAt ?? null,
        suppressedReason: notification.suppressedReason ?? null,
        recipientSource: notificationMetadata(notification).recipientSource ?? "unknown"
      } satisfies ParentOutreachQueueRow;
    })
    .sort((left, right) => {
      if (statusPriority[left.status] !== statusPriority[right.status]) {
        return statusPriority[left.status] - statusPriority[right.status];
      }
      if (right.totalPoints !== left.totalPoints) {
        return right.totalPoints - left.totalPoints;
      }
      return left.studentName.localeCompare(right.studentName);
    });
}

export async function approveParentOutreachNotifications(input: {
  storage: StorageRepositories;
  actorEmail: string;
  notificationIds: string[];
}): Promise<{ approved: number; warnings: string[] }> {
  const notifications = await input.storage.notifications.list();
  const notificationsById = new Map(notifications.map((notification) => [notification.id, notification] as const));
  const nowIso = new Date().toISOString();
  let approved = 0;
  const warnings: string[] = [];

  for (const notificationId of input.notificationIds) {
    const notification = notificationsById.get(notificationId);
    if (!notification || notificationKind(notification) !== "parent_outreach") {
      warnings.push(`parent_outreach_not_found:${notificationId}`);
      continue;
    }
    if (notification.status === "suppressed" || notification.status === "sent") {
      warnings.push(`parent_outreach_not_editable:${notificationId}`);
      continue;
    }

    const next: Notification = {
      ...notification,
      status: "approved",
      approvedBy: input.actorEmail,
      approvedAt: nowIso,
      suppressedAt: null,
      suppressedReason: null
    };
    await input.storage.notifications.upsert(next);
    approved += 1;

    await input.storage.auditEvents.append(
      createAuditEvent({
        eventType: "parent_outreach_approved",
        entityType: "notification",
        entityId: notification.id,
        actor: input.actorEmail,
        payload: {
          studentId: notification.studentId,
          interventionId: notification.interventionId
        }
      })
    );
  }

  return { approved, warnings };
}

export async function suppressParentOutreachNotifications(input: {
  storage: StorageRepositories;
  actorEmail: string;
  notificationIds: string[];
  reason: string;
}): Promise<{ suppressed: number; warnings: string[] }> {
  const notifications = await input.storage.notifications.list();
  const notificationsById = new Map(notifications.map((notification) => [notification.id, notification] as const));
  const nowIso = new Date().toISOString();
  let suppressed = 0;
  const warnings: string[] = [];

  for (const notificationId of input.notificationIds) {
    const notification = notificationsById.get(notificationId);
    if (!notification || notificationKind(notification) !== "parent_outreach") {
      warnings.push(`parent_outreach_not_found:${notificationId}`);
      continue;
    }

    const next: Notification = {
      ...notification,
      status: "suppressed",
      suppressedAt: nowIso,
      suppressedReason: input.reason.trim()
    };
    await input.storage.notifications.upsert(next);
    suppressed += 1;

    await input.storage.auditEvents.append(
      createAuditEvent({
        eventType: "parent_outreach_suppressed",
        entityType: "notification",
        entityId: notification.id,
        actor: input.actorEmail,
        payload: {
          studentId: notification.studentId,
          reason: input.reason.trim()
        }
      })
    );
  }

  return { suppressed, warnings };
}

export async function updateParentOutreachDraft(input: {
  storage: StorageRepositories;
  actorEmail: string;
  notificationId: string;
  subject: string;
  body: string;
}): Promise<Notification> {
  const notification = (await input.storage.notifications.list()).find((item) => item.id === input.notificationId) ?? null;
  if (!notification || notificationKind(notification) !== "parent_outreach") {
    throw new Error("Parent outreach draft not found.");
  }
  if (notification.status === "sent" || notification.status === "suppressed") {
    throw new Error("Parent outreach draft can no longer be edited.");
  }

  const next: Notification = {
    ...notification,
    draftSubject: input.subject.trim(),
    draftBody: input.body.trim()
  };
  await input.storage.notifications.upsert(next);
  await input.storage.auditEvents.append(
    createAuditEvent({
      eventType: "parent_outreach_draft_updated",
      entityType: "notification",
      entityId: next.id,
      actor: input.actorEmail,
      payload: {
        studentId: next.studentId,
        interventionId: next.interventionId
      }
    })
  );
  return next;
}

export async function dispatchNotificationQueue(input: {
  storage: StorageRepositories;
  actorEmail: string;
  limit?: number;
}): Promise<NotificationDispatchSummary> {
  const { storage, actorEmail } = input;
  const [config, notifications, students, interventions, disciplineEvents] = await Promise.all([
    getNotificationConfig(storage),
    storage.notifications.list(),
    storage.students.list(),
    storage.interventions.list(),
    listDisciplineEvents(storage, undefined, { sourceType: "sycamore_api" })
  ]);

  const studentMap = new Map(students.map((student) => [student.id, student] as const));
  const interventionMap = new Map(interventions.map((intervention) => [intervention.id, intervention] as const));
  const pointsMap = pointsByStudent(disciplineEvents);

  const candidates = notifications
    .filter((notification) => {
      if (notification.channel !== "email") {
        return false;
      }
      if (notificationKind(notification) === "parent_outreach") {
        if (notification.status === "approved") {
          return true;
        }
        if (notification.status === "failed") {
          return notificationAttempts(notification) < config.maxAttempts;
        }
        return false;
      }
      if (notification.status === "queued") {
        return true;
      }
      if (notification.status === "failed") {
        return notificationAttempts(notification) < config.maxAttempts;
      }
      return false;
    })
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, input.limit ?? 50);

  let attempted = 0;
  let sent = 0;
  let failed = 0;
  let deadLettered = 0;
  const warnings: string[] = [];

  for (const notification of candidates) {
    attempted += 1;
    const attempts = notificationAttempts(notification) + 1;
    try {
      const intervention = interventionMap.get(notification.interventionId);
      const student = studentMap.get(notification.studentId);
      const totalPoints = pointsMap.get(notification.studentId) ?? 0;
      const band = getDemeritEscalationBand(totalPoints);
      const rendered = renderedDraft(notification);
      const draft = rendered.subject && rendered.body
        ? rendered
        : renderTemplate(config, templateVars({
            studentName: student?.fullName || notification.studentId,
            milestoneLabel: intervention?.milestoneLabel || "Unknown",
            dueDate: intervention?.dueDate || "",
            policyVersion: intervention ? String(intervention.policyVersion) : "",
            points: totalPoints,
            bandLabel: band.label,
            grade: student?.grade || "unknown",
            latestIncidentAt: ""
          }));

      const providerId = await sendEmail({
        provider: config.provider,
        recipient: notification.recipient,
        subject: draft.subject,
        body: draft.body
      });

      await storage.notifications.upsert({
        ...notification,
        status: "sent",
        providerId,
        sentAt: new Date().toISOString(),
        draftSubject: draft.subject,
        draftBody: draft.body,
        error: "",
        metadataJson: serializeMetadata({
          attempts,
          recipientSource: notificationMetadata(notification).recipientSource
        })
      });
      sent += 1;
      await storage.auditEvents.append(
        createAuditEvent({
          eventType: "notification_sent",
          entityType: "notification",
          entityId: notification.id,
          actor: actorEmail,
          payload: {
            recipient: notification.recipient,
            providerId,
            attempts,
            kind: notificationKind(notification)
          }
        })
      );
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "unknown_notification_error";
      if (attempts >= config.maxAttempts) {
        deadLettered += 1;
      }
      await storage.notifications.upsert({
        ...notification,
        status: "failed",
        sentAt: null,
        error: message,
        metadataJson: serializeMetadata({
          attempts,
          recipientSource: notificationMetadata(notification).recipientSource,
          subject: renderedDraft(notification).subject || notification.draftSubject || undefined,
          body: renderedDraft(notification).body || notification.draftBody || undefined,
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
            error: message,
            kind: notificationKind(notification)
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
  const payload = {
    ...input.payload,
    studentId: input.payload.studentId.trim(),
    interventionId: input.payload.interventionId.trim(),
    recipient: normalizeRecipient(input.payload.recipient),
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
  const existing = await input.storage.notifications.list();
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
    error: "",
    kind: "manual_override",
    draftSubject: payload.subject,
    draftBody: payload.body,
    metadataJson: serializeMetadata({
      attempts: 0,
      recipientSource: "manual_override",
      overrideReason: payload.reason
    })
  };
  await input.storage.notifications.upsert(notification);

  await input.storage.auditEvents.append(
    createAuditEvent({
      eventType: "notification_override_queued",
      entityType: "notification",
      entityId: notification.id,
      actor: input.actorEmail,
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

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.NOTIFICATION_FROM_EMAIL?.trim();
  const replyTo = process.env.NOTIFICATION_REPLY_TO?.trim();
  if (!apiKey || !from) {
    throw new Error("Resend provider requires RESEND_API_KEY and NOTIFICATION_FROM_EMAIL.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [input.recipient],
      subject: input.subject,
      text: input.body,
      ...(replyTo ? { reply_to: replyTo } : {})
    })
  });

  const body = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
  if (!response.ok) {
    throw new Error(body?.message || `Resend request failed with ${response.status}`);
  }

  return `resend:${body?.id ?? Date.now()}`;
}

export function parseNotificationConfig(input: unknown): NotificationConfig {
  return notificationConfigSchema.parse(input);
}
