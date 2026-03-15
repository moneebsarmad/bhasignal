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
import type { SheetsClient } from "./types";

interface TabDefinition<T> {
  tab: string;
  headers: string[];
  parseRow: (row: Record<string, string>) => T;
  serialize: (value: T) => Record<string, string>;
}

interface StoredRow<T> {
  rowNumber: number;
  value: T;
  raw: Record<string, string>;
}

function boolToSheet(value: boolean): string {
  return value ? "1" : "0";
}

function sheetToBool(value: string): boolean {
  return value === "1" || value.toLowerCase() === "true";
}

function numberToSheet(value: number): string {
  return String(value);
}

function sheetToNumber(value: string): number {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return parsed;
}

function nullableNumberToSheet(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function sheetToNullableNumber(value: string): number | null {
  if (value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function nullableToSheet(value: string | null): string {
  return value ?? "";
}

function sheetToNullable(value: string): string | null {
  return value === "" ? null : value;
}

function columnNumberToLetter(columnNumber: number): string {
  let number = columnNumber;
  let result = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

class SheetsEntityStore<T> {
  private static readonly ensuredTabsByClient = new WeakMap<SheetsClient, Set<string>>();
  private static readonly defaultCacheTtlMs = 5000;

  private cachedRows: StoredRow<T>[] | null = null;
  private cacheHydratedAt = 0;

  constructor(
    private readonly client: SheetsClient,
    private readonly definition: TabDefinition<T>
  ) {}

  private cacheTtlMs(): number {
    const raw = process.env.SHEETS_TAB_CACHE_TTL_MS;
    if (!raw) {
      return SheetsEntityStore.defaultCacheTtlMs;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : SheetsEntityStore.defaultCacheTtlMs;
  }

  private hasFreshCache(): boolean {
    if (!this.cachedRows) {
      return false;
    }
    const ttl = this.cacheTtlMs();
    if (ttl === 0) {
      return false;
    }
    return Date.now() - this.cacheHydratedAt <= ttl;
  }

  private cloneRows(rows: StoredRow<T>[]): StoredRow<T>[] {
    return rows.map((row) => ({
      rowNumber: row.rowNumber,
      value: row.value,
      raw: { ...row.raw }
    }));
  }

  private toRawRecord(rowValues: string[]): Record<string, string> {
    const rawRecord: Record<string, string> = {};
    this.definition.headers.forEach((header, index) => {
      rawRecord[header] = rowValues[index] ?? "";
    });
    return rawRecord;
  }

  private setCache(rows: StoredRow<T>[]): void {
    this.cachedRows = rows;
    this.cacheHydratedAt = Date.now();
  }

  async ensureHeaderRow(): Promise<void> {
    let ensuredTabs = SheetsEntityStore.ensuredTabsByClient.get(this.client);
    if (!ensuredTabs) {
      ensuredTabs = new Set<string>();
      SheetsEntityStore.ensuredTabsByClient.set(this.client, ensuredTabs);
    }

    if (ensuredTabs.has(this.definition.tab)) {
      return;
    }

    const firstRow = await this.client.read(`${this.definition.tab}!A1:ZZ1`);
    const expected = this.definition.headers;
    const actual = firstRow[0] ?? [];
    const matches = actual.length === expected.length && actual.every((value, index) => value === expected[index]);
    if (!matches) {
      await this.client.update(`${this.definition.tab}!A1`, [expected]);
    }

    ensuredTabs.add(this.definition.tab);
  }

  async list(): Promise<StoredRow<T>[]> {
    await this.ensureHeaderRow();
    if (this.hasFreshCache() && this.cachedRows) {
      return this.cloneRows(this.cachedRows);
    }

    const rows = await this.client.read(`${this.definition.tab}!A:ZZ`);
    if (rows.length <= 1) {
      this.setCache([]);
      return [];
    }

    const storedRows: StoredRow<T>[] = [];
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const rawRow = rows[rowIndex] ?? [];
      const hasValue = rawRow.some((cell) => (cell ?? "").trim() !== "");
      if (!hasValue) {
        continue;
      }

      const rawRecord: Record<string, string> = {};
      this.definition.headers.forEach((header, index) => {
        rawRecord[header] = rawRow[index] ?? "";
      });

      let parsed: T;
      try {
        parsed = this.definition.parseRow(rawRecord);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Unknown parse error";
        throw new Error(
          `Failed to parse row ${rowIndex + 1} from tab "${this.definition.tab}": ${detail}`
        );
      }

      storedRows.push({
        rowNumber: rowIndex + 1,
        value: parsed,
        raw: rawRecord
      });
    }

    this.setCache(storedRows);
    return this.cloneRows(storedRows);
  }

  private rowValues(value: T): string[] {
    const serialized = this.definition.serialize(value);
    return this.definition.headers.map((header) => serialized[header] ?? "");
  }

  async append(value: T): Promise<void> {
    await this.ensureHeaderRow();
    const rowValues = this.rowValues(value);
    await this.client.append(`${this.definition.tab}!A:ZZ`, [rowValues]);

    if (!this.cachedRows) {
      return;
    }

    const nextRowNumber =
      this.cachedRows.length > 0
        ? Math.max(...this.cachedRows.map((row) => row.rowNumber)) + 1
        : 2;
    const raw = this.toRawRecord(rowValues);
    const parsed = this.definition.parseRow(raw);
    this.setCache([
      ...this.cachedRows,
      {
        rowNumber: nextRowNumber,
        value: parsed,
        raw
      }
    ]);
  }

  async upsertByColumn(value: T, column: string, columnValue: string): Promise<void> {
    const rows = await this.list();
    const existing = rows.find((row) => row.raw[column] === columnValue);

    if (!existing) {
      await this.append(value);
      return;
    }

    const endColumnLetter = columnNumberToLetter(this.definition.headers.length);
    const rowValues = this.rowValues(value);
    await this.client.update(
      `${this.definition.tab}!A${existing.rowNumber}:${endColumnLetter}${existing.rowNumber}`,
      [rowValues]
    );

    if (!this.cachedRows) {
      return;
    }

    const raw = this.toRawRecord(rowValues);
    const parsed = this.definition.parseRow(raw);
    this.setCache(
      this.cachedRows.map((row) => {
        if (row.rowNumber !== existing.rowNumber) {
          return row;
        }
        return {
          rowNumber: row.rowNumber,
          value: parsed,
          raw
        };
      })
    );
  }

  async getByColumn(column: string, columnValue: string): Promise<T | null> {
    const rows = await this.list();
    const existing = rows.find((row) => row.raw[column] === columnValue);
    return existing ? existing.value : null;
  }

  async filterByColumn(column: string, columnValue: string): Promise<T[]> {
    const rows = await this.list();
    return rows.filter((row) => row.raw[column] === columnValue).map((row) => row.value);
  }
}

function createDefinitions() {
  const cell = (row: Record<string, string>, key: string): string => row[key] ?? "";

  const students: TabDefinition<Student> = {
    tab: "students",
    headers: ["student_id", "external_id", "full_name", "grade", "active", "created_at", "updated_at"],
    parseRow: (row) =>
      domainSchemas.student.parse({
        id: cell(row, "student_id"),
        externalId: sheetToNullable(cell(row, "external_id")),
        fullName: cell(row, "full_name"),
        grade: cell(row, "grade"),
        active: sheetToBool(cell(row, "active")),
        createdAt: cell(row, "created_at"),
        updatedAt: cell(row, "updated_at")
      }),
    serialize: (value) => ({
      student_id: value.id,
      external_id: nullableToSheet(value.externalId),
      full_name: value.fullName,
      grade: value.grade,
      active: boolToSheet(value.active),
      created_at: value.createdAt,
      updated_at: value.updatedAt
    })
  };

  const guardianContacts: TabDefinition<GuardianContact> = {
    tab: "guardian_contacts",
    headers: [
      "guardian_contact_id",
      "student_id",
      "guardian_name",
      "relationship",
      "email",
      "phone",
      "is_primary",
      "allow_email",
      "source_type",
      "source_record_id",
      "last_synced_at",
      "is_active",
      "notes"
    ],
    parseRow: (row) =>
      domainSchemas.guardianContact.parse({
        id: cell(row, "guardian_contact_id"),
        studentId: cell(row, "student_id"),
        guardianName: sheetToNullable(cell(row, "guardian_name")),
        relationship: sheetToNullable(cell(row, "relationship")),
        email: sheetToNullable(cell(row, "email")),
        phone: sheetToNullable(cell(row, "phone")),
        isPrimary: sheetToBool(cell(row, "is_primary")),
        allowEmail: sheetToBool(cell(row, "allow_email")),
        sourceType: cell(row, "source_type") || "manual",
        sourceRecordId: sheetToNullable(cell(row, "source_record_id")),
        lastSyncedAt: sheetToNullable(cell(row, "last_synced_at")),
        isActive: sheetToBool(cell(row, "is_active")),
        notes: cell(row, "notes")
      }),
    serialize: (value) => ({
      guardian_contact_id: value.id,
      student_id: value.studentId,
      guardian_name: nullableToSheet(value.guardianName ?? null),
      relationship: nullableToSheet(value.relationship ?? null),
      email: nullableToSheet(value.email ?? null),
      phone: nullableToSheet(value.phone ?? null),
      is_primary: boolToSheet(value.isPrimary),
      allow_email: boolToSheet(value.allowEmail),
      source_type: value.sourceType,
      source_record_id: nullableToSheet(value.sourceRecordId ?? null),
      last_synced_at: nullableToSheet(value.lastSyncedAt ?? null),
      is_active: boolToSheet(value.isActive),
      notes: value.notes
    })
  };

  const rawIncidents: TabDefinition<RawIncident> = {
    tab: "incidents_raw",
    headers: [
      "raw_id",
      "parse_run_id",
      "source_type",
      "source_record_id",
      "student_reference",
      "external_student_id",
      "grade_at_event",
      "event_type",
      "occurred_at",
      "writeup_date",
      "points",
      "reason",
      "violation",
      "violation_raw",
      "level",
      "comment",
      "description",
      "resolution",
      "teacher_name",
      "author_name",
      "author_name_raw",
      "source_payload_json",
      "mapping_warnings_json",
      "confidence_json",
      "status"
    ],
    parseRow: (row) =>
      domainSchemas.rawIncident.parse({
        id: cell(row, "raw_id"),
        parseRunId: cell(row, "parse_run_id"),
        sourceType: (cell(row, "source_type") || "manual_pdf") as RawIncident["sourceType"],
        sourceRecordId: cell(row, "source_record_id") || cell(row, "raw_id"),
        studentReference: cell(row, "student_reference"),
        externalStudentId: sheetToNullable(cell(row, "external_student_id")),
        gradeAtEvent: sheetToNullable(cell(row, "grade_at_event")),
        eventType: sheetToNullable(cell(row, "event_type")),
        occurredAt: cell(row, "occurred_at"),
        writeupDate: sheetToNullable(cell(row, "writeup_date")),
        points: sheetToNumber(cell(row, "points")),
        reason: cell(row, "reason"),
        violation: sheetToNullable(cell(row, "violation")),
        violationRaw: sheetToNullable(cell(row, "violation_raw")),
        level: sheetToNullableNumber(cell(row, "level")),
        comment: cell(row, "comment"),
        description: sheetToNullable(cell(row, "description")),
        resolution: sheetToNullable(cell(row, "resolution")),
        teacherName: cell(row, "teacher_name"),
        authorName: sheetToNullable(cell(row, "author_name")),
        authorNameRaw: sheetToNullable(cell(row, "author_name_raw")),
        sourcePayloadJson: cell(row, "source_payload_json") || "{}",
        mappingWarningsJson: cell(row, "mapping_warnings_json") || "[]",
        confidenceJson: cell(row, "confidence_json"),
        status: cell(row, "status")
      }),
    serialize: (value) => ({
      raw_id: value.id,
      parse_run_id: value.parseRunId,
      source_type: value.sourceType,
      source_record_id: value.sourceRecordId,
      student_reference: value.studentReference,
      external_student_id: nullableToSheet(value.externalStudentId),
      grade_at_event: nullableToSheet(value.gradeAtEvent),
      event_type: nullableToSheet(value.eventType),
      occurred_at: value.occurredAt,
      writeup_date: nullableToSheet(value.writeupDate ?? null),
      points: numberToSheet(value.points),
      reason: value.reason,
      violation: nullableToSheet(value.violation ?? null),
      violation_raw: nullableToSheet(value.violationRaw ?? null),
      level: nullableNumberToSheet(value.level),
      comment: value.comment,
      description: nullableToSheet(value.description ?? null),
      resolution: nullableToSheet(value.resolution ?? null),
      teacher_name: value.teacherName,
      author_name: nullableToSheet(value.authorName ?? null),
      author_name_raw: nullableToSheet(value.authorNameRaw ?? null),
      source_payload_json: value.sourcePayloadJson,
      mapping_warnings_json: value.mappingWarningsJson,
      confidence_json: value.confidenceJson,
      status: value.status
    })
  };

  const approvedIncidents: TabDefinition<ApprovedIncident> = {
    tab: "incidents_approved",
    headers: [
      "incident_id",
      "student_id",
      "source_type",
      "source_record_id",
      "external_student_id",
      "grade_at_event",
      "event_type",
      "occurred_at",
      "writeup_date",
      "points",
      "reason",
      "violation",
      "violation_raw",
      "level",
      "comment",
      "description",
      "resolution",
      "teacher_name",
      "author_name",
      "author_name_raw",
      "source_job_id",
      "fingerprint",
      "reviewed_by",
      "reviewed_at"
    ],
    parseRow: (row) =>
      domainSchemas.approvedIncident.parse({
        id: cell(row, "incident_id"),
        studentId: cell(row, "student_id"),
        sourceType: (cell(row, "source_type") || "manual_pdf") as ApprovedIncident["sourceType"],
        sourceRecordId: cell(row, "source_record_id") || cell(row, "incident_id"),
        externalStudentId: sheetToNullable(cell(row, "external_student_id")),
        gradeAtEvent: sheetToNullable(cell(row, "grade_at_event")),
        eventType: sheetToNullable(cell(row, "event_type")),
        occurredAt: cell(row, "occurred_at"),
        writeupDate: sheetToNullable(cell(row, "writeup_date")),
        points: sheetToNumber(cell(row, "points")),
        reason: cell(row, "reason"),
        violation: sheetToNullable(cell(row, "violation")),
        violationRaw: sheetToNullable(cell(row, "violation_raw")),
        level: sheetToNullableNumber(cell(row, "level")),
        comment: cell(row, "comment"),
        description: sheetToNullable(cell(row, "description")),
        resolution: sheetToNullable(cell(row, "resolution")),
        teacherName: cell(row, "teacher_name"),
        authorName: sheetToNullable(cell(row, "author_name")),
        authorNameRaw: sheetToNullable(cell(row, "author_name_raw")),
        sourceJobId: cell(row, "source_job_id"),
        fingerprint: cell(row, "fingerprint"),
        reviewedBy: cell(row, "reviewed_by"),
        reviewedAt: cell(row, "reviewed_at")
      }),
    serialize: (value) => ({
      incident_id: value.id,
      student_id: value.studentId,
      source_type: value.sourceType,
      source_record_id: value.sourceRecordId,
      external_student_id: nullableToSheet(value.externalStudentId),
      grade_at_event: nullableToSheet(value.gradeAtEvent),
      event_type: nullableToSheet(value.eventType),
      occurred_at: value.occurredAt,
      writeup_date: nullableToSheet(value.writeupDate ?? null),
      points: numberToSheet(value.points),
      reason: value.reason,
      violation: nullableToSheet(value.violation ?? null),
      violation_raw: nullableToSheet(value.violationRaw ?? null),
      level: nullableNumberToSheet(value.level),
      comment: value.comment,
      description: nullableToSheet(value.description ?? null),
      resolution: nullableToSheet(value.resolution ?? null),
      teacher_name: value.teacherName,
      author_name: nullableToSheet(value.authorName ?? null),
      author_name_raw: nullableToSheet(value.authorNameRaw ?? null),
      source_job_id: value.sourceJobId,
      fingerprint: value.fingerprint,
      reviewed_by: value.reviewedBy,
      reviewed_at: value.reviewedAt
    })
  };

  const parseRuns: TabDefinition<ParseRun> = {
    tab: "parse_runs",
    headers: [
      "parse_run_id",
      "source_type",
      "file_name",
      "uploaded_by",
      "triggered_by",
      "metadata_json",
      "cursor_json",
      "status",
      "rows_extracted",
      "rows_flagged",
      "started_at",
      "completed_at"
    ],
    parseRow: (row) =>
      domainSchemas.parseRun.parse({
        id: cell(row, "parse_run_id"),
        sourceType: (cell(row, "source_type") || "manual_pdf") as ParseRun["sourceType"],
        fileName: cell(row, "file_name"),
        uploadedBy: cell(row, "uploaded_by"),
        triggeredBy: cell(row, "triggered_by") || cell(row, "uploaded_by"),
        metadataJson: cell(row, "metadata_json") || "{}",
        cursorJson: sheetToNullable(cell(row, "cursor_json")),
        status: cell(row, "status"),
        rowsExtracted: sheetToNumber(cell(row, "rows_extracted")),
        rowsFlagged: sheetToNumber(cell(row, "rows_flagged")),
        startedAt: cell(row, "started_at"),
        completedAt: sheetToNullable(cell(row, "completed_at"))
      }),
    serialize: (value) => ({
      parse_run_id: value.id,
      source_type: value.sourceType,
      file_name: value.fileName,
      uploaded_by: value.uploadedBy,
      triggered_by: value.triggeredBy,
      metadata_json: value.metadataJson,
      cursor_json: nullableToSheet(value.cursorJson),
      status: value.status,
      rows_extracted: numberToSheet(value.rowsExtracted),
      rows_flagged: numberToSheet(value.rowsFlagged),
      started_at: value.startedAt,
      completed_at: nullableToSheet(value.completedAt)
    })
  };

  const reviewTasks: TabDefinition<ReviewTask> = {
    tab: "review_tasks",
    headers: [
      "review_task_id",
      "parse_run_id",
      "raw_id",
      "assignee",
      "status",
      "resolution",
      "created_at",
      "resolved_at"
    ],
    parseRow: (row) =>
      domainSchemas.reviewTask.parse({
        id: cell(row, "review_task_id"),
        parseRunId: cell(row, "parse_run_id"),
        rawIncidentId: cell(row, "raw_id"),
        assignee: sheetToNullable(cell(row, "assignee")),
        status: cell(row, "status"),
        resolution: cell(row, "resolution"),
        createdAt: cell(row, "created_at"),
        resolvedAt: sheetToNullable(cell(row, "resolved_at"))
      }),
    serialize: (value) => ({
      review_task_id: value.id,
      parse_run_id: value.parseRunId,
      raw_id: value.rawIncidentId,
      assignee: nullableToSheet(value.assignee),
      status: value.status,
      resolution: value.resolution,
      created_at: value.createdAt,
      resolved_at: nullableToSheet(value.resolvedAt)
    })
  };

  const policies: TabDefinition<Policy> = {
    tab: "policies",
    headers: [
      "policy_version",
      "base_threshold",
      "warning_offsets",
      "milestones",
      "intervention_templates",
      "created_by",
      "created_at"
    ],
    parseRow: (row) =>
      domainSchemas.policy.parse({
        version: sheetToNumber(cell(row, "policy_version")),
        baseThreshold: sheetToNumber(cell(row, "base_threshold")),
        warningOffsets: JSON.parse(cell(row, "warning_offsets") || "[]"),
        milestones: JSON.parse(cell(row, "milestones") || "[]"),
        interventionTemplates: cell(row, "intervention_templates"),
        createdBy: cell(row, "created_by"),
        createdAt: cell(row, "created_at")
      }),
    serialize: (value) => ({
      policy_version: numberToSheet(value.version),
      base_threshold: numberToSheet(value.baseThreshold),
      warning_offsets: JSON.stringify(value.warningOffsets),
      milestones: JSON.stringify(value.milestones),
      intervention_templates: value.interventionTemplates,
      created_by: value.createdBy,
      created_at: value.createdAt
    })
  };

  const interventions: TabDefinition<Intervention> = {
    tab: "interventions",
    headers: [
      "intervention_id",
      "student_id",
      "policy_version",
      "milestone_label",
      "status",
      "due_date",
      "completed_at",
      "assigned_to",
      "notes"
    ],
    parseRow: (row) =>
      domainSchemas.intervention.parse({
        id: cell(row, "intervention_id"),
        studentId: cell(row, "student_id"),
        policyVersion: sheetToNumber(cell(row, "policy_version")),
        milestoneLabel: cell(row, "milestone_label"),
        status: cell(row, "status"),
        dueDate: cell(row, "due_date"),
        completedAt: sheetToNullable(cell(row, "completed_at")),
        assignedTo: sheetToNullable(cell(row, "assigned_to")),
        notes: cell(row, "notes")
      }),
    serialize: (value) => ({
      intervention_id: value.id,
      student_id: value.studentId,
      policy_version: numberToSheet(value.policyVersion),
      milestone_label: value.milestoneLabel,
      status: value.status,
      due_date: value.dueDate,
      completed_at: nullableToSheet(value.completedAt),
      assigned_to: nullableToSheet(value.assignedTo),
      notes: value.notes
    })
  };

  const notifications: TabDefinition<Notification> = {
    tab: "notifications",
    headers: [
      "notification_id",
      "student_id",
      "intervention_id",
      "channel",
      "recipient",
      "status",
      "provider_id",
      "sent_at",
      "error",
      "kind",
      "band_id",
      "template_key",
      "draft_subject",
      "draft_body",
      "approved_by",
      "approved_at",
      "suppressed_at",
      "suppressed_reason",
      "guardian_contact_id",
      "metadata_json"
    ],
    parseRow: (row) =>
      domainSchemas.notification.parse({
        id: cell(row, "notification_id"),
        studentId: cell(row, "student_id"),
        interventionId: cell(row, "intervention_id"),
        channel: cell(row, "channel"),
        recipient: cell(row, "recipient"),
        status: cell(row, "status"),
        providerId: cell(row, "provider_id"),
        sentAt: sheetToNullable(cell(row, "sent_at")),
        error: cell(row, "error"),
        kind: sheetToNullable(cell(row, "kind")) ?? undefined,
        bandId: sheetToNullable(cell(row, "band_id")),
        templateKey: sheetToNullable(cell(row, "template_key")),
        draftSubject: sheetToNullable(cell(row, "draft_subject")),
        draftBody: sheetToNullable(cell(row, "draft_body")),
        approvedBy: sheetToNullable(cell(row, "approved_by")),
        approvedAt: sheetToNullable(cell(row, "approved_at")),
        suppressedAt: sheetToNullable(cell(row, "suppressed_at")),
        suppressedReason: sheetToNullable(cell(row, "suppressed_reason")),
        guardianContactId: sheetToNullable(cell(row, "guardian_contact_id")),
        metadataJson: cell(row, "metadata_json") || "{}"
      }),
    serialize: (value) => ({
      notification_id: value.id,
      student_id: value.studentId,
      intervention_id: value.interventionId,
      channel: value.channel,
      recipient: value.recipient,
      status: value.status,
      provider_id: value.providerId,
      sent_at: nullableToSheet(value.sentAt),
      error: value.error,
      kind: value.kind ?? "policy",
      band_id: nullableToSheet(value.bandId ?? null),
      template_key: nullableToSheet(value.templateKey ?? null),
      draft_subject: nullableToSheet(value.draftSubject ?? null),
      draft_body: nullableToSheet(value.draftBody ?? null),
      approved_by: nullableToSheet(value.approvedBy ?? null),
      approved_at: nullableToSheet(value.approvedAt ?? null),
      suppressed_at: nullableToSheet(value.suppressedAt ?? null),
      suppressed_reason: nullableToSheet(value.suppressedReason ?? null),
      guardian_contact_id: nullableToSheet(value.guardianContactId ?? null),
      metadata_json: value.metadataJson ?? "{}"
    })
  };

  const auditEvents: TabDefinition<AuditEvent> = {
    tab: "audit_events",
    headers: [
      "audit_id",
      "event_type",
      "entity_type",
      "entity_id",
      "actor",
      "payload_json",
      "created_at"
    ],
    parseRow: (row) =>
      domainSchemas.auditEvent.parse({
        id: cell(row, "audit_id"),
        eventType: cell(row, "event_type"),
        entityType: cell(row, "entity_type"),
        entityId: cell(row, "entity_id"),
        actor: cell(row, "actor"),
        payloadJson: cell(row, "payload_json"),
        createdAt: cell(row, "created_at")
      }),
    serialize: (value) => ({
      audit_id: value.id,
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

class SheetsStudentRepository implements StudentRepository {
  constructor(private readonly store: SheetsEntityStore<Student>) {}

  async upsert(student: Student): Promise<void> {
    await this.store.upsertByColumn(student, "student_id", student.id);
  }

  async getById(id: string): Promise<Student | null> {
    return this.store.getByColumn("student_id", id);
  }

  async list(): Promise<Student[]> {
    const rows = await this.store.list();
    return rows.map((row) => row.value);
  }
}

class SheetsGuardianContactRepository implements GuardianContactRepository {
  constructor(private readonly store: SheetsEntityStore<GuardianContact>) {}

  async upsert(contact: GuardianContact): Promise<void> {
    await this.store.upsertByColumn(contact, "guardian_contact_id", contact.id);
  }

  async getById(id: string): Promise<GuardianContact | null> {
    return this.store.getByColumn("guardian_contact_id", id);
  }

  async listByStudent(studentId: string): Promise<GuardianContact[]> {
    return this.store.filterByColumn("student_id", studentId);
  }

  async list(): Promise<GuardianContact[]> {
    const rows = await this.store.list();
    return rows.map((row) => row.value);
  }
}

class SheetsRawIncidentRepository implements RawIncidentRepository {
  constructor(private readonly store: SheetsEntityStore<RawIncident>) {}

  async upsert(rawIncident: RawIncident): Promise<void> {
    await this.store.upsertByColumn(rawIncident, "raw_id", rawIncident.id);
  }

  async getById(id: string): Promise<RawIncident | null> {
    return this.store.getByColumn("raw_id", id);
  }

  async listByParseRun(parseRunId: string): Promise<RawIncident[]> {
    return this.store.filterByColumn("parse_run_id", parseRunId);
  }

  async listByStatus(status: RawIncident["status"]): Promise<RawIncident[]> {
    return this.store.filterByColumn("status", status);
  }

  async list(): Promise<RawIncident[]> {
    const rows = await this.store.list();
    return rows.map((row) => row.value);
  }
}

class SheetsApprovedIncidentRepository implements ApprovedIncidentRepository {
  constructor(private readonly store: SheetsEntityStore<ApprovedIncident>) {}

  async upsert(incident: ApprovedIncident): Promise<void> {
    const existingById = await this.store.getByColumn("incident_id", incident.id);
    if (existingById) {
      await this.store.upsertByColumn(incident, "incident_id", incident.id);
      return;
    }

    if (incident.sourceType === "sycamore_api") {
      const rows = await this.store.list();
      const existingBySourceRecord = rows.find(
        (row) =>
          row.value.sourceType === incident.sourceType &&
          row.value.sourceRecordId === incident.sourceRecordId
      )?.value;
      if (existingBySourceRecord) {
        await this.store.upsertByColumn(
          { ...incident, id: existingBySourceRecord.id },
          "incident_id",
          existingBySourceRecord.id
        );
        return;
      }
    }

    const existingByFingerprint = await this.store.getByColumn("fingerprint", incident.fingerprint);
    if (existingByFingerprint) {
      await this.store.upsertByColumn(
        { ...incident, id: existingByFingerprint.id },
        "incident_id",
        existingByFingerprint.id
      );
      return;
    }

    await this.store.upsertByColumn(incident, "incident_id", incident.id);
  }

  async getById(id: string): Promise<ApprovedIncident | null> {
    return this.store.getByColumn("incident_id", id);
  }

  async getByFingerprint(fingerprint: string): Promise<ApprovedIncident | null> {
    return this.store.getByColumn("fingerprint", fingerprint);
  }

  async listByStudent(studentId: string): Promise<ApprovedIncident[]> {
    return this.store.filterByColumn("student_id", studentId);
  }

  async list(): Promise<ApprovedIncident[]> {
    const rows = await this.store.list();
    return rows.map((row) => row.value);
  }
}

class SheetsParseRunRepository implements ParseRunRepository {
  constructor(private readonly store: SheetsEntityStore<ParseRun>) {}

  async upsert(parseRun: ParseRun): Promise<void> {
    await this.store.upsertByColumn(parseRun, "parse_run_id", parseRun.id);
  }

  async getById(id: string): Promise<ParseRun | null> {
    return this.store.getByColumn("parse_run_id", id);
  }

  async list(): Promise<ParseRun[]> {
    const rows = await this.store.list();
    return rows.map((row) => row.value);
  }
}

class SheetsReviewTaskRepository implements ReviewTaskRepository {
  constructor(private readonly store: SheetsEntityStore<ReviewTask>) {}

  async upsert(reviewTask: ReviewTask): Promise<void> {
    await this.store.upsertByColumn(reviewTask, "review_task_id", reviewTask.id);
  }

  async getById(id: string): Promise<ReviewTask | null> {
    return this.store.getByColumn("review_task_id", id);
  }

  async listByParseRun(parseRunId: string): Promise<ReviewTask[]> {
    return this.store.filterByColumn("parse_run_id", parseRunId);
  }

  async listByStatus(status: ReviewTask["status"]): Promise<ReviewTask[]> {
    return this.store.filterByColumn("status", status);
  }
}

class SheetsPolicyRepository implements PolicyRepository {
  constructor(private readonly store: SheetsEntityStore<Policy>) {}

  async upsert(policy: Policy): Promise<void> {
    await this.store.upsertByColumn(policy, "policy_version", String(policy.version));
  }

  async getByVersion(version: number): Promise<Policy | null> {
    return this.store.getByColumn("policy_version", String(version));
  }

  async getLatest(): Promise<Policy | null> {
    const list = await this.list();
    if (list.length === 0) {
      return null;
    }
    return list.sort((left, right) => right.version - left.version)[0] ?? null;
  }

  async list(): Promise<Policy[]> {
    const rows = await this.store.list();
    return rows.map((row) => row.value);
  }
}

class SheetsInterventionRepository implements InterventionRepository {
  constructor(private readonly store: SheetsEntityStore<Intervention>) {}

  async upsert(intervention: Intervention): Promise<void> {
    await this.store.upsertByColumn(intervention, "intervention_id", intervention.id);
  }

  async getById(id: string): Promise<Intervention | null> {
    return this.store.getByColumn("intervention_id", id);
  }

  async listByStudent(studentId: string): Promise<Intervention[]> {
    return this.store.filterByColumn("student_id", studentId);
  }

  async list(): Promise<Intervention[]> {
    const rows = await this.store.list();
    return rows.map((row) => row.value);
  }
}

class SheetsNotificationRepository implements NotificationRepository {
  constructor(private readonly store: SheetsEntityStore<Notification>) {}

  async upsert(notification: Notification): Promise<void> {
    await this.store.upsertByColumn(notification, "notification_id", notification.id);
  }

  async listByStudent(studentId: string): Promise<Notification[]> {
    return this.store.filterByColumn("student_id", studentId);
  }

  async list(): Promise<Notification[]> {
    const rows = await this.store.list();
    return rows.map((row) => row.value);
  }
}

class SheetsAuditEventRepository implements AuditEventRepository {
  constructor(private readonly store: SheetsEntityStore<AuditEvent>) {}

  async append(event: AuditEvent): Promise<void> {
    await this.store.append(event);
  }

  async listByEntity(entityType: string, entityId: string): Promise<AuditEvent[]> {
    const rows = await this.store.list();
    return rows
      .filter((row) => row.value.entityType === entityType && row.value.entityId === entityId)
      .map((row) => row.value);
  }

  async list(): Promise<AuditEvent[]> {
    const rows = await this.store.list();
    return rows.map((row) => row.value);
  }
}

export class SheetsAdapter implements StorageRepositories {
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

  private readonly stores: Array<{ ensureHeaderRow: () => Promise<void> }>;

  constructor(private readonly client: SheetsClient) {
    const definitions = createDefinitions();

    const studentStore = new SheetsEntityStore(client, definitions.students);
    const guardianContactStore = new SheetsEntityStore(client, definitions.guardianContacts);
    const rawIncidentStore = new SheetsEntityStore(client, definitions.rawIncidents);
    const approvedIncidentStore = new SheetsEntityStore(client, definitions.approvedIncidents);
    const parseRunStore = new SheetsEntityStore(client, definitions.parseRuns);
    const reviewTaskStore = new SheetsEntityStore(client, definitions.reviewTasks);
    const policyStore = new SheetsEntityStore(client, definitions.policies);
    const interventionStore = new SheetsEntityStore(client, definitions.interventions);
    const notificationStore = new SheetsEntityStore(client, definitions.notifications);
    const auditEventStore = new SheetsEntityStore(client, definitions.auditEvents);

    this.students = new SheetsStudentRepository(studentStore);
    this.guardianContacts = new SheetsGuardianContactRepository(guardianContactStore);
    this.rawIncidents = new SheetsRawIncidentRepository(rawIncidentStore);
    this.approvedIncidents = new SheetsApprovedIncidentRepository(approvedIncidentStore);
    this.parseRuns = new SheetsParseRunRepository(parseRunStore);
    this.reviewTasks = new SheetsReviewTaskRepository(reviewTaskStore);
    this.policies = new SheetsPolicyRepository(policyStore);
    this.interventions = new SheetsInterventionRepository(interventionStore);
    this.notifications = new SheetsNotificationRepository(notificationStore);
    this.auditEvents = new SheetsAuditEventRepository(auditEventStore);

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
      await store.ensureHeaderRow();
    }
  }
}
