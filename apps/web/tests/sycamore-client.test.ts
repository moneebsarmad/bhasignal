import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchSycamoreDetentionDetail,
  fetchSycamoreDisciplineLogDetail,
  fetchSycamoreStudentDisciplineOverview,
  fetchSycamoreStudents,
  fetchSycamoreDisciplineRange,
  getSycamoreClientConfigFromEnv
} from "../lib/sycamore-client";

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

test("getSycamoreClientConfigFromEnv prefers the new token env and defaults the path template", () => {
  withEnv(
    {
      SYCAMORE_ACCESS_TOKEN: "token-123",
      SYCAMORE_API_ACCESS_TOKEN: "legacy-token",
      SYCAMORE_API_TOKEN: undefined,
      SYCAMORE_SCHOOL_ID: "1002",
      SYCAMORE_API_BASE_URL: "https://school.sycamoreeducation.com/api/v1/"
    },
    () => {
      const config = getSycamoreClientConfigFromEnv();
      assert.equal(config.accessToken, "token-123");
      assert.equal(config.schoolId, "1002");
      assert.equal(config.baseUrl, "https://school.sycamoreeducation.com/api/v1");
      assert.equal(config.disciplinePathTemplate, "/School/{schoolId}/Discipline");
      assert.equal(config.studentsPathTemplate, "/School/{schoolId}/Students");
    }
  );
});

