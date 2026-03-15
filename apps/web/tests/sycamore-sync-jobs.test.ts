import assert from "node:assert/strict";
import test from "node:test";

import type { AuditEvent } from "@syc/domain";
import type { SycamoreStore } from "../lib/sycamore-direct-store";
import type { SycamoreSyncProgressSnapshot } from "../lib/sycamore-direct-sync";
import {
  enqueueSycamoreSyncBatch,
  runNextQueuedSycamoreSyncJob,
  summarizeSycamoreSyncBatch,
  type SycamoreSyncJobRecord
} from "../lib/sycamore-sync-jobs";

function withEnv<T>(updates: Record<string, string | undefined>, run: () => Promise<T> | T): Promise<T> | T {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(updates)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };

  try {
    const result = run();
    if (result instanceof Promise) {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function inclusiveDaySpan(startDate: string, endDate: string): number {
  return Math.floor((Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) / 86_400_000) + 1;
}

function makeProgress(overrides: Partial<SycamoreSyncProgressSnapshot> = {}): SycamoreSyncProgressSnapshot {
  return {
    syncLogId: "sync_progress_1",
    syncMode: "manual_range",
    window: {
      startDate: "2026-03-15",
      endDate: "2026-03-28"
    },
    startedAt: "2026-03-20T12:00:00.000Z",
    updatedAt: "2026-03-20T12:01:00.000Z",
    stage: "detail_fetch",
    stageIndex: 2,
    stageCount: 4,
    stageLabel: "Detail fetch",
    stageDescription: "Loading the detail rows for discovered incidents.",
    stageProgress: 0.5,
    overallProgress: 0.68,
    rosterStudentsFetched: 1259,
    rosterStudentsUpserted: 1259,
    rosterStudentsLinked: 1259,
    discoveryStudentsProcessed: 12,
    discoveryStudentsTotal: 12,
    discoveredRecords: 7,
    detailRecordsProcessed: 3,
    detailRecordsTotal: 6,
    recordsUpserted: 0,
    warningsCount: 1,
    message: "Fetched detail for 3 of 6 records.",
    ...overrides
  };
}

function makeJob(overrides: Partial<SycamoreSyncJobRecord> = {}): SycamoreSyncJobRecord {
  return {
    id: "job_1",
    batchId: "batch_1",
    sequenceIndex: 0,
    totalJobs: 1,
    triggeredBy: "manual",
    requestPayload: {
      startDate: "2026-03-01",
      endDate: "2026-03-14"
    },
    syncMode: "manual_range",
    window: {
      startDate: "2026-03-01",
      endDate: "2026-03-14"
    },
    status: "queued",
    resultStatus: null,
    syncLogId: null,
    progress: null,
    recordsDiscovered: 0,
    recordsUpserted: 0,
    warnings: [],
    warningsCount: 0,
    attemptCount: 0,
    startedAt: null,
    completedAt: null,
    lastHeartbeatAt: null,
    errorMessage: null,
    createdAt: "2026-03-20T12:00:00.000Z",
    ...overrides
  };
}

function createMinimalSyncStore(): SycamoreStore {
  return {
    async ensureSchema() {},
    async createSyncLog() {
      throw new Error("Not used in async enqueue tests.");
    },
    async updateSyncLog() {
      throw new Error("Not used in async enqueue tests.");
    },
    async getLatestSyncLog() {
      return null;
    },
    async getLatestSuccessfulSyncLog() {
      return null;
    },
    async listRecentSyncLogs() {
      return [];
    },
    async listRecentDisciplineLogs() {
      return [];
    },
    async getSyncCounts() {
      return { total: 0, failed: 0 };
    },
    async getDisciplineCounts() {
      return { total: 0, linked: 0 };
    },
    async resolveStudentRecordLinks() {
      return new Map();
    },
    async backfillDisciplineLogLinks() {
      return 0;
    },
    async findExistingDisciplineLogIds() {
      return new Set();
    },
    async upsertDisciplineLogs() {}
  };
}

test("summarizeSycamoreSyncBatch reports the active running job and aggregate counts", () => {
  const summary = summarizeSycamoreSyncBatch([
    makeJob({
      id: "job_0",
      sequenceIndex: 0,
      totalJobs: 3,
      status: "succeeded",
      resultStatus: "success",
      syncLogId: "sync_0",
      startedAt: "2026-03-20T12:00:00.000Z",
      completedAt: "2026-03-20T12:01:00.000Z",
      recordsDiscovered: 4,
      recordsUpserted: 4,
      window: { startDate: "2026-03-01", endDate: "2026-03-14" }
    }),
    makeJob({
      id: "job_1",
      sequenceIndex: 1,
      totalJobs: 3,
      status: "running",
      syncLogId: "sync_1",
      progress: makeProgress(),
      startedAt: "2026-03-20T12:02:00.000Z",
      recordsDiscovered: 7,
      recordsUpserted: 0,
      warnings: ["detail_retry:1"],
      warningsCount: 1,
      window: { startDate: "2026-03-15", endDate: "2026-03-28" }
    }),
    makeJob({
      id: "job_2",
      sequenceIndex: 2,
      totalJobs: 3,
      status: "queued",
      window: { startDate: "2026-03-29", endDate: "2026-03-31" }
    })
  ]);

  assert.ok(summary);
  assert.equal(summary.createdAt, "2026-03-20T12:00:00.000Z");
  assert.equal(summary.startedAt, "2026-03-20T12:00:00.000Z");
  assert.equal(summary.activeJobStartedAt, "2026-03-20T12:02:00.000Z");
  assert.equal(summary.lastHeartbeatAt, "2026-03-20T12:02:00.000Z");
  assert.equal(summary.isStalled, false);
  assert.equal(summary.status, "running");
  assert.equal(summary.completedChunks, 1);
  assert.equal(summary.failedChunks, 0);
  assert.equal(summary.activeChunkIndex, 1);
  assert.deepEqual(summary.currentWindow, {
    startDate: "2026-03-15",
    endDate: "2026-03-28"
  });
  assert.deepEqual(summary.overallWindow, {
    startDate: "2026-03-01",
    endDate: "2026-03-31"
  });
  assert.equal(summary.chunkSizeDays, 14);
  assert.equal(summary.recordsDiscovered, 11);
  assert.equal(summary.recordsUpserted, 4);
  assert.equal(summary.warningsCount, 1);
  assert.equal(summary.progress?.stage, "detail_fetch");
});

test("summarizeSycamoreSyncBatch exposes failed job details when a chunk fails", () => {
  const summary = summarizeSycamoreSyncBatch([
    makeJob({
      id: "job_success_1",
      sequenceIndex: 0,
      totalJobs: 3,
      status: "succeeded",
      resultStatus: "success",
      syncLogId: "sync_success_1",
      startedAt: "2026-03-20T12:00:00.000Z",
      completedAt: "2026-03-20T12:02:00.000Z",
      recordsDiscovered: 12,
      recordsUpserted: 9,
      window: { startDate: "2026-03-01", endDate: "2026-03-03" }
    }),
    makeJob({
      id: "job_failed_2",
      sequenceIndex: 1,
      totalJobs: 3,
      status: "failed",
      resultStatus: null,
      startedAt: "2026-03-20T12:03:00.000Z",
      completedAt: "2026-03-20T12:04:00.000Z",
      errorMessage: "Parser request timed out while fetching student detail.",
      warnings: ["sycamore_student_overview_discovery_used:2026-03-04:2026-03-06:603"],
      warningsCount: 1,
      window: { startDate: "2026-03-04", endDate: "2026-03-06" }
    }),
    makeJob({
      id: "job_success_3",
      sequenceIndex: 2,
      totalJobs: 3,
      status: "succeeded",
      resultStatus: "success",
      syncLogId: "sync_success_3",
      startedAt: "2026-03-20T12:05:00.000Z",
      completedAt: "2026-03-20T12:06:00.000Z",
      recordsDiscovered: 7,
      recordsUpserted: 5,
      window: { startDate: "2026-03-07", endDate: "2026-03-09" }
    })
  ]);

  assert.ok(summary);
  assert.equal(summary.status, "failed");
  assert.equal(summary.completedChunks, 3);
  assert.equal(summary.failedChunks, 1);
  assert.equal(summary.recordsUpserted, 14);
  assert.equal(summary.failedJobs.length, 1);
  assert.deepEqual(summary.failedJobs[0], {
    jobId: "job_failed_2",
    sequenceIndex: 1,
    window: { startDate: "2026-03-04", endDate: "2026-03-06" },
    syncLogId: null,
    errorMessage: "Parser request timed out while fetching student detail.",
    warnings: ["sycamore_student_overview_discovery_used:2026-03-04:2026-03-06:603"],
    warningsCount: 1,
    completedAt: "2026-03-20T12:04:00.000Z"
  });
});

test("summarizeSycamoreSyncBatch flags stale running jobs from heartbeat age", () => {
  const summary = withEnv(
    {
      SYCAMORE_ASYNC_STALE_AFTER_MINUTES: "15"
    },
    () =>
      summarizeSycamoreSyncBatch(
        [
          makeJob({
            id: "job_stale_1",
            status: "running",
            startedAt: "2026-03-20T12:00:00.000Z",
            lastHeartbeatAt: "2026-03-20T12:03:00.000Z",
            progress: makeProgress()
          })
        ],
        {
          nowIso: "2026-03-20T12:25:00.000Z"
        }
      )
  ) as ReturnType<typeof summarizeSycamoreSyncBatch>;

  assert.ok(summary);
  assert.equal(summary.status, "running");
  assert.equal(summary.startedAt, "2026-03-20T12:00:00.000Z");
  assert.equal(summary.activeJobStartedAt, "2026-03-20T12:00:00.000Z");
  assert.equal(summary.lastHeartbeatAt, "2026-03-20T12:03:00.000Z");
  assert.equal(summary.staleAfterMinutes, 15);
  assert.equal(summary.isStalled, true);
});

test("enqueueSycamoreSyncBatch splits wide manual ranges into queued windows", async () => {
  const createdJobs: SycamoreSyncJobRecord[] = [];
  const jobStore: NonNullable<Parameters<typeof runNextQueuedSycamoreSyncJob>[0]>["jobStore"] = {
    async ensureSchema() {},
    async createSyncJobs(
      inputs: Array<{
        batchId: string;
        sequenceIndex: number;
        totalJobs: number;
        triggeredBy: "manual" | "cron";
        requestPayload: { startDate?: string; endDate?: string; incremental?: boolean };
        syncMode: "initial_backfill" | "incremental" | "manual_range";
        windowStartDate: string;
        windowEndDate: string;
      }>
    ) {
      const rows = inputs.map((input) =>
        makeJob({
          id: `job_${input.sequenceIndex + 1}`,
          batchId: input.batchId,
          sequenceIndex: input.sequenceIndex,
          totalJobs: input.totalJobs,
          triggeredBy: input.triggeredBy,
          requestPayload: input.requestPayload,
          syncMode: input.syncMode,
          window: {
            startDate: input.windowStartDate,
            endDate: input.windowEndDate
          }
        })
      );
      createdJobs.push(...rows);
      return rows;
    },
    async listSyncJobs() {
      return [];
    },
    async listSyncJobsByBatch(batchId: string) {
      return createdJobs.filter((job) => job.batchId === batchId);
    },
    async listActiveSyncJobs() {
      return [];
    },
    async claimNextSyncJob() {
      return null;
    },
    async updateRunningSyncJob(_id: string, _patch: {
      syncLogId?: string | null;
      progress?: unknown;
      recordsDiscovered?: number;
      recordsUpserted?: number;
      warnings?: string[];
    }) {},
    async completeSyncJob() {},
    async failSyncJob() {}
  } as Parameters<typeof enqueueSycamoreSyncBatch>[0]["jobStore"];

  const result = await enqueueSycamoreSyncBatch({
    request: {
      startDate: "2026-03-01",
      endDate: "2026-03-31"
    },
    triggeredBy: "manual",
    syncStore: createMinimalSyncStore(),
    jobStore
  });

  assert.equal(result.alreadyQueued, false);
  assert.equal(result.jobs.length, 11);
  assert.equal(result.batch.totalChunks, 11);
  assert.equal(result.batch.status, "queued");
  assert.equal(result.batch.startedAt, null);
  assert.equal(result.batch.activeJobStartedAt, null);
  assert.equal(result.batch.lastHeartbeatAt, null);
  assert.equal(result.batch.isStalled, false);
  assert.deepEqual(result.jobs[0]?.window, { startDate: "2026-03-01", endDate: "2026-03-03" });
  assert.deepEqual(result.jobs[1]?.window, { startDate: "2026-03-04", endDate: "2026-03-06" });
  assert.deepEqual(result.jobs.at(-1)?.window, { startDate: "2026-03-31", endDate: "2026-03-31" });
  assert.equal(result.jobs.every((job) => inclusiveDaySpan(job.window.startDate, job.window.endDate) <= 3), true);
  assert.deepEqual(
    result.jobs.slice(0, 3).map((job) => [job.requestPayload.startDate, job.requestPayload.endDate]),
    [
      ["2026-03-01", "2026-03-03"],
      ["2026-03-04", "2026-03-06"],
      ["2026-03-07", "2026-03-09"]
    ]
  );
});

test("enqueueSycamoreSyncBatch also chunks wide incremental gaps into 3-day windows", async () => {
  const createdJobs: SycamoreSyncJobRecord[] = [];
  const jobStore = {
    async ensureSchema() {},
    async createSyncJobs(
      inputs: Array<{
        batchId: string;
        sequenceIndex: number;
        totalJobs: number;
        triggeredBy: "manual" | "cron";
        requestPayload: { startDate?: string; endDate?: string; incremental?: boolean };
        syncMode: "initial_backfill" | "incremental" | "manual_range";
        windowStartDate: string;
        windowEndDate: string;
      }>
    ) {
      const rows = inputs.map((input) =>
        makeJob({
          id: `job_incremental_${input.sequenceIndex + 1}`,
          batchId: input.batchId,
          sequenceIndex: input.sequenceIndex,
          totalJobs: input.totalJobs,
          triggeredBy: input.triggeredBy,
          requestPayload: input.requestPayload,
          syncMode: input.syncMode,
          window: {
            startDate: input.windowStartDate,
            endDate: input.windowEndDate
          }
        })
      );
      createdJobs.push(...rows);
      return rows;
    },
    async listSyncJobs() {
      return [];
    },
    async listSyncJobsByBatch(batchId: string) {
      return createdJobs.filter((job) => job.batchId === batchId);
    },
    async listActiveSyncJobs() {
      return [];
    },
    async claimNextSyncJob() {
      return null;
    },
    async updateRunningSyncJob() {},
    async completeSyncJob() {},
    async failSyncJob() {}
  } as Parameters<typeof enqueueSycamoreSyncBatch>[0]["jobStore"];

  await withEnv(
    {
      SYCAMORE_SYNC_TODAY: "2026-03-10"
    },
    async () => {
      const result = await enqueueSycamoreSyncBatch({
        request: {
          incremental: true
        },
        triggeredBy: "cron",
        syncStore: {
          ...createMinimalSyncStore(),
          async getLatestSuccessfulSyncLog() {
            return {
              id: "sync_prev_1",
              triggeredBy: "cron",
              startedAt: "2026-03-01T02:00:00.000Z",
              completedAt: "2026-03-01T02:04:00.000Z",
              recordsSynced: 10,
              recordsDiscovered: 10,
              recordsUpserted: 10,
              status: "success",
              errorMessage: null,
              syncMode: "incremental",
              windowStartDate: "2026-02-28",
              windowEndDate: "2026-03-01"
            };
          }
        },
        jobStore
      });

      assert.equal(result.batch.syncMode, "incremental");
      assert.equal(result.jobs.length, 4);
      assert.deepEqual(
        result.jobs.map((job) => job.window),
        [
          { startDate: "2026-03-01", endDate: "2026-03-03" },
          { startDate: "2026-03-04", endDate: "2026-03-06" },
          { startDate: "2026-03-07", endDate: "2026-03-09" },
          { startDate: "2026-03-10", endDate: "2026-03-10" }
        ]
      );
    }
  );
});

test("enqueueSycamoreSyncBatch reuses the active batch instead of queuing a duplicate", async () => {
  const activeJobs = [
    makeJob({
      id: "job_active_1",
      batchId: "batch_active",
      sequenceIndex: 0,
      totalJobs: 2,
      status: "running",
      syncLogId: "sync_active_1",
      progress: makeProgress({
        window: {
          startDate: "2026-03-01",
          endDate: "2026-03-14"
        }
      }),
      startedAt: "2026-03-20T12:00:00.000Z",
      window: { startDate: "2026-03-01", endDate: "2026-03-14" }
    }),
    makeJob({
      id: "job_active_2",
      batchId: "batch_active",
      sequenceIndex: 1,
      totalJobs: 2,
      status: "queued",
      window: { startDate: "2026-03-15", endDate: "2026-03-28" }
    })
  ];
  let createCalls = 0;

  const jobStore = {
    async ensureSchema() {},
    async createSyncJobs() {
      createCalls += 1;
      return [];
    },
    async listSyncJobs() {
      return [];
    },
    async listSyncJobsByBatch(batchId: string) {
      return batchId === "batch_active" ? activeJobs : [];
    },
    async listActiveSyncJobs() {
      return activeJobs;
    },
    async claimNextSyncJob() {
      return null;
    },
    async updateRunningSyncJob() {},
    async completeSyncJob() {},
    async failSyncJob() {}
  } as Parameters<typeof enqueueSycamoreSyncBatch>[0]["jobStore"];

  const result = await enqueueSycamoreSyncBatch({
    triggeredBy: "manual",
    syncStore: createMinimalSyncStore(),
    jobStore
  });

  assert.equal(result.alreadyQueued, true);
  assert.equal(createCalls, 0);
  assert.equal(result.batch.batchId, "batch_active");
  assert.equal(result.batch.status, "running");
  assert.equal(result.jobs.length, 2);
});

test("enqueueSycamoreSyncBatch appends an audit event for the queued batch", async () => {
  const createdJobs: SycamoreSyncJobRecord[] = [];
  const auditEvents: AuditEvent[] = [];
  const jobStore = {
    async ensureSchema() {},
    async createSyncJobs(
      inputs: Array<{
        batchId: string;
        sequenceIndex: number;
        totalJobs: number;
        triggeredBy: "manual" | "cron";
        requestPayload: { startDate?: string; endDate?: string; incremental?: boolean };
        syncMode: "initial_backfill" | "incremental" | "manual_range";
        windowStartDate: string;
        windowEndDate: string;
      }>
    ) {
      const rows = inputs.map((input) =>
        makeJob({
          id: `job_batch_audit_${input.sequenceIndex + 1}`,
          batchId: input.batchId,
          sequenceIndex: input.sequenceIndex,
          totalJobs: input.totalJobs,
          triggeredBy: input.triggeredBy,
          requestPayload: input.requestPayload,
          syncMode: input.syncMode,
          window: {
            startDate: input.windowStartDate,
            endDate: input.windowEndDate
          }
        })
      );
      createdJobs.push(...rows);
      return rows;
    },
    async listSyncJobs() {
      return [];
    },
    async listSyncJobsByBatch(batchId: string) {
      return createdJobs.filter((job) => job.batchId === batchId);
    },
    async listActiveSyncJobs() {
      return [];
    },
    async claimNextSyncJob() {
      return null;
    },
    async updateRunningSyncJob() {},
    async completeSyncJob() {},
    async failSyncJob() {}
  } as Parameters<typeof enqueueSycamoreSyncBatch>[0]["jobStore"];

  const result = await enqueueSycamoreSyncBatch({
    request: {
      startDate: "2026-03-01",
      endDate: "2026-03-05"
    },
    triggeredBy: "manual",
    actorEmail: "admin@school.org",
    syncStore: createMinimalSyncStore(),
    jobStore,
    auditSink: {
      async append(event) {
        auditEvents.push(event);
      }
    }
  });

  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0]?.eventType, "sycamore_sync_batch_queued");
  assert.equal(auditEvents[0]?.entityType, "sycamore_sync_batch");
  assert.equal(auditEvents[0]?.entityId, result.batch.batchId);
  assert.equal(auditEvents[0]?.actor, "admin@school.org");
  assert.match(auditEvents[0]?.payloadJson ?? "", /"totalChunks":2/);
});

