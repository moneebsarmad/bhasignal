import assert from "node:assert/strict";
import test from "node:test";

import type { ParseRun } from "@syc/domain";

import { buildDataOpsSnapshot } from "../lib/data-ops";
import type { SycamoreStore } from "../lib/sycamore-direct-store";
import { createInMemoryStorage } from "./review-actions.test";

const originalFetch = globalThis.fetch;

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

test.after(() => {
  globalThis.fetch = originalFetch;
});

test("buildDataOpsSnapshot marks parser as not configured when no parser URL is set", async () => {
  const storage = createInMemoryStorage({
    parseRuns: [],
    rawIncidents: [],
    reviewTasks: []
  });

  globalThis.fetch = async () => {
    throw new Error("parser fetch should not run when the parser is not configured");
  };

  await withEnv(
    {
      PARSER_BASE_URL: undefined,
      SYCAMORE_API_ENABLED: "false",
      SYCAMORE_ACCESS_TOKEN: undefined,
      SYCAMORE_API_ACCESS_TOKEN: undefined,
      SYCAMORE_API_TOKEN: undefined,
      SYCAMORE_SCHOOL_ID: undefined
    },
    async () => {
      const snapshot = await buildDataOpsSnapshot(storage);

      assert.equal(snapshot.parser.configured, false);
      assert.equal(snapshot.parser.ok, null);
      assert.equal(snapshot.parser.baseUrl, null);
    }
  );
});

test("buildDataOpsSnapshot exposes ingestion breakdown by source and latest direct Sycamore sync metadata", async () => {
  const parseRuns: ParseRun[] = [
    {
      id: "run_manual",
      sourceType: "manual_pdf",
      fileName: "discipline.pdf",
      uploadedBy: "admin@school.org",
      triggeredBy: "admin@school.org",
      metadataJson: "{}",
      cursorJson: null,
      status: "completed",
      rowsExtracted: 1,
      rowsFlagged: 1,
      startedAt: "2026-03-10T09:00:00.000Z",
      completedAt: "2026-03-10T09:05:00.000Z"
    }
  ];

  const storage = createInMemoryStorage({
    parseRuns,
    rawIncidents: [],
    reviewTasks: []
  });

  const sycamoreStore: SycamoreStore = {
    async ensureSchema() {},
    async createSyncLog() {
      throw new Error("not used in this test");
    },
    async updateSyncLog() {
      throw new Error("not used in this test");
    },
    async getLatestSyncLog() {
      return {
        id: "sync_2",
        triggeredBy: "manual",
        startedAt: "2026-03-03T09:00:00.000Z",
        completedAt: "2026-03-03T09:05:00.000Z",
        recordsSynced: 11,
        recordsDiscovered: 14,
        recordsUpserted: 11,
        status: "failed",
        errorMessage: "upstream timeout",
        syncMode: "manual_range",
        windowStartDate: "2026-03-03",
        windowEndDate: "2026-03-03"
      };
    },
    async getLatestSuccessfulSyncLog() {
      return {
        id: "sync_1",
        triggeredBy: "cron",
        startedAt: "2026-03-02T09:00:00.000Z",
        completedAt: "2026-03-02T09:05:00.000Z",
        recordsSynced: 32,
        recordsDiscovered: 32,
        recordsUpserted: 32,
        status: "success",
        errorMessage: null,
        syncMode: "incremental",
        windowStartDate: "2026-03-01",
        windowEndDate: "2026-03-02"
      };
    },
    async listRecentSyncLogs() {
      return [
        {
          id: "sync_2",
          triggeredBy: "manual",
          startedAt: "2026-03-03T09:00:00.000Z",
          completedAt: "2026-03-03T09:05:00.000Z",
          recordsSynced: 11,
          recordsDiscovered: 14,
          recordsUpserted: 11,
          status: "failed",
          errorMessage: "upstream timeout",
          syncMode: "manual_range",
          windowStartDate: "2026-03-03",
          windowEndDate: "2026-03-03"
        },
        {
          id: "sync_1",
          triggeredBy: "cron",
          startedAt: "2026-03-02T09:00:00.000Z",
          completedAt: "2026-03-02T09:05:00.000Z",
          recordsSynced: 32,
          recordsDiscovered: 32,
          recordsUpserted: 32,
          status: "success",
          errorMessage: null,
          syncMode: "incremental",
          windowStartDate: "2026-03-01",
          windowEndDate: "2026-03-02"
        }
      ];
    },
    async listRecentDisciplineLogs() {
      return [];
    },
    async getSyncCounts() {
      return { total: 2, failed: 1 };
    },
    async getDisciplineCounts() {
      return { total: 43, linked: 37 };
    },
    async resolveStudentRecordLinks() {
      return new Map<string, string>();
    },
    async backfillDisciplineLogLinks() {
      return 0;
    },
    async findExistingDisciplineLogIds() {
      return new Set<string>();
    },
    async upsertDisciplineLogs() {}
  };

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  await withEnv(
    {
      SYCAMORE_API_ENABLED: "true",
      SYCAMORE_ACCESS_TOKEN: "token-123",
      SYCAMORE_SCHOOL_ID: "1002",
      SYCAMORE_API_BASE_URL: "https://school.sycamoreeducation.com/api/v1",
      SYCAMORE_DISCIPLINE_PATH_TEMPLATE: "/School/{schoolId}/Discipline"
    },
    async () => {
      const snapshot = await buildDataOpsSnapshot(storage, { sycamoreStore });

      assert.equal(snapshot.ingestion.bySource.manual_pdf?.totalJobs, 1);
      assert.equal(snapshot.sycamore.configured, true);
      assert.equal(snapshot.sycamore.totalSyncs, 2);
      assert.equal(snapshot.sycamore.failedSyncs, 1);
      assert.equal(snapshot.sycamore.totalLogs, 43);
      assert.equal(snapshot.sycamore.linkedLogs, 37);
      assert.deepEqual(snapshot.sycamore.lastWindow, {
        startDate: "2026-03-03",
        endDate: "2026-03-03"
      });
      assert.deepEqual(snapshot.sycamore.lastSuccessfulWindow, {
        startDate: "2026-03-01",
        endDate: "2026-03-02"
      });
      assert.equal(snapshot.sycamore.lastRecordsDiscovered, 14);
      assert.equal(snapshot.sycamore.lastRecordsUpserted, 11);
      assert.equal(snapshot.sycamore.lastSyncMode, "manual_range");
      assert.equal(snapshot.sycamore.pathTemplate, "/School/{schoolId}/Discipline");
    }
  );
});
