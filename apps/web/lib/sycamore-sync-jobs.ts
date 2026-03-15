import type { AuditEvent } from "@syc/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase-server-client";
import { createStorageAdapter } from "@/lib/storage";
import {
  createSupabaseSycamoreStore,
  type SycamoreSyncMode,
  type SycamoreSyncStatus,
  type SycamoreStore
} from "@/lib/sycamore-direct-store";
import {
  resolveSycamoreDirectSyncPlan,
  runSycamoreDirectSync,
  sycamoreDirectSyncRequestSchema,
  type SycamoreDirectSyncPlan,
  type SycamoreDirectSyncRequest,
  type SycamoreDirectSyncResult,
  type SycamoreSyncProgressSnapshot
} from "@/lib/sycamore-direct-sync";

export type SycamoreAsyncJobStatus = "queued" | "running" | "succeeded" | "failed";
export type SycamoreSyncBatchStatus = "queued" | "running" | "success" | "partial" | "failed";

export interface SycamoreSyncJobRecord {
  id: string;
  batchId: string;
  sequenceIndex: number;
  totalJobs: number;
  triggeredBy: "manual" | "cron";
  requestPayload: SycamoreDirectSyncRequest;
  syncMode: SycamoreSyncMode;
  window: {
    startDate: string;
    endDate: string;
  };
  status: SycamoreAsyncJobStatus;
  resultStatus: SycamoreSyncStatus | null;
  syncLogId: string | null;
  progress: SycamoreSyncProgressSnapshot | null;
  recordsDiscovered: number;
  recordsUpserted: number;
  warnings: string[];
  warningsCount: number;
  attemptCount: number;
  startedAt: string | null;
  completedAt: string | null;
  lastHeartbeatAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface SycamoreSyncBatchSummary {
  batchId: string;
  syncLogId: string | null;
  status: SycamoreSyncBatchStatus;
  syncMode: SycamoreSyncMode;
  window: {
    startDate: string;
    endDate: string;
  };
  overallWindow: {
    startDate: string;
    endDate: string;
  };
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  activeChunkIndex: number;
  currentWindow: {
    startDate: string;
    endDate: string;
  };
  chunkSizeDays: number;
  recordsDiscovered: number;
  recordsUpserted: number;
  warnings: string[];
  warningsCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  activeJobStartedAt: string | null;
  lastHeartbeatAt: string | null;
  staleAfterMinutes: number;
  isStalled: boolean;
  triggeredBy: "manual" | "cron";
  progress: SycamoreSyncProgressSnapshot | null;
}

export interface EnqueueSycamoreSyncBatchResult {
  batch: SycamoreSyncBatchSummary;
  jobs: SycamoreSyncJobRecord[];
  alreadyQueued: boolean;
}

export interface RunNextSycamoreSyncJobResult {
  job: SycamoreSyncJobRecord | null;
  batch: SycamoreSyncBatchSummary | null;
  executed: boolean;
}

interface CreateSyncJobInput {
  batchId: string;
  sequenceIndex: number;
  totalJobs: number;
  triggeredBy: "manual" | "cron";
  requestPayload: SycamoreDirectSyncRequest;
  syncMode: SycamoreSyncMode;
  windowStartDate: string;
  windowEndDate: string;
}

interface UpdateRunningSyncJobInput {
  syncLogId?: string | null;
  progress?: SycamoreSyncProgressSnapshot | null;
  recordsDiscovered?: number;
  recordsUpserted?: number;
  warnings?: string[];
}

interface CompleteSyncJobInput {
  syncLogId?: string | null;
  resultStatus: SycamoreSyncStatus;
  recordsDiscovered: number;
  recordsUpserted: number;
  warnings: string[];
  completedAt: string;
  errorMessage?: string | null;
}

interface SycamoreSyncJobStore {
  ensureSchema(): Promise<void>;
  createSyncJobs(inputs: CreateSyncJobInput[]): Promise<SycamoreSyncJobRecord[]>;
  listSyncJobs(limit: number): Promise<SycamoreSyncJobRecord[]>;
  listSyncJobsByBatch(batchId: string): Promise<SycamoreSyncJobRecord[]>;
  listActiveSyncJobs(): Promise<SycamoreSyncJobRecord[]>;
  claimNextSyncJob(staleBeforeIso: string): Promise<SycamoreSyncJobRecord | null>;
  updateRunningSyncJob(id: string, patch: UpdateRunningSyncJobInput): Promise<void>;
  completeSyncJob(id: string, patch: CompleteSyncJobInput): Promise<void>;
  failSyncJob(id: string, patch: { errorMessage: string; warnings?: string[] }): Promise<void>;
}

interface SycamoreAuditSink {
  append(event: AuditEvent): Promise<void>;
}

type RowRecord = Record<string, unknown>;

const DEFAULT_MAX_WINDOW_DAYS = 3;
const DEFAULT_STALE_AFTER_MINUTES = 15;

function envNumber(name: string, fallback: number, min = 0): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.trunc(parsed));
}

