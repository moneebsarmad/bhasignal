import assert from "node:assert/strict";
import test from "node:test";

import {
  backfillSycamoreStudentLinks,
  resolveSycamoreDirectSyncPlan,
  runSycamoreDirectSync,
  sycamoreDirectSyncRequestSchema,
  type SycamoreDirectSyncRequest,
  type SycamoreSyncProgressSnapshot
} from "../lib/sycamore-direct-sync";
import type {
  SycamoreDisciplineLogRecord,
  SycamoreStore,
  SycamoreSyncLogRecord
} from "../lib/sycamore-direct-store";
import { createInMemoryStorage } from "./review-actions.test";

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

function createInMemorySycamoreStore(): {
  store: SycamoreStore;
  syncLogs: SycamoreSyncLogRecord[];
  disciplineLogs: SycamoreDisciplineLogRecord[];
} {
  const syncLogs: SycamoreSyncLogRecord[] = [];
  const disciplineLogs: SycamoreDisciplineLogRecord[] = [];

  const store: SycamoreStore = {
    async ensureSchema() {},
    async createSyncLog(input) {
      const record: SycamoreSyncLogRecord = {
        id: `sync_${syncLogs.length + 1}`,
        triggeredBy: input.triggeredBy,
        startedAt: new Date("2026-03-12T12:00:00.000Z").toISOString(),
        completedAt: null,
        recordsSynced: 0,
        recordsDiscovered: 0,
        recordsUpserted: 0,
        status: "running",
        errorMessage: null,
        syncMode: input.syncMode,
        windowStartDate: input.windowStartDate,
        windowEndDate: input.windowEndDate
      };
      syncLogs.push(record);
      return record;
    },
    async updateSyncLog(id, patch) {
      const record = syncLogs.find((item) => item.id === id);
      if (!record) {
        throw new Error(`Unknown sync log ${id}`);
      }
      record.completedAt = patch.completedAt;
      record.status = patch.status;
      record.recordsDiscovered = patch.recordsDiscovered;
      record.recordsSynced = patch.recordsSynced;
      record.recordsUpserted = patch.recordsUpserted;
      record.errorMessage = patch.errorMessage ?? null;
    },
    async getLatestSyncLog() {
      return syncLogs[0] ?? null;
    },
    async getLatestSuccessfulSyncLog() {
      return syncLogs.find((item) => item.status === "success" || item.status === "partial") ?? null;
    },
    async listRecentSyncLogs(limit) {
      return syncLogs.slice(0, limit);
    },
    async listRecentDisciplineLogs(limit) {
      return disciplineLogs.slice(0, limit);
    },
    async getSyncCounts() {
      return {
        total: syncLogs.length,
        failed: syncLogs.filter((item) => item.status === "failed").length
      };
    },
    async getDisciplineCounts() {
      return {
        total: disciplineLogs.length,
        linked: disciplineLogs.filter((item) => Boolean(item.studentRecordId)).length
      };
    },
    async resolveStudentRecordLinks(externalStudentIds) {
      const map = new Map<string, string>();
      for (const externalStudentId of externalStudentIds) {
        if (externalStudentId === "stu-ext-1") {
          map.set(externalStudentId, "stu_local_1");
        }
      }
      return map;
    },
    async backfillDisciplineLogLinks(studentLinks) {
      let linkedRows = 0;
      for (const record of disciplineLogs) {
        if (record.studentRecordId) {
          continue;
        }
        const localStudentId = studentLinks.get(record.studentId);
        if (localStudentId) {
          record.studentRecordId = localStudentId;
          linkedRows += 1;
        }
      }
      return linkedRows;
    },
    async upsertDisciplineLogs(records) {
      for (const record of records) {
        const existingIndex = disciplineLogs.findIndex((item) => item.sycamoreLogId === record.sycamoreLogId);
        if (existingIndex >= 0) {
          disciplineLogs[existingIndex] = record;
        } else {
          disciplineLogs.push(record);
        }
      }
    }
  };

  return { store, syncLogs, disciplineLogs };
}

