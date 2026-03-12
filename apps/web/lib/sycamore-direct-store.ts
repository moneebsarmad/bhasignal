import type { SupabaseClient } from "@supabase/supabase-js";

export type SycamoreSyncStatus = "running" | "success" | "partial" | "failed";
export type SycamoreSyncMode = "initial_backfill" | "incremental" | "manual_range";

export interface SycamoreDisciplineLogRecord {
  id?: string;
  sycamoreLogId: string;
  studentId: string;
  studentRecordId: string | null;
  studentName: string | null;
  grade: string | null;
  schoolId: string;
  incidentDate: string | null;
  points: number;
  level: number | null;
  violation: string | null;
  violationRaw: string | null;
  incidentType: string | null;
  description: string | null;
  resolution: string | null;
  consequence: string | null;
  authorName: string | null;
  authorNameRaw: string | null;
  assignedBy: string | null;
  quarter: string | null;
  createdAtSycamore: string | null;
  managerNotified: boolean | null;
  familyNotified: boolean | null;
  studentNotified: boolean | null;
  detentionId: string | null;
  rawPayload: Record<string, unknown>;
  detentionPayload: Record<string, unknown> | null;
  syncedAt: string;
  createdAt?: string;
}

export interface SycamoreSyncLogRecord {
  id: string;
  triggeredBy: string;
  startedAt: string;
  completedAt: string | null;
  recordsSynced: number;
  recordsDiscovered: number;
  recordsUpserted: number;
  status: SycamoreSyncStatus;
  errorMessage: string | null;
  syncMode: SycamoreSyncMode | null;
  windowStartDate: string | null;
  windowEndDate: string | null;
}

export interface SycamoreStore {
  ensureSchema(): Promise<void>;
  createSyncLog(input: {
    triggeredBy: string;
    syncMode: SycamoreSyncMode;
    windowStartDate: string;
    windowEndDate: string;
  }): Promise<SycamoreSyncLogRecord>;
  updateSyncLog(
    id: string,
    patch: {
      completedAt: string;
      status: SycamoreSyncStatus;
      recordsDiscovered: number;
      recordsSynced: number;
      recordsUpserted: number;
      errorMessage?: string | null;
    }
  ): Promise<void>;
  getLatestSyncLog(): Promise<SycamoreSyncLogRecord | null>;
  getLatestSuccessfulSyncLog(): Promise<SycamoreSyncLogRecord | null>;
  listRecentSyncLogs(limit: number): Promise<SycamoreSyncLogRecord[]>;
  listRecentDisciplineLogs(limit: number): Promise<SycamoreDisciplineLogRecord[]>;
  getSyncCounts(): Promise<{ total: number; failed: number }>;
  getDisciplineCounts(): Promise<{ total: number; linked: number }>;
  resolveStudentRecordLinks(externalStudentIds: string[]): Promise<Map<string, string>>;
  backfillDisciplineLogLinks(studentLinks: Map<string, string>): Promise<number>;
  upsertDisciplineLogs(records: SycamoreDisciplineLogRecord[]): Promise<void>;
}

type RowRecord = Record<string, unknown>;