test("fetchSycamoreDisciplineLogDetail and fetchSycamoreDetentionDetail call the student detail endpoints", async () => {
  const seenUrls: string[] = [];
  const config = {
    baseUrl: "https://school.sycamoreeducation.com/api/v1",
    accessToken: "secret-token",
    schoolId: "1002",
    disciplinePathTemplate: "/School/{schoolId}/Discipline",
    studentsPathTemplate: "/School/{schoolId}/Students",
    timeoutMs: 2_000,
    maxAttempts: 1,
    retryBaseDelayMs: 1
  };

  const fetchImpl: typeof fetch = async (input) => {
    seenUrls.push(String(input));
    return new Response(JSON.stringify({ Data: { ID: "detail-1" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const disciplineDetail = await fetchSycamoreDisciplineLogDetail("student-99", "log-44", config, { fetchImpl });
  const detentionDetail = await fetchSycamoreDetentionDetail("student-99", "det-5", config, { fetchImpl });

  assert.equal(seenUrls[0], "https://school.sycamoreeducation.com/api/v1/Student/student-99/Discipline/log-44");
  assert.equal(seenUrls[1], "https://school.sycamoreeducation.com/api/v1/Student/student-99/Detention/det-5");
  assert.equal(disciplineDetail.ID, "detail-1");
  assert.equal(detentionDetail.ID, "detail-1");
});

test("fetchSycamoreDisciplineRange fans out by date and uses bearer auth", async () => {
  const seenUrls: string[] = [];
  const seenAuth: string[] = [];
  const config = {
    baseUrl: "https://school.sycamoreeducation.com/api/v1",
    accessToken: "secret-token",
    schoolId: "1002",
    disciplinePathTemplate: "/School/{schoolId}/Discipline",
    studentsPathTemplate: "/School/{schoolId}/Students",
    timeoutMs: 2_000,
    maxAttempts: 2,
    retryBaseDelayMs: 1
  };

  const result = await fetchSycamoreDisciplineRange(
    {
      startDate: "2026-03-01",
      endDate: "2026-03-02"
    },
    config,
    {
      fetchImpl: async (input, init) => {
        seenUrls.push(String(input));
        seenAuth.push(String(init?.headers && (init.headers as Record<string, string>).Authorization));

        if (String(input).includes("Date=2026-03-01")) {
          return new Response(JSON.stringify({ Data: [{ ID: "1", Student: "Jane Doe", Points: "4" }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }

        return new Response(JSON.stringify({ Data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
  );

  assert.equal(seenUrls.length, 2);
  assert.equal(seenUrls[0]?.includes("/School/1002/Discipline"), true);
  assert.equal(seenUrls[0]?.includes("Date=2026-03-01"), true);
  assert.equal(seenUrls[1]?.includes("Date=2026-03-02"), true);
  assert.deepEqual(seenAuth, ["Bearer secret-token", "Bearer secret-token"]);
  assert.equal(result.records.length, 1);
  assert.equal(result.warnings.includes("sycamore_no_records:2026-03-02"), true);
});

test("fetchSycamoreDisciplineRange retries transient upstream failures", async () => {
  let attempts = 0;
  const config = {
    baseUrl: "https://school.sycamoreeducation.com/api/v1",
    accessToken: "secret-token",
    schoolId: "1002",
    disciplinePathTemplate: "/School/{schoolId}/Discipline",
    studentsPathTemplate: "/School/{schoolId}/Students",
    timeoutMs: 2_000,
    maxAttempts: 3,
    retryBaseDelayMs: 1
  };

  const result = await fetchSycamoreDisciplineRange(
    {
      startDate: "2026-03-01",
      endDate: "2026-03-01"
    },
    config,
    {
      fetchImpl: async () => {
        attempts += 1;
        if (attempts < 3) {
          return new Response("temporarily unavailable", { status: 503 });
        }
        return new Response(JSON.stringify([{ ID: "1" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      },
      sleep: async () => {}
    }
  );

  assert.equal(attempts, 3);
  assert.equal(result.records.length, 1);
});

test("fetchSycamoreDisciplineRange treats 204 responses as empty days", async () => {
  const config = {
    baseUrl: "https://school.sycamoreeducation.com/api/v1",
    accessToken: "secret-token",
    schoolId: "1002",
    disciplinePathTemplate: "/School/{schoolId}/Discipline",
    studentsPathTemplate: "/School/{schoolId}/Students",
    timeoutMs: 2_000,
    maxAttempts: 1,
    retryBaseDelayMs: 1
  };

  const result = await fetchSycamoreDisciplineRange(
    {
      startDate: "2026-03-02",
      endDate: "2026-03-02"
    },
    config,
    {
      fetchImpl: async () => new Response(null, { status: 204 })
    }
  );

  assert.equal(result.records.length, 0);
  assert.equal(result.warnings.includes("sycamore_no_records:2026-03-02"), true);
});

test("fetchSycamoreStudents requests the school roster", async () => {
  const seenUrls: string[] = [];
  const config = {
    baseUrl: "https://school.sycamoreeducation.com/api/v1",
    accessToken: "secret-token",
    schoolId: "1002",
    disciplinePathTemplate: "/School/{schoolId}/Discipline",
    studentsPathTemplate: "/School/{schoolId}/Students",
    timeoutMs: 2_000,
    maxAttempts: 1,
    retryBaseDelayMs: 1
  };

  const students = await fetchSycamoreStudents(config, {
    fetchImpl: async (input) => {
      seenUrls.push(String(input));
      return new Response(JSON.stringify([{ ID: "student-1", FirstName: "Jane", LastName: "Doe" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  assert.equal(seenUrls[0]?.includes("/School/1002/Students"), true);
  assert.equal(students.length, 1);
});

test("fetchSycamoreStudentDisciplineOverview requests the live student overview endpoint", async () => {
  const seenUrls: string[] = [];
  const config = {
    baseUrl: "https://school.sycamoreeducation.com/api/v1",
    accessToken: "secret-token",
    schoolId: "1002",
    disciplinePathTemplate: "/School/{schoolId}/Discipline",
    studentsPathTemplate: "/School/{schoolId}/Students",
    timeoutMs: 2_000,
    maxAttempts: 1,
    retryBaseDelayMs: 1
  };

  const records = await fetchSycamoreStudentDisciplineOverview("student-1", config, {
    fetchImpl: async (input) => {
      seenUrls.push(String(input));
      return new Response(JSON.stringify([{ ID: "log-1", Date: "2026-03-10" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  assert.equal(seenUrls[0], "https://school.sycamoreeducation.com/api/v1/Student/student-1/Discipline");
  assert.equal(records.length, 1);
});