test("runSycamoreDirectSync fetches school list, detail rows, and linked detention detail", async () => {
  const { store, syncLogs, disciplineLogs } = createInMemorySycamoreStore();
  const request: SycamoreDirectSyncRequest = {
    startDate: "2026-03-10",
    endDate: "2026-03-10"
  };

  await withEnv(
    {
      SYCAMORE_ACCESS_TOKEN: "token-123",
      SYCAMORE_SCHOOL_ID: "1002",
      SYCAMORE_API_BASE_URL: "https://school.sycamoreeducation.com/api/v1",
      SYCAMORE_REQUEST_DELAY_MS: "0"
    },
    async () => {
      const result = await runSycamoreDirectSync({
        request,
        triggeredBy: "manual",
        store,
        config: {
          baseUrl: "https://school.sycamoreeducation.com/api/v1",
          accessToken: "token-123",
          schoolId: "1002",
          disciplinePathTemplate: "/School/{schoolId}/Discipline",
          studentsPathTemplate: "/School/{schoolId}/Students",
          timeoutMs: 2_000,
          maxAttempts: 1,
          retryBaseDelayMs: 1
        },
        dependencies: {
          fetchImpl: async (input) => {
            const url = String(input);
            if (url.includes("/School/1002/Discipline") && url.includes("Date=2026-03-10")) {
              return new Response(
                JSON.stringify({
                  Data: [{ LogID: "log-1", StudentID: "stu-ext-1", StudentName: "Jane Doe", Grade: "8" }]
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }
            if (url.endsWith("/Student/stu-ext-1/Discipline/log-1")) {
              return new Response(
                JSON.stringify({
                  Data: {
                    LogID: "log-1",
                    StudentID: "stu-ext-1",
                    StudentName: "Jane Doe",
                    Grade: "8",
                    Type: "Disrespect",
                    Description: "Classroom disruption",
                    Consequence: "Lunch detention",
                    AssignedBy: "Dean Smith",
                    DetentionID: "det-9",
                    Date: "03/10/2026"
                  }
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }
            if (url.endsWith("/Student/stu-ext-1/Detention/det-9")) {
              return new Response(
                JSON.stringify({
                  Data: {
                    ID: "det-9",
                    Location: "Room 14"
                  }
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }
            throw new Error(`Unexpected URL ${url}`);
          },
          sleep: async () => {}
        }
      });

      assert.equal(result.status, "success");
      assert.equal(result.syncMode, "manual_range");
      assert.equal(result.recordsDiscovered, 1);
      assert.equal(result.recordsUpserted, 1);
      assert.equal(syncLogs[0]?.status, "success");
      assert.equal(disciplineLogs[0]?.studentRecordId, "stu_local_1");
      assert.equal(disciplineLogs[0]?.detentionId, "det-9");
      assert.equal(disciplineLogs[0]?.incidentDate, "2026-03-10");
      assert.equal(disciplineLogs[0]?.points, 0);
      assert.equal(disciplineLogs[0]?.level, null);
      assert.equal(disciplineLogs[0]?.violation, "Disrespect");
      assert.equal(disciplineLogs[0]?.violationRaw, "Disrespect");
      assert.equal(disciplineLogs[0]?.resolution, "Lunch detention");
      assert.equal(disciplineLogs[0]?.authorName, "Dean Smith");
      assert.equal(disciplineLogs[0]?.authorNameRaw, "Dean Smith");
      assert.equal(disciplineLogs[0]?.detentionPayload?.Location, "Room 14");
    }
  );
});

test("runSycamoreDirectSync emits stage progress snapshots for manual syncs", async () => {
  const { store } = createInMemorySycamoreStore();
  const progressSnapshots: SycamoreSyncProgressSnapshot[] = [];

  await withEnv(
    {
      SYCAMORE_ACCESS_TOKEN: "token-123",
      SYCAMORE_SCHOOL_ID: "1002",
      SYCAMORE_API_BASE_URL: "https://school.sycamoreeducation.com/api/v1",
      SYCAMORE_REQUEST_DELAY_MS: "0"
    },
    async () => {
      await runSycamoreDirectSync({
        request: {
          startDate: "2026-03-10",
          endDate: "2026-03-10"
        },
        triggeredBy: "manual",
        store,
        onProgress(snapshot) {
          progressSnapshots.push(snapshot);
        },
        config: {
          baseUrl: "https://school.sycamoreeducation.com/api/v1",
          accessToken: "token-123",
          schoolId: "1002",
          disciplinePathTemplate: "/School/{schoolId}/Discipline",
          studentsPathTemplate: "/School/{schoolId}/Students",
          timeoutMs: 2_000,
          maxAttempts: 1,
          retryBaseDelayMs: 1
        },
        dependencies: {
          fetchImpl: async (input) => {
            const url = String(input);
            if (url.endsWith("/School/1002/Students")) {
              return new Response(JSON.stringify({ Data: [{ ID: "stu-ext-1", StudentName: "Jane Doe", Grade: "8" }] }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
              });
            }
            if (url.includes("/School/1002/Discipline") && url.includes("Date=2026-03-10")) {
              return new Response(
                JSON.stringify({
                  Data: [{ LogID: "log-1", StudentID: "stu-ext-1", StudentName: "Jane Doe", Grade: "8" }]
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }
            if (url.endsWith("/Student/stu-ext-1/Discipline/log-1")) {
              return new Response(
                JSON.stringify({
                  Data: {
                    LogID: "log-1",
                    StudentID: "stu-ext-1",
                    StudentName: "Jane Doe",
                    Grade: "8",
                    Type: "Disrespect",
                    Description: "Classroom disruption",
                    Resolution: "Lunch detention",
                    Author: "Ms Smith",
                    Date: "03/10/2026"
                  }
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }

            throw new Error(`Unexpected url ${url}`);
          }
        }
      });
    }
  );

  assert.ok(progressSnapshots.length >= 5);
  assert.equal(progressSnapshots[0]?.stage, "roster");
  assert.ok(progressSnapshots.some((snapshot) => snapshot.stage === "discovery"));
  assert.ok(progressSnapshots.some((snapshot) => snapshot.stage === "detail_fetch"));
  assert.ok(progressSnapshots.some((snapshot) => snapshot.stage === "upsert"));
  assert.equal(progressSnapshots.at(-1)?.stage, "complete");
  assert.equal(progressSnapshots.at(-1)?.recordsUpserted, 1);
  assert.equal(progressSnapshots.at(-1)?.detailRecordsProcessed, 1);
});

test("runSycamoreDirectSync accepts camelCase discipline keys from the school feed", async () => {
  const { store, disciplineLogs } = createInMemorySycamoreStore();

  await withEnv(
    {
      SYCAMORE_ACCESS_TOKEN: "token-123",
      SYCAMORE_SCHOOL_ID: "1002",
      SYCAMORE_API_BASE_URL: "https://school.sycamoreeducation.com/api/v1",
      SYCAMORE_REQUEST_DELAY_MS: "0"
    },
    async () => {
      const result = await runSycamoreDirectSync({
        request: {
          startDate: "2026-03-10",
          endDate: "2026-03-10"
        },
        triggeredBy: "manual",
        store,
        config: {
          baseUrl: "https://school.sycamoreeducation.com/api/v1",
          accessToken: "token-123",
          schoolId: "1002",
          disciplinePathTemplate: "/School/{schoolId}/Discipline",
          studentsPathTemplate: "/School/{schoolId}/Students",
          timeoutMs: 2_000,
          maxAttempts: 1,
          retryBaseDelayMs: 1
        },
        dependencies: {
          fetchImpl: async (input) => {
            const url = String(input);
            if (url.includes("/School/1002/Discipline") && url.includes("Date=2026-03-10")) {
              return new Response(
                JSON.stringify({
                  Data: [{ id: "log-camel-1", studentId: "stu-ext-1", studentName: "Jane Doe", grade: "8" }]
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }
            if (url.endsWith("/Student/stu-ext-1/Discipline/log-camel-1")) {
              return new Response(
                JSON.stringify({
                  id: "log-camel-1",
                  studentId: "stu-ext-1",
                  studentName: "Jane Doe",
                  grade: "8",
                  violation: "Level 2: Disrespect",
                  description: "Camel-case discipline detail",
                  resolution: "Lunch detention",
                  author: "Dean Smith",
                  date: "2026-03-10",
                  points: "3"
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }
            throw new Error(`Unexpected URL ${url}`);
          },
          sleep: async () => {}
        }
      });

      assert.equal(result.status, "success");
      assert.equal(result.recordsDiscovered, 1);
      assert.equal(result.recordsUpserted, 1);
      assert.equal(disciplineLogs.length, 1);
      assert.equal(disciplineLogs[0]?.sycamoreLogId, "log-camel-1");
      assert.equal(disciplineLogs[0]?.studentRecordId, "stu_local_1");
      assert.equal(disciplineLogs[0]?.studentName, "Jane Doe");
      assert.equal(disciplineLogs[0]?.incidentDate, "2026-03-10");
      assert.equal(disciplineLogs[0]?.level, 2);
      assert.equal(disciplineLogs[0]?.violation, "Disrespect");
      assert.equal(disciplineLogs[0]?.points, 3);
      assert.equal(disciplineLogs[0]?.authorName, "Dean Smith");
    }
  );
});

test("runSycamoreDirectSync falls back when school-feed rows are missing resolvable ids", async () => {
  const { store, disciplineLogs } = createInMemorySycamoreStore();

  await withEnv(
    {
      SYCAMORE_ACCESS_TOKEN: "token-123",
      SYCAMORE_SCHOOL_ID: "1002",
      SYCAMORE_API_BASE_URL: "https://school.sycamoreeducation.com/api/v1",
      SYCAMORE_REQUEST_DELAY_MS: "0"
    },
    async () => {
      const result = await runSycamoreDirectSync({
        request: {
          startDate: "2026-03-10",
          endDate: "2026-03-10"
        },
        triggeredBy: "manual",
        store,
        config: {
          baseUrl: "https://school.sycamoreeducation.com/api/v1",
          accessToken: "token-123",
          schoolId: "1002",
          disciplinePathTemplate: "/School/{schoolId}/Discipline",
          studentsPathTemplate: "/School/{schoolId}/Students",
          timeoutMs: 2_000,
          maxAttempts: 1,
          retryBaseDelayMs: 1
        },
        dependencies: {
          fetchImpl: async (input) => {
            const url = String(input);
            if (url.includes("/School/1002/Discipline") && url.includes("Date=2026-03-10")) {
              return new Response(
                JSON.stringify({
                  Data: [{ student: "Jane Doe", grade: "8", date: "2026-03-10", violation: "Disrespect" }]
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }
            if (url.endsWith("/School/1002/Students")) {
              return new Response(
                JSON.stringify([{ id: "stu-ext-1", firstName: "Jane", lastName: "Doe", grade: "8" }]),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }
            if (url.endsWith("/Student/stu-ext-1/Discipline")) {
              return new Response(JSON.stringify([{ id: "log-fallback-1", date: "2026-03-10", violation: "Disrespect" }]), {
                status: 200,
                headers: { "Content-Type": "application/json" }
              });
            }
            if (url.endsWith("/Student/stu-ext-1/Discipline/log-fallback-1")) {
              return new Response(
                JSON.stringify({
                  id: "log-fallback-1",
                  studentId: "stu-ext-1",
                  studentName: "Jane Doe",
                  grade: "8",
                  violation: "Disrespect",
                  resolution: "Lunch detention",
                  author: "Dean Smith",
                  date: "2026-03-10"
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }
            throw new Error(`Unexpected URL ${url}`);
          },
          sleep: async () => {}
        }
      });

      assert.equal(result.status, "success");
      assert.equal(result.recordsDiscovered, 1);
      assert.equal(result.recordsUpserted, 1);
      assert.equal(
        result.warnings.some((warning) => warning.startsWith("sycamore_school_rows_missing_ids_fallback_used:")),
        true
      );
      assert.equal(disciplineLogs.length, 1);
      assert.equal(disciplineLogs[0]?.sycamoreLogId, "log-fallback-1");
      assert.equal(disciplineLogs[0]?.studentRecordId, "stu_local_1");
      assert.equal(disciplineLogs[0]?.studentName, "Jane Doe");
    }
  );
});

test("runSycamoreDirectSync emits discovery progress while scanning fallback students", async () => {
  const { store } = createInMemorySycamoreStore();
  const progressSnapshots: SycamoreSyncProgressSnapshot[] = [];

  await withEnv(
    {
      SYCAMORE_ACCESS_TOKEN: "token-123",
      SYCAMORE_SCHOOL_ID: "1002",
      SYCAMORE_API_BASE_URL: "https://school.sycamoreeducation.com/api/v1",
      SYCAMORE_REQUEST_DELAY_MS: "0",
      SYCAMORE_FALLBACK_DISCOVERY_CONCURRENCY: "1"
    },
    async () => {
      await runSycamoreDirectSync({
        request: {
          startDate: "2026-03-10",
          endDate: "2026-03-10"
        },
        triggeredBy: "manual",
        store,
        onProgress(snapshot) {
          progressSnapshots.push(snapshot);
        },
        config: {
          baseUrl: "https://school.sycamoreeducation.com/api/v1",
          accessToken: "token-123",
          schoolId: "1002",
          disciplinePathTemplate: "/School/{schoolId}/Discipline",
          studentsPathTemplate: "/School/{schoolId}/Students",
          timeoutMs: 2_000,
          maxAttempts: 1,
          retryBaseDelayMs: 1
        },
        dependencies: {
          fetchImpl: async (input) => {
            const url = String(input);
            if (url.includes("/School/1002/Discipline") && url.includes("Date=2026-03-10")) {
              return new Response(null, { status: 204 });
            }
            if (url.endsWith("/School/1002/Students")) {
              return new Response(
                JSON.stringify([
                  { ID: "stu-ext-1", FirstName: "Jane", LastName: "Doe", Grade: "8" },
                  { ID: "stu-ext-2", FirstName: "John", LastName: "Smith", Grade: "8" }
                ]),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }
            if (url.endsWith("/Student/stu-ext-1/Discipline")) {
              return new Response(JSON.stringify([{ ID: "log-progress-1", Date: "2026-03-10", Violation: "Disrespect" }]), {
                status: 200,
                headers: { "Content-Type": "application/json" }
              });
            }
            if (url.endsWith("/Student/stu-ext-2/Discipline")) {
              return new Response(JSON.stringify([]), {
                status: 200,
                headers: { "Content-Type": "application/json" }
              });
            }
            if (url.endsWith("/Student/stu-ext-1/Discipline/log-progress-1")) {
              return new Response(
                JSON.stringify({
                  ID: "log-progress-1",
                  StudentID: "stu-ext-1",
                  StudentName: "Jane Doe",
                  Grade: "8",
                  Violation: "Disrespect",
                  Resolution: "Lunch detention",
                  Author: "Dean Smith",
                  Date: "2026-03-10"
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }
            throw new Error(`Unexpected URL ${url}`);
          },
          sleep: async () => {}
        }
      });
    }
  );

  assert.equal(
    progressSnapshots.some(
      (snapshot) =>
        snapshot.stage === "discovery" &&
        snapshot.discoveryStudentsTotal === 2 &&
        snapshot.discoveryStudentsProcessed === 1 &&
        snapshot.discoveredRecords === 1
    ),
    true
  );
  assert.equal(
    progressSnapshots.some(
      (snapshot) =>
        snapshot.stage === "discovery" &&
        snapshot.discoveryStudentsTotal === 2 &&
        snapshot.discoveryStudentsProcessed === 2
    ),
    true
  );
});

test("runSycamoreDirectSync falls back to per-student discipline discovery when the school feed is empty", async () => {
  const { store, syncLogs, disciplineLogs } = createInMemorySycamoreStore();

  await withEnv(
    {
      SYCAMORE_ACCESS_TOKEN: "token-123",
      SYCAMORE_SCHOOL_ID: "1002",
      SYCAMORE_API_BASE_URL: "https://school.sycamoreeducation.com/api/v1",
      SYCAMORE_REQUEST_DELAY_MS: "0"
    },
    async () => {
      const result = await runSycamoreDirectSync({
        request: {
          startDate: "2026-03-10",
          endDate: "2026-03-10"
        },
        triggeredBy: "manual",
        store,
        config: {
          baseUrl: "https://school.sycamoreeducation.com/api/v1",
          accessToken: "token-123",
          schoolId: "1002",
          disciplinePathTemplate: "/School/{schoolId}/Discipline",
          studentsPathTemplate: "/School/{schoolId}/Students",
          timeoutMs: 2_000,
          maxAttempts: 1,
          retryBaseDelayMs: 1
        },
        dependencies: {
          fetchImpl: async (input) => {
            const url = String(input);
            if (url.includes("/School/1002/Discipline") && url.includes("Date=2026-03-10")) {
              return new Response(null, { status: 204 });
            }
            if (url.endsWith("/School/1002/Students")) {
              return new Response(
                JSON.stringify([
                  {
                    ID: "stu-ext-1",
                    FirstName: "Jane",
                    LastName: "Doe",
                    Grade: "8"
                  }
                ]),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }
            if (url.endsWith("/Student/stu-ext-1/Discipline")) {
              return new Response(JSON.stringify([{ ID: "log-2", Date: "2026-03-10", Violation: "Disrespect" }]), {
                status: 200,
                headers: { "Content-Type": "application/json" }
              });
            }
            if (url.endsWith("/Student/stu-ext-1/Discipline/log-2")) {
              return new Response(
                JSON.stringify({
                  Description: "Discipline fallback row",
                  Date: "2026-03-10",
                  Author: "Dean Smith",
                  Violation: "Disrespect",
                  Resolution: "Lunch detention"
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }
            throw new Error(`Unexpected URL ${url}`);
          },
          sleep: async () => {}
        }
      });

      assert.equal(result.status, "success");
      assert.equal(result.recordsDiscovered, 1);
      assert.equal(result.recordsUpserted, 1);
      assert.equal(result.warnings.some((warning) => warning.startsWith("sycamore_school_list_empty_fallback_used:")), true);
      assert.equal(syncLogs[0]?.status, "success");
      assert.equal(disciplineLogs[0]?.sycamoreLogId, "log-2");
      assert.equal(disciplineLogs[0]?.studentRecordId, "stu_local_1");
      assert.equal(disciplineLogs[0]?.studentName, "Jane Doe");
      assert.equal(disciplineLogs[0]?.incidentDate, "2026-03-10");
      assert.equal(disciplineLogs[0]?.violation, "Disrespect");
      assert.equal(disciplineLogs[0]?.resolution, "Lunch detention");
      assert.equal(disciplineLogs[0]?.authorName, "Dean Smith");
    }
  );
});

test("runSycamoreDirectSync supports targeted student-name sync windows", async () => {
  const { store, syncLogs, disciplineLogs } = createInMemorySycamoreStore();

  await withEnv(
    {
      SYCAMORE_ACCESS_TOKEN: "token-123",
      SYCAMORE_SCHOOL_ID: "1002",
      SYCAMORE_API_BASE_URL: "https://school.sycamoreeducation.com/api/v1",
      SYCAMORE_REQUEST_DELAY_MS: "0"
    },
    async () => {
      const result = await runSycamoreDirectSync({
        request: {
          startDate: "2026-03-10",
          endDate: "2026-03-10",
          studentNames: ["Jane Doe"]
        },
        triggeredBy: "manual",
        store,
        config: {
          baseUrl: "https://school.sycamoreeducation.com/api/v1",
          accessToken: "token-123",
          schoolId: "1002",
          disciplinePathTemplate: "/School/{schoolId}/Discipline",
          studentsPathTemplate: "/School/{schoolId}/Students",
          timeoutMs: 2_000,
          maxAttempts: 1,
          retryBaseDelayMs: 1
        },
        dependencies: {
          fetchImpl: async (input) => {
            const url = String(input);
            if (url.endsWith("/School/1002/Students")) {
              return new Response(
                JSON.stringify([
                  { ID: "stu-ext-1", FirstName: "Jane", LastName: "Doe", Grade: "8" },
                  { ID: "stu-ext-2", FirstName: "John", LastName: "Smith", Grade: "8" }
                ]),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }
            if (url.endsWith("/Student/stu-ext-1/Discipline")) {
              return new Response(JSON.stringify([{ ID: "log-3", Date: "2026-03-10", Violation: "Disrespect" }]), {
                status: 200,
                headers: { "Content-Type": "application/json" }
              });
            }
            if (url.endsWith("/Student/stu-ext-1/Discipline/log-3")) {
              return new Response(
                JSON.stringify({
                  Description: "Targeted sync row",
                  Date: "2026-03-10",
                  Author: "Dean Smith",
                  Violation: "Level 2: Disrespect",
                  Resolution: "Lunch detention",
                  Points: "3"
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }
            if (url.includes("/Student/stu-ext-2/")) {
              throw new Error(`Unexpected targeted fetch ${url}`);
            }
            throw new Error(`Unexpected URL ${url}`);
          },
          sleep: async () => {}
        }
      });

      assert.equal(result.status, "success");
      assert.equal(result.recordsDiscovered, 1);
      assert.equal(result.warnings.some((warning) => warning.startsWith("sycamore_student_target_sync:")), true);
      assert.equal(syncLogs[0]?.status, "success");
      assert.equal(disciplineLogs.length, 1);
      assert.equal(disciplineLogs[0]?.studentName, "Jane Doe");
      assert.equal(disciplineLogs[0]?.level, 2);
      assert.equal(disciplineLogs[0]?.violation, "Disrespect");
      assert.equal(disciplineLogs[0]?.points, 3);
    }
  );
});

test("runSycamoreDirectSync supports grade-targeted sync windows", async () => {
  const { store, disciplineLogs } = createInMemorySycamoreStore();

  await withEnv(
    {
      SYCAMORE_ACCESS_TOKEN: "token-123",
      SYCAMORE_SCHOOL_ID: "1002",
      SYCAMORE_API_BASE_URL: "https://school.sycamoreeducation.com/api/v1",
      SYCAMORE_REQUEST_DELAY_MS: "0"
    },
    async () => {
      const result = await runSycamoreDirectSync({
        request: {
          startDate: "2026-03-10",
          endDate: "2026-03-10",
          grade: "8"
        },
        triggeredBy: "manual",
        store,
        config: {
          baseUrl: "https://school.sycamoreeducation.com/api/v1",
          accessToken: "token-123",
          schoolId: "1002",
          disciplinePathTemplate: "/School/{schoolId}/Discipline",
          studentsPathTemplate: "/School/{schoolId}/Students",
          timeoutMs: 2_000,
          maxAttempts: 1,
          retryBaseDelayMs: 1
        },
        dependencies: {
          fetchImpl: async (input) => {
            const url = String(input);
            if (url.endsWith("/School/1002/Students")) {
              return new Response(
                JSON.stringify([
                  { ID: "stu-ext-1", FirstName: "Jane", LastName: "Doe", Grade: "8" },
                  { ID: "stu-ext-2", FirstName: "John", LastName: "Smith", Grade: "7" }
                ]),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }
            if (url.endsWith("/Student/stu-ext-1/Discipline")) {
              return new Response(JSON.stringify([{ ID: "log-4", Date: "2026-03-10", Violation: "Disrespect" }]), {
                status: 200,
                headers: { "Content-Type": "application/json" }
              });
            }
            if (url.endsWith("/Student/stu-ext-1/Discipline/log-4")) {
              return new Response(
                JSON.stringify({
                  Description: "Grade-targeted sync row",
                  Date: "2026-03-10",
                  Author: "Dean Smith",
                  Violation: "Level 2: Disrespect",
                  Resolution: "Lunch detention",
                  Points: "3"
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }
            if (url.includes("/Student/stu-ext-2/")) {
              throw new Error(`Unexpected grade-filtered fetch ${url}`);
            }
            throw new Error(`Unexpected URL ${url}`);
          },
          sleep: async () => {}
        }
      });

      assert.equal(result.status, "success");
      assert.equal(result.recordsDiscovered, 1);
      assert.equal(disciplineLogs.length, 1);
      assert.equal(disciplineLogs[0]?.studentName, "Jane Doe");
      assert.equal(disciplineLogs[0]?.grade, "8");
    }
  );
});

test("resolveSycamoreDirectSyncPlan returns initial backfill when no successful sync exists", async () => {
  const { store } = createInMemorySycamoreStore();

  const plan = await resolveSycamoreDirectSyncPlan({
    store,
    request: {}
  });

  assert.equal(plan.syncMode, "initial_backfill");
  assert.match(plan.window.startDate, /^\d{4}-08-01$/);
  assert.match(plan.window.endDate, /^\d{4}-\d{2}-\d{2}$/);
});

test("resolveSycamoreDirectSyncPlan returns incremental when a successful sync exists", async () => {
  const { store, syncLogs } = createInMemorySycamoreStore();
  syncLogs.unshift({
    id: "sync_success_1",
    triggeredBy: "manual",
    startedAt: "2026-03-10T12:00:00.000Z",
    completedAt: "2026-03-10T12:04:00.000Z",
    recordsSynced: 14,
    recordsDiscovered: 14,
    recordsUpserted: 14,
    status: "success",
    errorMessage: null,
    syncMode: "manual_range",
    windowStartDate: "2026-03-09",
    windowEndDate: "2026-03-10"
  });

  const plan = await resolveSycamoreDirectSyncPlan({
    store,
    request: {}
  });

  assert.equal(plan.syncMode, "incremental");
  assert.deepEqual(plan.window, {
    startDate: "2026-03-10",
    endDate: new Date().toISOString().slice(0, 10)
  });
});

test("sycamoreDirectSyncRequestSchema rejects incremental sync with a grade filter", () => {
  const parsed = sycamoreDirectSyncRequestSchema.safeParse({
    incremental: true,
    grade: "8"
  });

  assert.equal(parsed.success, false);
});

test("backfillSycamoreStudentLinks upserts roster students and links existing Sycamore logs", async () => {
  const { store, disciplineLogs } = createInMemorySycamoreStore();
  disciplineLogs.push({
    sycamoreLogId: "log-existing",
    studentId: "stu-ext-1",
    studentRecordId: null,
    studentName: "Jane Doe",
    grade: "unknown",
    schoolId: "1002",
    incidentDate: "2026-03-10",
    points: 2,
    level: 1,
    violation: "Disrespect",
    violationRaw: "Level 1: Disrespect",
    incidentType: "Level 1: Disrespect",
    description: null,
    resolution: null,
    consequence: null,
    authorName: null,
    authorNameRaw: null,
    assignedBy: null,
    quarter: null,
    createdAtSycamore: null,
    managerNotified: null,
    familyNotified: null,
    studentNotified: null,
    detentionId: null,
    rawPayload: {},
    detentionPayload: null,
    syncedAt: "2026-03-12T12:00:00.000Z"
  });

  const storage = createInMemoryStorage({
    parseRuns: [],
    rawIncidents: [],
    reviewTasks: [],
    students: [
      {
        id: "stu_local_1",
        externalId: null,
        fullName: "Jane Doe",
        grade: "unknown",
        active: true,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z"
      }
    ],
    approvedIncidents: []
  });

  await withEnv(
    {
      SYCAMORE_ACCESS_TOKEN: "token-123",
      SYCAMORE_SCHOOL_ID: "1002",
      SYCAMORE_API_BASE_URL: "https://school.sycamoreeducation.com/api/v1",
      SYCAMORE_ROSTER_SYNC_ENABLED: "true"
    },
    async () => {
      const result = await backfillSycamoreStudentLinks({
        store,
        storage: Object.assign(storage, { ensureSchema: async () => {} }),
        config: {
          baseUrl: "https://school.sycamoreeducation.com/api/v1",
          accessToken: "token-123",
          schoolId: "1002",
          disciplinePathTemplate: "/School/{schoolId}/Discipline",
          studentsPathTemplate: "/School/{schoolId}/Students",
          timeoutMs: 2_000,
          maxAttempts: 1,
          retryBaseDelayMs: 1
        },
        dependencies: {
          fetchImpl: async (input) => {
            const url = String(input);
            if (url.endsWith("/School/1002/Students")) {
              return new Response(
                JSON.stringify([{ ID: "stu-ext-1", FirstName: "Jane", LastName: "Doe", Grade: "8" }]),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }
            throw new Error(`Unexpected URL ${url}`);
          }
        }
      });

      assert.equal(result.attempted, true);
      assert.equal(result.fetchedStudents, 1);
      assert.equal(result.upsertedStudents, 1);
      assert.equal(result.linkedStudents, 1);
      assert.equal(result.linkedDisciplineLogs, 1);

      const students = await storage.students.list();
      assert.equal(students[0]?.externalId, "stu-ext-1");
      assert.equal(students[0]?.grade, "8");
      assert.equal(disciplineLogs[0]?.studentRecordId, "stu_local_1");
    }
  );
});

test("sycamoreDirectSyncRequestSchema requires an explicit date range for targeted grade sync", () => {
  const parsed = sycamoreDirectSyncRequestSchema.safeParse({
    grade: "8"
  });

  assert.equal(parsed.success, false);
});