function toSupabaseErrorMessage(table: string, action: string, error: { message: string }): string {
  return `Supabase ${action} failed for table "${table}": ${error.message}`;
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
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function numberCell(row: RowRecord, key: string): number {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) {
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
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function nullableBooleanCell(row: RowRecord, key: string): boolean | null {
  const value = row[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    if (["true", "t", "yes", "y", "1", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "f", "no", "n", "0", "off"].includes(normalized)) {
      return false;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed !== 0 : null;
  }
  return null;
}

function objectCell(row: RowRecord, key: string): Record<string, unknown> {
  const value = row[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function nullableObjectCell(row: RowRecord, key: string): Record<string, unknown> | null {
  const value = row[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseSyncLog(row: RowRecord): SycamoreSyncLogRecord {
  return {
    id: cell(row, "id"),
    triggeredBy: cell(row, "triggered_by"),
    startedAt: cell(row, "started_at"),
    completedAt: nullableCell(row, "completed_at"),
    recordsSynced: numberCell(row, "records_synced"),
    recordsDiscovered: numberCell(row, "records_discovered"),
    recordsUpserted: numberCell(row, "records_upserted"),
    status: (cell(row, "status") || "failed") as SycamoreSyncStatus,
    errorMessage: nullableCell(row, "error_message"),
    syncMode: (nullableCell(row, "sync_mode") as SycamoreSyncMode | null) ?? null,
    windowStartDate: nullableCell(row, "window_start_date"),
    windowEndDate: nullableCell(row, "window_end_date")
  };
}

export function parseSycamoreDisciplineLogRow(row: RowRecord): SycamoreDisciplineLogRecord {
  return {
    id: cell(row, "id"),
    sycamoreLogId: cell(row, "sycamore_log_id"),
    studentId: cell(row, "student_id"),
    studentRecordId: nullableCell(row, "student_record_id"),
    studentName: nullableCell(row, "student_name"),
    grade: nullableCell(row, "grade"),
    schoolId: cell(row, "school_id"),
    incidentDate: nullableCell(row, "incident_date"),
    points: numberCell(row, "points"),
    level: nullableNumberCell(row, "level"),
    violation: nullableCell(row, "violation"),
    violationRaw: nullableCell(row, "violation_raw"),
    incidentType: nullableCell(row, "incident_type"),
    description: nullableCell(row, "description"),
    resolution: nullableCell(row, "resolution"),
    consequence: nullableCell(row, "consequence"),
    authorName: nullableCell(row, "author_name"),
    authorNameRaw: nullableCell(row, "author_name_raw"),
    assignedBy: nullableCell(row, "assigned_by"),
    quarter: nullableCell(row, "quarter"),
    createdAtSycamore: nullableCell(row, "created_at_sycamore"),
    managerNotified: nullableBooleanCell(row, "manager_notified"),
    familyNotified: nullableBooleanCell(row, "family_notified"),
    studentNotified: nullableBooleanCell(row, "student_notified"),
    detentionId: nullableCell(row, "detention_id"),
    rawPayload: objectCell(row, "raw_payload"),
    detentionPayload: nullableObjectCell(row, "detention_payload"),
    syncedAt: cell(row, "synced_at"),
    createdAt: nullableCell(row, "created_at") ?? undefined
  };
}

function serializeSyncLog(input: {
  triggeredBy: string;
  syncMode: SycamoreSyncMode;
  windowStartDate: string;
  windowEndDate: string;
}): RowRecord {
  return {
    triggered_by: input.triggeredBy,
    status: "running",
    sync_mode: input.syncMode,
    window_start_date: input.windowStartDate,
    window_end_date: input.windowEndDate
  };
}

function serializeDisciplineLog(record: SycamoreDisciplineLogRecord): RowRecord {
  return {
    sycamore_log_id: record.sycamoreLogId,
    student_id: record.studentId,
    student_record_id: record.studentRecordId,
    student_name: record.studentName,
    grade: record.grade,
    school_id: record.schoolId,
    incident_date: record.incidentDate,
    points: record.points,
    level: record.level,
    violation: record.violation,
    violation_raw: record.violationRaw,
    incident_type: record.incidentType,
    description: record.description,
    resolution: record.resolution,
    consequence: record.consequence,
    author_name: record.authorName,
    author_name_raw: record.authorNameRaw,
    assigned_by: record.assignedBy,
    quarter: record.quarter,
    created_at_sycamore: record.createdAtSycamore,
    manager_notified: record.managerNotified,
    family_notified: record.familyNotified,
    student_notified: record.studentNotified,
    detention_id: record.detentionId,
    raw_payload: record.rawPayload,
    detention_payload: record.detentionPayload,
    synced_at: record.syncedAt
  };
}

async function countRows(
  client: SupabaseClient,
  table: string,
  applyFilters?: (query: any) => any
): Promise<number> {
  const baseQuery = client.from(table).select("id", { count: "exact", head: true });
  const query: any = applyFilters ? applyFilters(baseQuery) : baseQuery;
  const { count, error } = await query;
  if (error) {
    throw new Error(toSupabaseErrorMessage(table, "count", error));
  }
  return count ?? 0;
}

export function createSupabaseSycamoreStore(client: SupabaseClient): SycamoreStore {
  return {
    async ensureSchema(): Promise<void> {
      const tables = ["sycamore_discipline_logs", "sycamore_sync_log"] as const;
      for (const table of tables) {
        const { error } = await client.from(table).select("id").limit(1);
        if (error) {
          throw new Error(
            `${toSupabaseErrorMessage(table, "schema check", error)}. Apply the SQL in supabase/schema.sql first.`
          );
        }
      }
    },

    async createSyncLog(input) {
      const { data, error } = await client
        .from("sycamore_sync_log")
        .insert(serializeSyncLog(input))
        .select("*")
        .single();
      if (error) {
        throw new Error(toSupabaseErrorMessage("sycamore_sync_log", "insert", error));
      }
      return parseSyncLog((data as RowRecord | null) ?? {});
    },

    async updateSyncLog(id, patch) {
      const { error } = await client
        .from("sycamore_sync_log")
        .update({
          completed_at: patch.completedAt,
          status: patch.status,
          records_discovered: patch.recordsDiscovered,
          records_synced: patch.recordsSynced,
          records_upserted: patch.recordsUpserted,
          error_message: patch.errorMessage ?? null
        })
        .eq("id", id);
      if (error) {
        throw new Error(toSupabaseErrorMessage("sycamore_sync_log", "update", error));
      }
    },

    async getLatestSyncLog() {
      const { data, error } = await client
        .from("sycamore_sync_log")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        throw new Error(toSupabaseErrorMessage("sycamore_sync_log", "select latest", error));
      }
      return data ? parseSyncLog(data as RowRecord) : null;
    },

    async getLatestSuccessfulSyncLog() {
      const { data, error } = await client
        .from("sycamore_sync_log")
        .select("*")
        .in("status", ["success", "partial"])
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        throw new Error(toSupabaseErrorMessage("sycamore_sync_log", "select latest successful", error));
      }
      return data ? parseSyncLog(data as RowRecord) : null;
    },

    async listRecentSyncLogs(limit) {
      const { data, error } = await client
        .from("sycamore_sync_log")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(limit);
      if (error) {
        throw new Error(toSupabaseErrorMessage("sycamore_sync_log", "select recent", error));
      }
      return ((data as RowRecord[] | null) ?? []).map(parseSyncLog);
    },

    async listRecentDisciplineLogs(limit) {
      const { data, error } = await client
        .from("sycamore_discipline_logs")
        .select("*")
        .order("incident_date", { ascending: false, nullsFirst: false })
        .order("synced_at", { ascending: false })
        .limit(limit);
      if (error) {
        throw new Error(toSupabaseErrorMessage("sycamore_discipline_logs", "select recent", error));
      }
      return ((data as RowRecord[] | null) ?? []).map(parseSycamoreDisciplineLogRow);
    },

    async getSyncCounts() {
      const [total, failed] = await Promise.all([
        countRows(client, "sycamore_sync_log"),
        countRows(client, "sycamore_sync_log", (query) => query.eq("status", "failed"))
      ]);
      return { total, failed };
    },

    async getDisciplineCounts() {
      const [total, linked] = await Promise.all([
        countRows(client, "sycamore_discipline_logs"),
        countRows(client, "sycamore_discipline_logs", (query) => query.not("student_record_id", "is", null))
      ]);
      return { total, linked };
    },

    async resolveStudentRecordLinks(externalStudentIds) {
      const normalizedIds = [...new Set(externalStudentIds.map((value) => value.trim()).filter(Boolean))];
      if (normalizedIds.length === 0) {
        return new Map<string, string>();
      }

      const { data, error } = await client
        .from("students")
        .select("id, external_id")
        .in("external_id", normalizedIds);
      if (error) {
        throw new Error(toSupabaseErrorMessage("students", "resolve external ids", error));
      }

      const result = new Map<string, string>();
      for (const row of (data as RowRecord[] | null) ?? []) {
        const externalId = nullableCell(row, "external_id");
        const id = nullableCell(row, "id");
        if (externalId && id && !result.has(externalId)) {
          result.set(externalId, id);
        }
      }
      return result;
    },

    async backfillDisciplineLogLinks(studentLinks) {
      let linkedRows = 0;
      for (const [externalStudentId, localStudentId] of studentLinks.entries()) {
        const { data, error } = await client
          .from("sycamore_discipline_logs")
          .update({ student_record_id: localStudentId })
          .eq("student_id", externalStudentId)
          .is("student_record_id", null)
          .select("id");
        if (error) {
          throw new Error(toSupabaseErrorMessage("sycamore_discipline_logs", "backfill links", error));
        }
        linkedRows += ((data as RowRecord[] | null) ?? []).length;
      }
      return linkedRows;
    },

    async upsertDisciplineLogs(records) {
      if (records.length === 0) {
        return;
      }

      const { error } = await client
        .from("sycamore_discipline_logs")
        .upsert(records.map(serializeDisciplineLog), { onConflict: "sycamore_log_id" });
      if (error) {
        throw new Error(toSupabaseErrorMessage("sycamore_discipline_logs", "upsert", error));
      }
    }
  };
}
