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
import { domainSchemas } from "@syc/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ApprovedIncidentRepository,
  AuditEventRepository,
  GuardianContactRepository,
  InterventionRepository,
  NotificationRepository,
  ParseRunRepository,
  PolicyRepository,
  RawIncidentRepository,
  ReviewTaskRepository,
  StorageRepositories,
  StudentRepository
} from "./contracts";

type RowRecord = Record<string, unknown>;

interface TableDefinition<T> {
  table: string;
  primaryKey: string;
  parseRow: (row: RowRecord) => T;
  serialize: (value: T) => RowRecord;
}

function cell(row: RowRecord, key: string): string {
  const value = row[key];
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function nullableCell(row: RowRecord, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function boolCell(row: RowRecord, key: string): boolean {
  const value = row[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    return value === "1" || value.toLowerCase() === "true";
  }
  return false;
}

function numberCell(row: RowRecord, key: string): number {
  const value = row[key];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function nullableNumberCell(row: RowRecord, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function numberArrayCell(row: RowRecord, key: string): number[] {
  const value = row[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

function toSupabaseErrorMessage(table: string, action: string, error: { message: string }): string {
  return `Supabase ${action} failed for table "${table}": ${error.message}`;
}

class SupabaseEntityStore<T> {
  constructor(
    private readonly client: SupabaseClient,
    private readonly definition: TableDefinition<T>
  ) {}

  private parseRows(rows: RowRecord[] | null): T[] {
    if (!rows) {
      return [];
    }
    return rows.map((row) => this.definition.parseRow(row));
  }

  async ensureTable(): Promise<void> {
    const { error } = await this.client.from(this.definition.table).select("*").limit(1);
    if (error) {
      throw new Error(
        `${toSupabaseErrorMessage(this.definition.table, "schema check", error)}. Apply the SQL in supabase/schema.sql first.`
      );
    }
  }

  async list(): Promise<T[]> {
    const { data, error } = await this.client.from(this.definition.table).select("*");
    if (error) {
      throw new Error(toSupabaseErrorMessage(this.definition.table, "select", error));
    }
    return this.parseRows((data as RowRecord[] | null) ?? []);
  }

  async upsert(value: T): Promise<void> {
    const { error } = await this.client
      .from(this.definition.table)
      .upsert(this.definition.serialize(value), { onConflict: this.definition.primaryKey });
    if (error) {
      throw new Error(toSupabaseErrorMessage(this.definition.table, "upsert", error));
    }
  }

  async append(value: T): Promise<void> {
    const { error } = await this.client.from(this.definition.table).insert(this.definition.serialize(value));
    if (error) {
      throw new Error(toSupabaseErrorMessage(this.definition.table, "insert", error));
    }
  }

  async getByColumn(column: string, value: string | number): Promise<T | null> {
    const { data, error } = await this.client
      .from(this.definition.table)
      .select("*")
      .eq(column, value)
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new Error(toSupabaseErrorMessage(this.definition.table, `lookup by ${column}`, error));
    }
    if (!data) {
      return null;
    }
    return this.definition.parseRow(data as RowRecord);
  }

  async filterByColumn(column: string, value: string | number): Promise<T[]> {
    const { data, error } = await this.client.from(this.definition.table).select("*").eq(column, value);
    if (error) {
      throw new Error(toSupabaseErrorMessage(this.definition.table, `filter by ${column}`, error));
    }
    return this.parseRows((data as RowRecord[] | null) ?? []);
  }
}

function createDefinitions() {
  const students: TableDefinition<Student> = {
    table: "students",
    primaryKey: "id",
    parseRow: (row) =>
      domainSchemas.student.parse({
        id: cell(row, "id"),
        externalId: nullableCell(row, "external_id"),
        fullName: cell(row, "full_name"),
        grade: cell(row, "grade"),
        active: boolCell(row, "active"),
        createdAt: cell(row, "created_at"),
        updatedAt: cell(row, "updated_at")
      }),
    serialize: (value) => ({
      id: value.id,
      external_id: value.externalId,
      full_name: value.fullName,
      grade: value.grade,
      active: value.active,
      created_at: value.createdAt,
      updated_at: value.updatedAt
    })
  };

  const guardianContacts: TableDefinition<GuardianContact> = {
    table: "guardian_contacts",
    primaryKey: "id",
    parseRow: (row) =>
      domainSchemas.guardianContact.parse({
        id: cell(row, "id"),
        studentId: cell(row, "student_id"),
        guardianName: nullableCell(row, "guardian_name"),
        relationship: nullableCell(row, "relationship"),
        email: nullableCell(row, "email"),
        phone: nullableCell(row, "phone"),
        isPrimary: boolCell(row, "is_primary"),
        allowEmail: boolCell(row, "allow_email"),
        sourceType: cell(row, "source_type") || "manual",
        sourceRecordId: nullableCell(row, "source_record_id"),
        lastSyncedAt: nullableCell(row, "last_synced_at"),
        isActive: boolCell(row, "is_active"),
        notes: cell(row, "notes")
      }),
    serialize: (value) => ({
      id: value.id,
      student_id: value.studentId,
      guardian_name: value.guardianName,
      relationship: value.relationship,
      email: value.email,
      phone: value.phone,
      is_primary: value.isPrimary,
      allow_email: value.allowEmail,
      source_type: value.sourceType,
      source_record_id: value.sourceRecordId,
      last_synced_at: value.lastSyncedAt,
      is_active: value.isActive,
      notes: value.notes
    })
  };

  const rawIncidents: TableDefinition<RawIncident> = {
    table: "incidents_raw",
    primaryKey: "id",
    parseRow: (row) =>
      domainSchemas.rawIncident.parse({
        id: cell(row, "id"),
        parseRunId: cell(row, "parse_run_id"),
        sourceType: (cell(row, "source_type") || "manual_pdf") as RawIncident["sourceType"],
        sourceRecordId: cell(row, "source_record_id") || cell(row, "id"),
        studentReference: cell(row, "student_reference"),
        externalStudentId: nullableCell(row, "external_student_id"),
        gradeAtEvent: nullableCell(row, "grade_at_event"),
        eventType: nullableCell(row, "event_type"),
        occurredAt: cell(row, "occurred_at"),
        writeupDate: nullableCell(row, "writeup_date"),
        points: numberCell(row, "points"),
        reason: cell(row, "reason"),
        violation: nullableCell(row, "violation"),
        violationRaw: nullableCell(row, "violation_raw"),
        level: nullableNumberCell(row, "level"),
        comment: cell(row, "comment"),
        description: nullableCell(row, "description"),
        resolution: nullableCell(row, "resolution"),
        teacherName: cell(row, "teacher_name"),
        authorName: nullableCell(row, "author_name"),
        authorNameRaw: nullableCell(row, "author_name_raw"),
        sourcePayloadJson: cell(row, "source_payload_json") || "{}",
        mappingWarningsJson: cell(row, "mapping_warnings_json") || "[]",
        confidenceJson: cell(row, "confidence_json"),
        status: cell(row, "status")
      }),
    serialize: (value) => ({
      id: value.id,
      parse_run_id: value.parseRunId,
      source_type: value.sourceType,
      source_record_id: value.sourceRecordId,
      student_reference: value.studentReference,
      external_student_id: value.externalStudentId,
      grade_at_event: value.gradeAtEvent,
      event_type: value.eventType,
      occurred_at: value.occurredAt,
      writeup_date: value.writeupDate ?? null,
      points: value.points,
      reason: value.reason,
      violation: value.violation ?? null,
      violation_raw: value.violationRaw ?? null,
      level: value.level ?? null,
      comment: value.comment,
      description: value.description ?? null,
      resolution: value.resolution ?? null,
      teacher_name: value.teacherName,
      author_name: value.authorName ?? null,
      author_name_raw: value.authorNameRaw ?? null,
      source_payload_json: value.sourcePayloadJson,
      mapping_warnings_json: value.mappingWarningsJson,
      confidence_json: value.confidenceJson,
      status: value.status
    })
  };

  const approvedIncidents: TableDefinition<ApprovedIncident> = {
    table: "incidents_approved",
    primaryKey: "id",
    parseRow: (row) =>
      domainSchemas.approvedIncident.parse({
        id: cell(row, "id"),
        studentId: cell(row, "student_id"),
        sourceType: (cell(row, "source_type") || "manual_pdf") as ApprovedIncident["sourceType"],
        sourceRecordId: cell(row, "source_record_id") || cell(row, "id"),
        externalStudentId: nullableCell(row, "external_student_id"),
        gradeAtEvent: nullableCell(row, "grade_at_event"),
        eventType: nullableCell(row, "event_type"),
        occurredAt: cell(row, "occurred_at"),
        writeupDate: nullableCell(row, "writeup_date"),
        points: numberCell(row, "points"),
        reason: cell(row, "reason"),
        violation: nullableCell(row, "violation"),
        violationRaw: nullableCell(row, "violation_raw"),
        level: nullableNumberCell(row, "level"),
        comment: cell(row, "comment"),
        description: nullableCell(row, "description"),
        resolution: nullableCell(row, "resolution"),
        teacherName: cell(row, "teacher_name"),
        authorName: nullableCell(row, "author_name"),
        authorNameRaw: nullableCell(row, "author_name_raw"),
        sourceJobId: cell(row, "source_job_id"),
        fingerprint: cell(row, "fingerprint"),
        reviewedBy: cell(row, "reviewed_by"),
        reviewedAt: cell(row, "reviewed_at")
      }),
    serialize: (value) => ({
      id: value.id,
      student_id: value.studentId,
      source_type: value.sourceType,
      source_record_id: value.sourceRecordId,
      external_student_id: value.externalStudentId,
      grade_at_event: value.gradeAtEvent,
      event_type: value.eventType,
      occurred_at: value.occurredAt,
      writeup_date: value.writeupDate ?? null,
      points: value.points,
      reason: value.reason,
      violation: value.violation ?? null,
      violation_raw: value.violationRaw ?? null,
      level: value.level ?? null,
      comment: value.comment,
      description: value.description ?? null,
      resolution: value.resolution ?? null,
      teacher_name: value.teacherName,
      author_name: value.authorName ?? null,
      author_name_raw: value.authorNameRaw ?? null,
      source_job_id: value.sourceJobId,
      fingerprint: value.fingerprint,
      reviewed_by: value.reviewedBy,
      reviewed_at: value.reviewedAt
    })
  };

  const parseRuns: TableDefinition<ParseRun> = {
    table: "parse_runs",
    primaryKey: "id",
    parseRow: (row) =>
      domainSchemas.parseRun.parse({
        id: cell(row, "id"),
        sourceType: (cell(row, "source_type") || "manual_pdf") as ParseRun["sourceType"],
        fileName: cell(row, "file_name"),
        uploadedBy: cell(row, "uploaded_by"),
        triggeredBy: cell(row, "triggered_by") || cell(row, "uploaded_by"),
        metadataJson: cell(row, "metadata_json") || "{}",
        cursorJson: nullableCell(row, "cursor_json"),
        status: cell(row, "status"),
        rowsExtracted: numberCell(row, "rows_extracted"),
        rowsFlagged: numberCell(row, "rows_flagged"),
        startedAt: cell(row, "started_at"),
        completedAt: nullableCell(row, "completed_at")
      }),
    serialize: (value) => ({
      id: value.id,
      source_type: value.sourceType,
      file_name: value.fileName,
      uploaded_by: value.uploadedBy,
      triggered_by: value.triggeredBy,
      metadata_json: value.metadataJson,
      cursor_json: value.cursorJson,
      status: value.status,
      rows_extracted: value.rowsExtracted,
      rows_flagged: value.rowsFlagged,
      started_at: value.startedAt,
      completed_at: value.completedAt
    })
  };

  const reviewTasks: TableDefinition<ReviewTask> = {
    table: "review_tasks",
    primaryKey: "id",
    parseRow: (row) =>
      domainSchemas.reviewTask.parse({
        id: cell(row, "id"),
        parseRunId: cell(row, "parse_run_id"),
        rawIncidentId: cell(row, "raw_incident_id"),
        assignee: nullableCell(row, "assignee"),
        status: cell(row, "status"),
        resolution: cell(row, "resolution"),
        createdAt: cell(row, "created_at"),
        resolvedAt: nullableCell(row, "resolved_at")
      }),
    serialize: (value) => ({
      id: value.id,
      parse_run_id: value.parseRunId,
      raw_incident_id: value.rawIncidentId,
      assignee: value.assignee,
      status: value.status,
      resolution: value.resolution,
      created_at: value.createdAt,
      resolved_at: value.resolvedAt
    })
  };

  const policies: TableDefinition<Policy> = {
    table: "policies",
    primaryKey: "version",
    parseRow: (row) =>
      domainSchemas.policy.parse({
        version: numberCell(row, "version"),
        baseThreshold: numberCell(row, "base_threshold"),
        warningOffsets: numberArrayCell(row, "warning_offsets"),
        milestones: numberArrayCell(row, "milestones"),
        interventionTemplates: cell(row, "intervention_templates"),
        createdBy: cell(row, "created_by"),
        createdAt: cell(row, "created_at")
      }),
    serialize: (value) => ({
      version: value.version,
      base_threshold: value.baseThreshold,
      warning_offsets: value.warningOffsets,
      milestones: value.milestones,
      intervention_templates: value.interventionTemplates,
      created_by: value.createdBy,
      created_at: value.createdAt
    })
  };

  const interventions: TableDefinition<Intervention> = {
    table: "interventions",
    primaryKey: "id",
    parseRow: (row) =>
      domainSchemas.intervention.parse({
        id: cell(row, "id"),
        studentId: cell(row, "student_id"),
        policyVersion: numberCell(row, "policy_version"),
        milestoneLabel: cell(row, "milestone_label"),
        status: cell(row, "status"),
        dueDate: cell(row, "due_date"),
        completedAt: nullableCell(row, "completed_at"),
        assignedTo: nullableCell(row, "assigned_to"),
        notes: cell(row, "notes")
      }),
    serialize: (value) => ({
      id: value.id,
      student_id: value.studentId,
      policy_version: value.policyVersion,
      milestone_label: value.milestoneLabel,
      status: value.status,
      due_date: value.dueDate,
      completed_at: value.completedAt,
      assigned_to: value.assignedTo,
      notes: value.notes
    })
  };

  const notifications: TableDefinition<Notification> = {
    table: "notifications",
    primaryKey: "id",
    parseRow: (row) =>
      domainSchemas.notification.parse({
        id: cell(row, "id"),
        studentId: cell(row, "student_id"),
        interventionId: cell(row, "intervention_id"),
        channel: cell(row, "channel"),
        recipient: cell(row, "recipient"),
        status: cell(row, "status"),
        providerId: cell(row, "provider_id"),
        sentAt: nullableCell(row, "sent_at"),
        error: cell(row, "error"),
        kind: nullableCell(row, "kind") ?? undefined,
        bandId: nullableCell(row, "band_id"),
        templateKey: nullableCell(row, "template_key"),
        draftSubject: nullableCell(row, "draft_subject"),
        draftBody: nullableCell(row, "draft_body"),
        approvedBy: nullableCell(row, "approved_by"),
        approvedAt: nullableCell(row, "approved_at"),
        suppressedAt: nullableCell(row, "suppressed_at"),
        suppressedReason: nullableCell(row, "suppressed_reason"),
        guardianContactId: nullableCell(row, "guardian_contact_id"),
        metadataJson: cell(row, "metadata_json") || "{}"
      }),
    serialize: (value) => ({
      id: value.id,
      student_id: value.studentId,
      intervention_id: value.interventionId,
      channel: value.channel,
      recipient: value.recipient,
      status: value.status,
      provider_id: value.providerId,
      sent_at: value.sentAt,
      error: value.error,
      kind: value.kind ?? "policy",
      band_id: value.bandId ?? null,
      template_key: value.templateKey ?? null,
      draft_subject: value.draftSubject ?? null,
      draft_body: value.draftBody ?? null,
      approved_by: value.approvedBy ?? null,
      approved_at: value.approvedAt ?? null,
      suppressed_at: value.suppressedAt ?? null,
      suppressed_reason: value.suppressedReason ?? null,
      guardian_contact_id: value.guardianContactId ?? null,
      metadata_json: value.metadataJson ?? "{}"
    })
  };

  const auditEvents: TableDefinition<AuditEvent> = {
    table: "audit_events",
    primaryKey: "id",
    parseRow: (row) =>
      domainSchemas.auditEvent.parse({
        id: cell(row, "id"),
        eventType: cell(row, "event_type"),
        entityType: cell(row, "entity_type"),
        entityId: cell(row, "entity_id"),
        actor: cell(row, "actor"),
        payloadJson: cell(row, "payload_json"),
        createdAt: cell(row, "created_at")
      }),
    serialize: (value) => ({
      id: value.id,
      event_type: value.eventType,
      entity_type: value.entityType,
      entity_id: value.entityId,
      actor: value.actor,
      payload_json: value.payloadJson,
      created_at: value.createdAt
    })
  };

  return {
    students,
    guardianContacts,
    rawIncidents,
    approvedIncidents,
    parseRuns,
    reviewTasks,
    policies,
    interventions,
    notifications,
    auditEvents
  };
}

class SupabaseStudentRepository implements StudentRepository {
  constructor(private readonly store: SupabaseEntityStore<Student>) {}

  upsert(student: Student): Promise<void> {
    return this.store.upsert(student);
  }

  getById(id: string): Promise<Student | null> {
    return this.store.getByColumn("id", id);
  }

  list(): Promise<Student[]> {
    return this.store.list();
  }
}

class SupabaseGuardianContactRepository implements GuardianContactRepository {
  constructor(private readonly store: SupabaseEntityStore<GuardianContact>) {}

  upsert(contact: GuardianContact): Promise<void> {
    return this.store.upsert(contact);
  }

  getById(id: string): Promise<GuardianContact | null> {
    return this.store.getByColumn("id", id);
  }

  listByStudent(studentId: string): Promise<GuardianContact[]> {
    return this.store.filterByColumn("student_id", studentId);
  }

  list(): Promise<GuardianContact[]> {
    return this.store.list();
  }
}

class SupabaseRawIncidentRepository implements RawIncidentRepository {
  constructor(private readonly store: SupabaseEntityStore<RawIncident>) {}

  upsert(rawIncident: RawIncident): Promise<void> {
    return this.store.upsert(rawIncident);
  }

  getById(id: string): Promise<RawIncident | null> {
    return this.store.getByColumn("id", id);
  }

  listByParseRun(parseRunId: string): Promise<RawIncident[]> {
    return this.store.filterByColumn("parse_run_id", parseRunId);
  }

  listByStatus(status: RawIncident["status"]): Promise<RawIncident[]> {
    return this.store.filterByColumn("status", status);
  }

  list(): Promise<RawIncident[]> {
    return this.store.list();
  }
}

class SupabaseApprovedIncidentRepository implements ApprovedIncidentRepository {
  constructor(private readonly store: SupabaseEntityStore<ApprovedIncident>) {}

  upsert(incident: ApprovedIncident): Promise<void> {
    return this.store.upsert(incident);
  }

  getById(id: string): Promise<ApprovedIncident | null> {
    return this.store.getByColumn("id", id);
  }

  getByFingerprint(fingerprint: string): Promise<ApprovedIncident | null> {
    return this.store.getByColumn("fingerprint", fingerprint);
  }

  listByStudent(studentId: string): Promise<ApprovedIncident[]> {
    return this.store.filterByColumn("student_id", studentId);
  }

  list(): Promise<ApprovedIncident[]> {
    return this.store.list();
  }
}

class SupabaseParseRunRepository implements ParseRunRepository {
  constructor(private readonly store: SupabaseEntityStore<ParseRun>) {}

  upsert(parseRun: ParseRun): Promise<void> {
    return this.store.upsert(parseRun);
  }

  getById(id: string): Promise<ParseRun | null> {
    return this.store.getByColumn("id", id);
  }

  list(): Promise<ParseRun[]> {
    return this.store.list();
  }
}

class SupabaseReviewTaskRepository implements ReviewTaskRepository {
  constructor(private readonly store: SupabaseEntityStore<ReviewTask>) {}

  upsert(reviewTask: ReviewTask): Promise<void> {
    return this.store.upsert(reviewTask);
  }

  getById(id: string): Promise<ReviewTask | null> {
    return this.store.getByColumn("id", id);
  }

  listByParseRun(parseRunId: string): Promise<ReviewTask[]> {
    return this.store.filterByColumn("parse_run_id", parseRunId);
  }

  listByStatus(status: ReviewTask["status"]): Promise<ReviewTask[]> {
    return this.store.filterByColumn("status", status);
  }
}

class SupabasePolicyRepository implements PolicyRepository {
  constructor(private readonly store: SupabaseEntityStore<Policy>) {}

  upsert(policy: Policy): Promise<void> {
    return this.store.upsert(policy);
  }

  getByVersion(version: number): Promise<Policy | null> {
    return this.store.getByColumn("version", version);
  }

  async getLatest(): Promise<Policy | null> {
    const rows = await this.store.list();
    return rows.sort((left, right) => right.version - left.version)[0] ?? null;
  }

  list(): Promise<Policy[]> {
    return this.store.list();
  }
}

class SupabaseInterventionRepository implements InterventionRepository {
  constructor(private readonly store: SupabaseEntityStore<Intervention>) {}

  upsert(intervention: Intervention): Promise<void> {
    return this.store.upsert(intervention);
  }

  getById(id: string): Promise<Intervention | null> {
    return this.store.getByColumn("id", id);
  }

  listByStudent(studentId: string): Promise<Intervention[]> {
    return this.store.filterByColumn("student_id", studentId);
  }

  list(): Promise<Intervention[]> {
    return this.store.list();
  }
}

class SupabaseNotificationRepository implements NotificationRepository {
  constructor(private readonly store: SupabaseEntityStore<Notification>) {}

  upsert(notification: Notification): Promise<void> {
    return this.store.upsert(notification);
  }

  listByStudent(studentId: string): Promise<Notification[]> {
    return this.store.filterByColumn("student_id", studentId);
  }

  list(): Promise<Notification[]> {
    return this.store.list();
  }
}

class SupabaseAuditEventRepository implements AuditEventRepository {
  constructor(private readonly store: SupabaseEntityStore<AuditEvent>) {}

  append(event: AuditEvent): Promise<void> {
    return this.store.append(event);
  }

  async listByEntity(entityType: string, entityId: string): Promise<AuditEvent[]> {
    const rows = await this.store.list();
    return rows.filter((row) => row.entityType === entityType && row.entityId === entityId);
  }

  list(): Promise<AuditEvent[]> {
    return this.store.list();
  }
}

export class SupabaseAdapter implements StorageRepositories {
  readonly students: StudentRepository;
  readonly guardianContacts: GuardianContactRepository;
  readonly rawIncidents: RawIncidentRepository;
  readonly approvedIncidents: ApprovedIncidentRepository;
  readonly parseRuns: ParseRunRepository;
  readonly reviewTasks: ReviewTaskRepository;
  readonly policies: PolicyRepository;
  readonly interventions: InterventionRepository;
  readonly notifications: NotificationRepository;
  readonly auditEvents: AuditEventRepository;

  private readonly stores: Array<{ ensureTable: () => Promise<void> }>;

  constructor(client: SupabaseClient) {
    const definitions = createDefinitions();

    const studentStore = new SupabaseEntityStore(client, definitions.students);
    const guardianContactStore = new SupabaseEntityStore(client, definitions.guardianContacts);
    const rawIncidentStore = new SupabaseEntityStore(client, definitions.rawIncidents);
    const approvedIncidentStore = new SupabaseEntityStore(client, definitions.approvedIncidents);
    const parseRunStore = new SupabaseEntityStore(client, definitions.parseRuns);
    const reviewTaskStore = new SupabaseEntityStore(client, definitions.reviewTasks);
    const policyStore = new SupabaseEntityStore(client, definitions.policies);
    const interventionStore = new SupabaseEntityStore(client, definitions.interventions);
    const notificationStore = new SupabaseEntityStore(client, definitions.notifications);
    const auditEventStore = new SupabaseEntityStore(client, definitions.auditEvents);

    this.students = new SupabaseStudentRepository(studentStore);
    this.guardianContacts = new SupabaseGuardianContactRepository(guardianContactStore);
    this.rawIncidents = new SupabaseRawIncidentRepository(rawIncidentStore);
    this.approvedIncidents = new SupabaseApprovedIncidentRepository(approvedIncidentStore);
    this.parseRuns = new SupabaseParseRunRepository(parseRunStore);
    this.reviewTasks = new SupabaseReviewTaskRepository(reviewTaskStore);
    this.policies = new SupabasePolicyRepository(policyStore);
    this.interventions = new SupabaseInterventionRepository(interventionStore);
    this.notifications = new SupabaseNotificationRepository(notificationStore);
    this.auditEvents = new SupabaseAuditEventRepository(auditEventStore);

    this.stores = [
      studentStore,
      guardianContactStore,
      rawIncidentStore,
      approvedIncidentStore,
      parseRunStore,
      reviewTaskStore,
      policyStore,
      interventionStore,
      notificationStore,
      auditEventStore
    ];
  }

  async ensureSchema(): Promise<void> {
    for (const store of this.stores) {
      await store.ensureTable();
    }
  }
}
