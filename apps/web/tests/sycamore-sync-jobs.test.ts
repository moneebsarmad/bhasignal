import assert from "node:assert/strict";
import test from "node:test";

import type { SycamoreStore } from "../lib/sycamore-direct-store";
import type { SycamoreSyncProgressSnapshot } from "../lib/sycamore-direct-sync";
import {
  enqueueSycamoreSyncBatch,
  summarizeSycamoreSyncBatch,
  type SycamoreSyncJobRecord
} from "../lib/sycamore-sync-jobs";

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

test("enqueueSycamoreSyncBatch splits wide manual ranges into queued windows", async () => {
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
    async updateRunningSyncJob() {},
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
  assert.equal(result.jobs.length, 3);
  assert.equal(result.batch.totalChunks, 3);
  assert.equal(result.batch.status, "queued");
  assert.deepEqual(
    result.jobs.map((job) => job.window),
    [
      { startDate: "2026-03-01", endDate: "2026-03-14" },
      { startDate: "2026-03-15", endDate: "2026-03-28" },
      { startDate: "2026-03-29", endDate: "2026-03-31" }
    ]
  );
  assert.deepEqual(
    result.jobs.map((job) => [job.requestPayload.startDate, job.requestPayload.endDate]),
    [
      ["2026-03-01", "2026-03-14"],
      ["2026-03-15", "2026-03-28"],
      ["2026-03-29", "2026-03-31"]
    ]
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