test("runNextQueuedSycamoreSyncJob appends start, completion, and final batch audit events", async () => {
  const auditEvents: AuditEvent[] = [];
  const claimedJob = makeJob({
    id: "job_run_1",
    batchId: "batch_run_1",
    sequenceIndex: 0,
    totalJobs: 1,
    triggeredBy: "manual",
    requestPayload: {
      startDate: "2026-03-01",
      endDate: "2026-03-03"
    },
    syncMode: "manual_range",
    window: {
      startDate: "2026-03-01",
      endDate: "2026-03-03"
    },
    status: "running",
    attemptCount: 1,
    startedAt: "2026-03-20T12:00:00.000Z",
    lastHeartbeatAt: "2026-03-20T12:00:00.000Z"
  });

  let completedJob = claimedJob;
  const jobStore = {
    async ensureSchema() {},
    async createSyncJobs() {
      return [];
    },
    async listSyncJobs() {
      return [completedJob];
    },
    async listSyncJobsByBatch(batchId: string) {
      return batchId === completedJob.batchId ? [completedJob] : [];
    },
    async listActiveSyncJobs() {
      return completedJob.status === "queued" || completedJob.status === "running" ? [completedJob] : [];
    },
    async claimNextSyncJob() {
      return claimedJob;
    },
    async updateRunningSyncJob() {},
    async completeSyncJob(
      id: string,
      patch: {
        syncLogId?: string | null;
        resultStatus: "success" | "partial" | "failed";
        recordsDiscovered: number;
        recordsUpserted: number;
        warnings: string[];
        completedAt: string;
        errorMessage?: string | null;
      }
    ) {
      completedJob = {
        ...completedJob,
        id,
        status: patch.resultStatus === "failed" ? "failed" : "succeeded",
        resultStatus: patch.resultStatus,
        syncLogId: patch.syncLogId ?? null,
        recordsDiscovered: patch.recordsDiscovered,
        recordsUpserted: patch.recordsUpserted,
        warnings: patch.warnings,
        warningsCount: patch.warnings.length,
        completedAt: patch.completedAt,
        lastHeartbeatAt: patch.completedAt,
        errorMessage: patch.errorMessage ?? null
      };
    },
    async failSyncJob() {
      throw new Error("Should not fail in this test.");
    }
  };

  const result = await runNextQueuedSycamoreSyncJob({
    actorEmail: "admin@school.org",
    syncStore: createMinimalSyncStore(),
    jobStore,
    auditSink: {
      async append(event) {
        auditEvents.push(event);
      }
    },
    runSync: async () => ({
      syncLogId: "sync_log_1",
      status: "success",
      syncMode: "manual_range",
      window: {
        startDate: "2026-03-01",
        endDate: "2026-03-03"
      },
      recordsDiscovered: 6,
      recordsUpserted: 6,
      warnings: [],
      rosterSync: {
        attempted: true,
        fetchedStudents: 12,
        upsertedStudents: 12,
        linkedStudents: 12,
        linkedDisciplineLogs: 0
      },
      startedAt: "2026-03-20T12:00:00.000Z",
      completedAt: "2026-03-20T12:04:00.000Z",
      triggeredBy: "manual"
    })
  });

  assert.equal(result.executed, true);
  assert.equal(result.job?.status, "succeeded");
  assert.deepEqual(
    auditEvents.map((event) => event.eventType),
    ["sycamore_sync_job_started", "sycamore_sync_job_completed", "sycamore_sync_batch_completed"]
  );
  assert.equal(auditEvents.every((event) => event.actor === "admin@school.org"), true);
  assert.equal(auditEvents[0]?.entityType, "sycamore_sync_job");
  assert.equal(auditEvents[2]?.entityType, "sycamore_sync_batch");
});
