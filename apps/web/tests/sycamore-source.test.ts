import assert from "node:assert/strict";
import test from "node:test";

import { syncSycamoreDiscipline } from "../lib/sycamore-source";
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

test("syncSycamoreDiscipline stages API incidents through the shared review pipeline", async () => {
  const storage = createInMemoryStorage({
    parseRuns: [],
    rawIncidents: [],
    reviewTasks: []
  });

  await withEnv(
    {
      SYCAMORE_API_ACCESS_TOKEN: "token-123",
      SYCAMORE_SCHOOL_ID: "1002",
      SYCAMORE_API_BASE_URL: "https://school.sycamoreeducation.com/api/v1",
      SYCAMORE_DISCIPLINE_PATH_TEMPLATE: "/School/{schoolId}/Discipline",
      SYCAMORE_STUDENTS_PATH_TEMPLATE: "/School/{schoolId}/Students"
    },
    async () => {
      const result = await syncSycamoreDiscipline({
        storage,
        actorEmail: "admin@school.org",
        request: {
          date: "2026-03-10"
        },
        dependencies: {
          fetchImpl: async (input) => {
            if (String(input).includes("/Students")) {
              return new Response(
                JSON.stringify([
                  {
                    ID: "student-1",
                    StudentCode: "DOE100",
                    FirstName: "Jane",
                    LastName: "Doe",
                    Grade: "7"
                  }
                ]),
                {
                  status: 200,
                  headers: { "Content-Type": "application/json" }
                }
              );
            }

            return new Response(
              JSON.stringify({
                Data: [
                  {
                    ID: "disc-1",
                    StudentID: "student-1",
                    Student: "Jane Doe",
                    Grade: "7",
                    Violation: "Disrespect",
                    Description: "Repeated classroom disruption",
                    Points: "4",
                    Created: "2026-03-10T14:05:00Z",
                    Author: "Ms Smith"
                  }
                ]
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" }
              }
            );
          }
        }
      });

      assert.equal(result.parseRun.sourceType, "sycamore_api");
      assert.equal(result.parseRun.rowsExtracted, 1);
      assert.equal(result.parseRun.status, "review_required");
      assert.equal(result.fetchedRecords, 1);
      assert.equal(result.syncMode, "manual_range");
      assert.equal(result.rosterSync.attempted, true);
      assert.equal(result.rosterSync.upsertedStudents, 1);
      assert.deepEqual(result.dateWindow, {
        startDate: "2026-03-10",
        endDate: "2026-03-10"
      });

      const rawRows = await storage.rawIncidents.listByParseRun(result.parseRun.id);
      const reviewTasks = await storage.reviewTasks.listByParseRun(result.parseRun.id);
      const events = await storage.auditEvents.listByEntity("parse_run", result.parseRun.id);
      const students = await storage.students.list();

      assert.equal(rawRows.length, 1);
      assert.equal(reviewTasks.length, 1);
      assert.equal(students.length, 1);
      assert.equal(students[0]?.externalId, "student-1");
      assert.equal(rawRows[0]?.sourceType, "sycamore_api");
      assert.equal(rawRows[0]?.sourceRecordId, "disc-1");
      assert.equal(rawRows[0]?.externalStudentId, "student-1");
      assert.equal(rawRows[0]?.gradeAtEvent, "7");
      assert.equal(events.some((event) => event.eventType === "ingestion_job_created"), true);
      assert.equal(events.some((event) => event.eventType === "ingestion_job_completed"), true);
    }
  );
});

test("syncSycamoreDiscipline resolves incremental windows from the latest successful cursor", async () => {
  const storage = createInMemoryStorage({
    parseRuns: [
      {
        id: "run_prev",
        sourceType: "sycamore_api",
        fileName: "sycamore-discipline-2026-03-08_to_2026-03-08.json",
        uploadedBy: "admin@school.org",
        triggeredBy: "admin@school.org",
        metadataJson: "{\"startDate\":\"2026-03-08\",\"endDate\":\"2026-03-08\",\"syncMode\":\"manual_range\"}",
        cursorJson: "{\"endDate\":\"2026-03-08\",\"syncMode\":\"manual_range\"}",
        status: "review_required",
        rowsExtracted: 1,
        rowsFlagged: 1,
        startedAt: "2026-03-08T09:00:00.000Z",
        completedAt: "2026-03-08T09:05:00.000Z"
      }
    ],
    rawIncidents: [],
    reviewTasks: []
  });
  const seenUrls: string[] = [];

  await withEnv(
    {
      SYCAMORE_API_ACCESS_TOKEN: "token-123",
      SYCAMORE_SCHOOL_ID: "1002",
      SYCAMORE_API_BASE_URL: "https://school.sycamoreeducation.com/api/v1",
      SYCAMORE_DISCIPLINE_PATH_TEMPLATE: "/School/{schoolId}/Discipline",
      SYCAMORE_STUDENTS_PATH_TEMPLATE: "/School/{schoolId}/Students",
      SYCAMORE_INCREMENTAL_OVERLAP_DAYS: "1",
      SYCAMORE_SYNC_TODAY: "2026-03-11"
    },
    async () => {
      const result = await syncSycamoreDiscipline({
        storage,
        actorEmail: "admin@school.org",
        request: {
          incremental: true
        },
        dependencies: {
          fetchImpl: async (input) => {
            seenUrls.push(String(input));
            if (String(input).includes("/Students")) {
              return new Response(JSON.stringify([]), {
                status: 200,
                headers: { "Content-Type": "application/json" }
              });
            }

            return new Response(null, {
              status: 204
            });
          }
        }
      });

      assert.equal(result.syncMode, "incremental");
      assert.deepEqual(result.dateWindow, {
        startDate: "2026-03-07",
        endDate: "2026-03-11"
      });
      assert.equal(seenUrls.some((url) => url.includes("Date=2026-03-07")), true);
      assert.equal(seenUrls.some((url) => url.includes("Date=2026-03-11")), true);
    }
  );
});