function maxAsyncWindowDays(): number {
  return envNumber("SYCAMORE_ASYNC_MAX_WINDOW_DAYS", DEFAULT_MAX_WINDOW_DAYS, 1);
}

function staleAfterMinutes(): number {
  return envNumber("SYCAMORE_ASYNC_STALE_AFTER_MINUTES", DEFAULT_STALE_AFTER_MINUTES, 1);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function inclusiveDaySpan(startDate: string, endDate: string): number {
  return Math.floor((Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) / 86_400_000) + 1;
}

function buildSyncWindows(startDate: string, endDate: string, maxDays: number): Array<{ startDate: string; endDate: string }> {
  const windows: Array<{ startDate: string; endDate: string }> = [];
  let cursor = startDate;

  while (cursor <= endDate) {
    const chunkEnd = addDays(cursor, maxDays - 1);
    const windowEnd = chunkEnd < endDate ? chunkEnd : endDate;
    windows.push({ startDate: cursor, endDate: windowEnd });
    cursor = addDays(windowEnd, 1);
  }

  return windows;
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

function objectCell(row: RowRecord, key: string): Record<string, unknown> {
  const value = row[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function nullableObjectCell(row: RowRecord, key: string): Record<string, unknown> | null {
  const value = row[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringArrayCell(row: RowRecord, key: string): string[] {
  const value = row[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function toSupabaseErrorMessage(table: string, action: string, error: { message: string }): string {
  return `Supabase ${action} failed for table "${table}": ${error.message}`;
}

function parseTriggeredBy(value: string | null): "manual" | "cron" {
  return value === "cron" ? "cron" : "manual";
}

function parseSyncJob(row: RowRecord): SycamoreSyncJobRecord {
  return {
    id: cell(row, "id"),
    batchId: cell(row, "batch_id"),
    sequenceIndex: numberCell(row, "sequence_index"),
    totalJobs: numberCell(row, "total_jobs"),
    triggeredBy: parseTriggeredBy(nullableCell(row, "triggered_by")),
    requestPayload: sycamoreDirectSyncRequestSchema.parse(objectCell(row, "request_payload")),
    syncMode: (cell(row, "sync_mode") || "manual_range") as SycamoreSyncMode,
    window: {
      startDate: cell(row, "window_start_date"),
      endDate: cell(row, "window_end_date")
    },
    status: (cell(row, "status") || "queued") as SycamoreAsyncJobStatus,
    resultStatus: (nullableCell(row, "result_status") as SycamoreSyncStatus | null) ?? null,
    syncLogId: nullableCell(row, "sync_log_id"),
    progress: (nullableObjectCell(row, "progress_payload") as SycamoreSyncProgressSnapshot | null) ?? null,
    recordsDiscovered: numberCell(row, "records_discovered"),
    recordsUpserted: numberCell(row, "records_upserted"),
    warnings: stringArrayCell(row, "warnings_json"),
    warningsCount: numberCell(row, "warnings_count"),
    attemptCount: numberCell(row, "attempt_count"),
    startedAt: nullableCell(row, "started_at"),
    completedAt: nullableCell(row, "completed_at"),
    lastHeartbeatAt: nullableCell(row, "last_heartbeat_at"),
    errorMessage: nullableCell(row, "error_message"),
    createdAt: cell(row, "created_at")
  };
}

function serializeSyncJob(input: CreateSyncJobInput): RowRecord {
  return {
    batch_id: input.batchId,
    sequence_index: input.sequenceIndex,
    total_jobs: input.totalJobs,
    triggered_by: input.triggeredBy,
    request_payload: input.requestPayload,
    sync_mode: input.syncMode,
    window_start_date: input.windowStartDate,
    window_end_date: input.windowEndDate,
    status: "queued"
  };
}

function chunkSizeDays(jobs: SycamoreSyncJobRecord[]): number {
  return Math.max(...jobs.map((job) => inclusiveDaySpan(job.window.startDate, job.window.endDate)), 1);
}

export function summarizeSycamoreSyncBatch(
  jobs: SycamoreSyncJobRecord[],
  options?: {
    nowIso?: string;
  }
): SycamoreSyncBatchSummary | null {
  if (jobs.length === 0) {
    return null;
  }

  const nowIso = options?.nowIso ?? new Date().toISOString();
  const staleMinutes = staleAfterMinutes();
  const sorted = [...jobs].sort((left, right) => left.sequenceIndex - right.sequenceIndex || left.createdAt.localeCompare(right.createdAt));
  const totalChunks = sorted.length;
  const completedChunks = sorted.filter((job) => job.status === "succeeded" || job.status === "failed").length;
  const failedChunks = sorted.filter((job) => job.status === "failed").length;
  const runningJob = sorted.find((job) => job.status === "running") ?? null;
  const queuedJob = sorted.find((job) => job.status === "queued") ?? null;
  const activeJob = runningJob ?? queuedJob ?? sorted.at(-1) ?? sorted[0] ?? null;
  const resultStatuses = sorted.map((job) => job.resultStatus).filter((value): value is SycamoreSyncStatus => Boolean(value));
  const status: SycamoreSyncBatchStatus = runningJob
    ? "running"
    : queuedJob
      ? "queued"
      : failedChunks > 0
        ? "failed"
        : resultStatuses.includes("partial")
          ? "partial"
          : "success";
  const createdAt = sorted.map((job) => job.createdAt).sort((left, right) => left.localeCompare(right))[0] ?? sorted[0]!.createdAt;
  const startedAt =
    sorted
      .map((job) => job.startedAt)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => left.localeCompare(right))[0] ?? null;
  const completedAt =
    completedChunks === totalChunks
      ? [...sorted]
          .map((job) => job.completedAt)
          .filter((value): value is string => Boolean(value))
          .sort((left, right) => right.localeCompare(left))[0] ?? null
      : null;
  const activeJobStartedAt = activeJob?.startedAt ?? null;
  const lastHeartbeatAt = activeJob?.lastHeartbeatAt ?? activeJob?.startedAt ?? null;
  const isStalled = Boolean(runningJob && lastHeartbeatAt && lastHeartbeatAt < staleBeforeIso(nowIso, staleMinutes));

  return {
    batchId: sorted[0]!.batchId,
    syncLogId: activeJob?.syncLogId ?? [...sorted].map((job) => job.syncLogId).find((value): value is string => Boolean(value)) ?? null,
    status,
    syncMode: sorted[0]!.syncMode,
    window: {
      startDate: [...sorted].map((job) => job.window.startDate).sort((left, right) => left.localeCompare(right))[0] ?? sorted[0]!.window.startDate,
      endDate: [...sorted].map((job) => job.window.endDate).sort((left, right) => right.localeCompare(left))[0] ?? sorted[0]!.window.endDate
    },
    overallWindow: {
      startDate: [...sorted].map((job) => job.window.startDate).sort((left, right) => left.localeCompare(right))[0] ?? sorted[0]!.window.startDate,
      endDate: [...sorted].map((job) => job.window.endDate).sort((left, right) => right.localeCompare(left))[0] ?? sorted[0]!.window.endDate
    },
    totalChunks,
    completedChunks,
    failedChunks,
    activeChunkIndex: activeJob?.sequenceIndex ?? Math.max(0, completedChunks - 1),
    currentWindow: activeJob?.window ?? sorted[0]!.window,
    chunkSizeDays: chunkSizeDays(sorted),
    recordsDiscovered: sorted.reduce((total, job) => total + job.recordsDiscovered, 0),
    recordsUpserted: sorted.reduce((total, job) => total + job.recordsUpserted, 0),
    warnings: sorted.flatMap((job) => job.warnings),
    warningsCount: sorted.reduce((total, job) => total + job.warningsCount, 0),
    createdAt,
    startedAt,
    completedAt,
    activeJobStartedAt,
    lastHeartbeatAt,
    staleAfterMinutes: staleMinutes,
    isStalled,
    triggeredBy: sorted[0]!.triggeredBy,
    progress: runningJob?.progress ?? null
  };
}

function buildJobWindowRequest(
  request: SycamoreDirectSyncRequest,
  window: { startDate: string; endDate: string }
): SycamoreDirectSyncRequest {
  return sycamoreDirectSyncRequestSchema.parse({
    ...request,
    incremental: undefined,
    startDate: window.startDate,
    endDate: window.endDate
  });
}

function createDefaultSyncStore(): SycamoreStore {
  return createSupabaseSycamoreStore(createSupabaseServerClient());
}

function createDefaultJobStore(): SycamoreSyncJobStore {
  return createSupabaseSycamoreSyncJobStore(createSupabaseServerClient());
}

function createDefaultAuditSink(): SycamoreAuditSink {
  return createStorageAdapter().auditEvents;
}

function staleBeforeIso(nowIso: string, minutesAgo = staleAfterMinutes()): string {
  const stale = new Date(nowIso);
  stale.setUTCMinutes(stale.getUTCMinutes() - minutesAgo);
  return stale.toISOString();
}

function defaultAuditActor(triggeredBy: "manual" | "cron", actorEmail?: string): string {
  if (actorEmail?.trim()) {
    return actorEmail.trim().toLowerCase();
  }
  return triggeredBy === "cron" ? "system:cron" : "system:sycamore";
}

function createAuditEvent(input: {
  eventType: string;
  entityType: string;
  entityId: string;
  actor: string;
  payload: unknown;
}): AuditEvent {
  return {
    id: crypto.randomUUID(),
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: input.entityId,
    actor: input.actor,
    payloadJson: JSON.stringify(input.payload),
    createdAt: new Date().toISOString()
  };
}

async function appendAuditEventSafe(auditSink: SycamoreAuditSink, event: AuditEvent): Promise<void> {
  try {
    await auditSink.append(event);
  } catch (error) {
    console.error("Failed to append Sycamore async audit event.", error);
  }
}

function batchTerminalEventType(summary: SycamoreSyncBatchSummary): string | null {
  if (summary.status === "success" || summary.status === "partial") {
    return "sycamore_sync_batch_completed";
  }
  if (summary.status === "failed") {
    return "sycamore_sync_batch_failed";
  }
  return null;
}

function createBatchQueuedAuditEvent(input: {
  batch: SycamoreSyncBatchSummary;
  jobs: SycamoreSyncJobRecord[];
  request: SycamoreDirectSyncRequest;
  actor: string;
}): AuditEvent {
  return createAuditEvent({
    eventType: "sycamore_sync_batch_queued",
    entityType: "sycamore_sync_batch",
    entityId: input.batch.batchId,
    actor: input.actor,
    payload: {
      triggeredBy: input.batch.triggeredBy,
      syncMode: input.batch.syncMode,
      totalChunks: input.batch.totalChunks,
      chunkSizeDays: input.batch.chunkSizeDays,
      overallWindow: input.batch.overallWindow,
      currentWindow: input.batch.currentWindow,
      request: input.request,
      jobs: input.jobs.map((job) => ({
        id: job.id,
        sequenceIndex: job.sequenceIndex,
        window: job.window
      }))
    }
  });
}

function createJobStartedAuditEvent(input: {
  job: SycamoreSyncJobRecord;
  actor: string;
}): AuditEvent {
  return createAuditEvent({
    eventType: "sycamore_sync_job_started",
    entityType: "sycamore_sync_job",
    entityId: input.job.id,
    actor: input.actor,
    payload: {
      batchId: input.job.batchId,
      sequenceIndex: input.job.sequenceIndex,
      totalJobs: input.job.totalJobs,
      triggeredBy: input.job.triggeredBy,
      syncMode: input.job.syncMode,
      window: input.job.window,
      attemptCount: input.job.attemptCount,
      startedAt: input.job.startedAt,
      request: input.job.requestPayload
    }
  });
}

function createJobFinishedAuditEvent(input: {
  job: SycamoreSyncJobRecord;
  actor: string;
}): AuditEvent {
  return createAuditEvent({
    eventType: input.job.resultStatus === "failed" ? "sycamore_sync_job_failed" : "sycamore_sync_job_completed",
    entityType: "sycamore_sync_job",
    entityId: input.job.id,
    actor: input.actor,
    payload: {
      batchId: input.job.batchId,
      sequenceIndex: input.job.sequenceIndex,
      totalJobs: input.job.totalJobs,
      triggeredBy: input.job.triggeredBy,
      syncMode: input.job.syncMode,
      window: input.job.window,
      status: input.job.resultStatus ?? input.job.status,
      syncLogId: input.job.syncLogId,
      recordsDiscovered: input.job.recordsDiscovered,
      recordsUpserted: input.job.recordsUpserted,
      warnings: input.job.warnings,
      errorMessage: input.job.errorMessage,
      startedAt: input.job.startedAt,
      completedAt: input.job.completedAt
    }
  });
}

function createBatchFinishedAuditEvent(input: {
  batch: SycamoreSyncBatchSummary;
  actor: string;
}): AuditEvent | null {
  const eventType = batchTerminalEventType(input.batch);
  if (!eventType) {
    return null;
  }

  return createAuditEvent({
    eventType,
    entityType: "sycamore_sync_batch",
    entityId: input.batch.batchId,
    actor: input.actor,
    payload: {
      triggeredBy: input.batch.triggeredBy,
      syncMode: input.batch.syncMode,
      status: input.batch.status,
      overallWindow: input.batch.overallWindow,
      totalChunks: input.batch.totalChunks,
      completedChunks: input.batch.completedChunks,
      failedChunks: input.batch.failedChunks,
      recordsDiscovered: input.batch.recordsDiscovered,
      recordsUpserted: input.batch.recordsUpserted,
      warnings: input.batch.warnings,
      completedAt: input.batch.completedAt
    }
  });
}

export function createSupabaseSycamoreSyncJobStore(client: SupabaseClient): SycamoreSyncJobStore {
  return {
    async ensureSchema() {
      const { error } = await client.from("sycamore_sync_jobs").select("id").limit(1);
      if (error) {
        throw new Error(
          `${toSupabaseErrorMessage("sycamore_sync_jobs", "schema check", error)}. Apply the SQL in supabase/schema.sql first.`
        );
      }
    },

    async createSyncJobs(inputs) {
      if (inputs.length === 0) {
        return [];
      }

      const { data, error } = await client
        .from("sycamore_sync_jobs")
        .insert(inputs.map(serializeSyncJob))
        .select("*")
        .order("sequence_index", { ascending: true });
      if (error) {
        throw new Error(toSupabaseErrorMessage("sycamore_sync_jobs", "insert", error));
      }
      return ((data as RowRecord[] | null) ?? []).map(parseSyncJob);
    },

    async listSyncJobs(limit) {
      const { data, error } = await client
        .from("sycamore_sync_jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) {
        throw new Error(toSupabaseErrorMessage("sycamore_sync_jobs", "select recent", error));
      }
      return ((data as RowRecord[] | null) ?? []).map(parseSyncJob);
    },

    async listSyncJobsByBatch(batchId) {
      const { data, error } = await client
        .from("sycamore_sync_jobs")
        .select("*")
        .eq("batch_id", batchId)
        .order("sequence_index", { ascending: true });
      if (error) {
        throw new Error(toSupabaseErrorMessage("sycamore_sync_jobs", "select batch", error));
      }
      return ((data as RowRecord[] | null) ?? []).map(parseSyncJob);
    },

    async listActiveSyncJobs() {
      const { data, error } = await client
        .from("sycamore_sync_jobs")
        .select("*")
        .in("status", ["queued", "running"])
        .order("created_at", { ascending: true })
        .order("sequence_index", { ascending: true });
      if (error) {
        throw new Error(toSupabaseErrorMessage("sycamore_sync_jobs", "select active", error));
      }
      return ((data as RowRecord[] | null) ?? []).map(parseSyncJob);
    },

    async claimNextSyncJob(staleBefore) {
      const { data: activeRows, error: activeError } = await client
        .from("sycamore_sync_jobs")
        .select("*")
        .eq("status", "running")
        .gte("last_heartbeat_at", staleBefore)
        .order("started_at", { ascending: true })
        .limit(1);
      if (activeError) {
        throw new Error(toSupabaseErrorMessage("sycamore_sync_jobs", "select running", activeError));
      }
      if (((activeRows as RowRecord[] | null) ?? []).length > 0) {
        return null;
      }

      const { data, error } = await client
        .from("sycamore_sync_jobs")
        .select("*")
        .or(`status.eq.queued,and(status.eq.running,last_heartbeat_at.lt.${staleBefore})`)
        .order("created_at", { ascending: true })
        .order("sequence_index", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) {
        throw new Error(toSupabaseErrorMessage("sycamore_sync_jobs", "select next claimable", error));
      }
      if (!data) {
        return null;
      }

      const candidate = parseSyncJob(data as RowRecord);
      const nowIso = new Date().toISOString();
      const { data: updated, error: updateError } = await client
        .from("sycamore_sync_jobs")
        .update({
          status: "running",
          started_at: candidate.startedAt ?? nowIso,
          completed_at: null,
          last_heartbeat_at: nowIso,
          attempt_count: candidate.attemptCount + 1,
          error_message: null
        })
        .eq("id", candidate.id)
        .eq("status", candidate.status)
        .select("*")
        .maybeSingle();
      if (updateError) {
        throw new Error(toSupabaseErrorMessage("sycamore_sync_jobs", "claim", updateError));
      }
      return updated ? parseSyncJob(updated as RowRecord) : null;
    },

    async updateRunningSyncJob(id, patch) {
      const nowIso = new Date().toISOString();
      const { error } = await client
        .from("sycamore_sync_jobs")
        .update({
          status: "running",
          sync_log_id: patch.syncLogId ?? undefined,
          progress_payload: patch.progress ?? undefined,
          records_discovered: patch.recordsDiscovered ?? undefined,
          records_upserted: patch.recordsUpserted ?? undefined,
          warnings_json: patch.warnings ?? undefined,
          warnings_count: patch.warnings?.length ?? undefined,
          last_heartbeat_at: nowIso
        })
        .eq("id", id);
      if (error) {
        throw new Error(toSupabaseErrorMessage("sycamore_sync_jobs", "update running", error));
      }
    },

    async completeSyncJob(id, patch) {
      const { error } = await client
        .from("sycamore_sync_jobs")
        .update({
          status: patch.resultStatus === "failed" ? "failed" : "succeeded",
          result_status: patch.resultStatus,
          sync_log_id: patch.syncLogId ?? null,
          records_discovered: patch.recordsDiscovered,
          records_upserted: patch.recordsUpserted,
          warnings_json: patch.warnings,
          warnings_count: patch.warnings.length,
          completed_at: patch.completedAt,
          last_heartbeat_at: patch.completedAt,
          error_message: patch.errorMessage ?? null
        })
        .eq("id", id);
      if (error) {
        throw new Error(toSupabaseErrorMessage("sycamore_sync_jobs", "complete", error));
      }
    },

    async failSyncJob(id, patch) {
      const completedAt = new Date().toISOString();
      const { error } = await client
        .from("sycamore_sync_jobs")
        .update({
          status: "failed",
          result_status: "failed",
          warnings_json: patch.warnings ?? [],
          warnings_count: patch.warnings?.length ?? 0,
          completed_at: completedAt,
          last_heartbeat_at: completedAt,
          error_message: patch.errorMessage
        })
        .eq("id", id);
      if (error) {
        throw new Error(toSupabaseErrorMessage("sycamore_sync_jobs", "fail", error));
      }
    }
  };
}

export async function getActiveSycamoreSyncBatchSummary(input?: {
  jobStore?: SycamoreSyncJobStore;
}): Promise<SycamoreSyncBatchSummary | null> {
  const jobStore = input?.jobStore ?? createDefaultJobStore();
  await jobStore.ensureSchema();
  const activeJobs = await jobStore.listActiveSyncJobs();
  if (activeJobs.length === 0) {
    return null;
  }
  const batchId = activeJobs[0]!.batchId;
  const batchJobs = await jobStore.listSyncJobsByBatch(batchId);
  return summarizeSycamoreSyncBatch(batchJobs);
}

export async function getSycamoreSyncBatchSummary(input: {
  batchId: string;
  jobStore?: SycamoreSyncJobStore;
}): Promise<SycamoreSyncBatchSummary | null> {
  const jobStore = input.jobStore ?? createDefaultJobStore();
  await jobStore.ensureSchema();
  const jobs = await jobStore.listSyncJobsByBatch(input.batchId);
  return summarizeSycamoreSyncBatch(jobs);
}

export async function listRecentSycamoreSyncBatches(input?: {
  limit?: number;
  jobStore?: SycamoreSyncJobStore;
}): Promise<SycamoreSyncBatchSummary[]> {
  const limit = input?.limit ?? 25;
  const jobStore = input?.jobStore ?? createDefaultJobStore();
  await jobStore.ensureSchema();
  const jobs = await jobStore.listSyncJobs(limit * 8);
  const byBatchId = new Map<string, SycamoreSyncJobRecord[]>();
  for (const job of jobs) {
    const entries = byBatchId.get(job.batchId) ?? [];
    entries.push(job);
    byBatchId.set(job.batchId, entries);
  }
  return [...byBatchId.values()]
    .map((batchJobs) => summarizeSycamoreSyncBatch(batchJobs))
    .filter((value): value is SycamoreSyncBatchSummary => Boolean(value))
    .sort((left, right) => (right.startedAt ?? right.createdAt).localeCompare(left.startedAt ?? left.createdAt))
    .slice(0, limit);
}

export async function enqueueSycamoreSyncBatch(input: {
  request?: SycamoreDirectSyncRequest;
  triggeredBy: "manual" | "cron";
  actorEmail?: string;
  syncStore?: SycamoreStore;
  jobStore?: SycamoreSyncJobStore;
  auditSink?: SycamoreAuditSink;
}): Promise<EnqueueSycamoreSyncBatchResult> {
  const syncStore = input.syncStore ?? createDefaultSyncStore();
  const jobStore = input.jobStore ?? createDefaultJobStore();
  const auditSink = input.auditSink ?? createDefaultAuditSink();
  await syncStore.ensureSchema();
  await jobStore.ensureSchema();

  const existingActiveBatch = await getActiveSycamoreSyncBatchSummary({ jobStore });
  if (existingActiveBatch) {
    const existingJobs = await jobStore.listSyncJobsByBatch(existingActiveBatch.batchId);
    return {
      batch: existingActiveBatch,
      jobs: existingJobs,
      alreadyQueued: true
    };
  }

  const request = sycamoreDirectSyncRequestSchema.parse(input.request ?? {});
  const plan = await resolveSycamoreDirectSyncPlan({
    request,
    store: syncStore
  });
  const windows =
    inclusiveDaySpan(plan.window.startDate, plan.window.endDate) > maxAsyncWindowDays()
      ? buildSyncWindows(plan.window.startDate, plan.window.endDate, maxAsyncWindowDays())
      : [plan.window];
  const batchId = crypto.randomUUID();
  const jobs = await jobStore.createSyncJobs(
    windows.map((window, index) => ({
      batchId,
      sequenceIndex: index,
      totalJobs: windows.length,
      triggeredBy: input.triggeredBy,
      requestPayload: buildJobWindowRequest(request, window),
      syncMode: plan.syncMode,
      windowStartDate: window.startDate,
      windowEndDate: window.endDate
    }))
  );
  const batch = summarizeSycamoreSyncBatch(jobs);
  if (!batch) {
    throw new Error("Could not build the queued Sycamore sync batch.");
  }
  await appendAuditEventSafe(
    auditSink,
    createBatchQueuedAuditEvent({
      batch,
      jobs,
      request,
      actor: defaultAuditActor(input.triggeredBy, input.actorEmail)
    })
  );
  return {
    batch,
    jobs,
    alreadyQueued: false
  };
}

export async function runNextQueuedSycamoreSyncJob(input?: {
  syncStore?: SycamoreStore;
  jobStore?: SycamoreSyncJobStore;
  actorEmail?: string;
  auditSink?: SycamoreAuditSink;
  runSync?: typeof runSycamoreDirectSync;
}): Promise<RunNextSycamoreSyncJobResult> {
  const syncStore = input?.syncStore ?? createDefaultSyncStore();
  const jobStore = input?.jobStore ?? createDefaultJobStore();
  const auditSink = input?.auditSink ?? createDefaultAuditSink();
  const runSync = input?.runSync ?? runSycamoreDirectSync;
  await syncStore.ensureSchema();
  await jobStore.ensureSchema();

  const job = await jobStore.claimNextSyncJob(staleBeforeIso(new Date().toISOString()));
  if (!job) {
    return {
      job: null,
      batch: await getActiveSycamoreSyncBatchSummary({ jobStore }),
      executed: false
    };
  }

  const auditActor = defaultAuditActor(job.triggeredBy, input?.actorEmail);
  await appendAuditEventSafe(
    auditSink,
    createJobStartedAuditEvent({
      job,
      actor: auditActor
    })
  );

  try {
    const result = await runSync({
      request: job.requestPayload,
      triggeredBy: job.triggeredBy,
      store: syncStore,
      resolvedPlan: {
        syncMode: job.syncMode,
        window: job.window
      },
      onProgress: async (progress) => {
        await jobStore.updateRunningSyncJob(job.id, {
          syncLogId: progress.syncLogId,
          progress,
          recordsDiscovered: progress.discoveredRecords,
          recordsUpserted: progress.recordsUpserted
        });
      }
    });

    await jobStore.completeSyncJob(job.id, {
      syncLogId: result.syncLogId,
      resultStatus: result.status,
      recordsDiscovered: result.recordsDiscovered,
      recordsUpserted: result.recordsUpserted,
      warnings: result.warnings,
      completedAt: result.completedAt,
      errorMessage: result.status === "failed" ? result.warnings.join("\n") || "Sycamore sync failed." : null
    });

    const completedJob: SycamoreSyncJobRecord = {
      ...job,
      status: result.status === "failed" ? "failed" : "succeeded",
      resultStatus: result.status,
      syncLogId: result.syncLogId,
      recordsDiscovered: result.recordsDiscovered,
      recordsUpserted: result.recordsUpserted,
      warnings: result.warnings,
      warningsCount: result.warnings.length,
      startedAt: job.startedAt ?? result.startedAt,
      completedAt: result.completedAt,
      lastHeartbeatAt: result.completedAt,
      errorMessage: result.status === "failed" ? result.warnings.join("\n") || "Sycamore sync failed." : null
    };
    await appendAuditEventSafe(
      auditSink,
      createJobFinishedAuditEvent({
        job: completedJob,
        actor: auditActor
      })
    );

    const batch = await getSycamoreSyncBatchSummary({ batchId: job.batchId, jobStore });
    const batchFinishedEvent = batch ? createBatchFinishedAuditEvent({ batch, actor: auditActor }) : null;
    if (batchFinishedEvent) {
      await appendAuditEventSafe(auditSink, batchFinishedEvent);
    }

    return {
      job: completedJob,
      batch,
      executed: true
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Sycamore async worker failure.";
    await jobStore.failSyncJob(job.id, {
      errorMessage: message
    });
    const failedJob: SycamoreSyncJobRecord = {
      ...job,
      status: "failed",
      resultStatus: "failed",
      errorMessage: message
    };
    await appendAuditEventSafe(
      auditSink,
      createJobFinishedAuditEvent({
        job: failedJob,
        actor: auditActor
      })
    );
    const batch = await getSycamoreSyncBatchSummary({ batchId: job.batchId, jobStore });
    const batchFinishedEvent = batch ? createBatchFinishedAuditEvent({ batch, actor: auditActor }) : null;
    if (batchFinishedEvent) {
      await appendAuditEventSafe(auditSink, batchFinishedEvent);
    }
    return {
      job: failedJob,
      batch,
      executed: true
    };
  }
}
