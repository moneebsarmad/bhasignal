import assert from "node:assert/strict";
import test from "node:test";

import type { ApprovedIncident, Policy, Student } from "@syc/domain";

import { SheetsAdapter, type SheetsClient } from "../src/index";

class InMemorySheetsClient implements SheetsClient {
  private readonly tabs = new Map<string, string[][]>();

  private tabName(range: string): string {
    const [tab] = range.split("!");
    return tab;
  }

  private clone(rows: string[][]): string[][] {
    return rows.map((row) => [...row]);
  }

  async read(range: string): Promise<string[][]> {
    const tab = this.tabName(range);
    return this.clone(this.tabs.get(tab) ?? []);
  }

  async update(range: string, values: string[][]): Promise<void> {
    const tab = this.tabName(range);
    const rows = this.tabs.get(tab) ?? [];

    const rowMatch = range.match(/A(\d+)/);
    if (!rowMatch) {
      throw new Error(`Unsupported range format for update: ${range}`);
    }
    const rowNumber = Number(rowMatch[1]);
    const rowIndex = rowNumber - 1;
    while (rows.length <= rowIndex) {
      rows.push([]);
    }
    rows[rowIndex] = [...(values[0] ?? [])];
    this.tabs.set(tab, rows);
  }

  async append(range: string, values: string[][]): Promise<void> {
    const tab = this.tabName(range);
    const rows = this.tabs.get(tab) ?? [];
    values.forEach((row) => rows.push([...row]));
    this.tabs.set(tab, rows);
  }
}

function sampleStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: "stu_1",
    externalId: null,
    fullName: "Jane Doe",
    grade: "7",
    active: true,
    createdAt: "2026-02-12T00:00:00Z",
    updatedAt: "2026-02-12T00:00:00Z",
    ...overrides
  };
}

function sampleIncident(overrides: Partial<ApprovedIncident> = {}): ApprovedIncident {
  return {
    id: "inc_1",
    studentId: "stu_1",
    sourceType: "manual_pdf",
    sourceRecordId: "pdf_row_0001",
    externalStudentId: null,
    gradeAtEvent: "7",
    eventType: null,
    occurredAt: "2026-02-12T12:00:00Z",
    writeupDate: "2026-02-12",
    points: 3,
    reason: "Disrespect",
    violation: "Disrespect",
    violationRaw: "Level 2: Disrespect",
    level: 2,
    comment: "Talking back",
    description: "Talking back",
    resolution: null,
    teacherName: "Ms Smith",
    authorName: "Ms Smith",
    authorNameRaw: "Smith, Ms",
    sourceJobId: "job_1",
    fingerprint: "fp_1",
    reviewedBy: "reviewer@school.org",
    reviewedAt: "2026-02-12T13:00:00Z",
    ...overrides
  };
}

function samplePolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    version: 1,
    baseThreshold: 10,
    warningOffsets: [-3, -1],
    milestones: [10, 15, 20],
    interventionTemplates: "{\"10\":\"call-home\"}",
    createdBy: "admin@school.org",
    createdAt: "2026-02-12T00:00:00Z",
    ...overrides
  };
}

test("ensureSchema writes headers for all tabs", async () => {
  const client = new InMemorySheetsClient();
  const adapter = new SheetsAdapter(client);
  await adapter.ensureSchema();

  const studentHeader = await client.read("students!A1:ZZ1");
  const approvedIncidentHeader = await client.read("incidents_approved!A1:ZZ1");

  assert.equal(studentHeader[0]?.[0], "student_id");
  assert.equal(approvedIncidentHeader[0]?.[0], "incident_id");
});

test("student upsert is idempotent by student_id", async () => {
  const client = new InMemorySheetsClient();
  const adapter = new SheetsAdapter(client);
  await adapter.ensureSchema();

  await adapter.students.upsert(sampleStudent());
  await adapter.students.upsert(sampleStudent({ grade: "8", updatedAt: "2026-02-13T00:00:00Z" }));

  const list = await adapter.students.list();
  assert.equal(list.length, 1);
  assert.equal(list[0]?.grade, "8");
});

test("approved incident upsert deduplicates by fingerprint", async () => {
  const client = new InMemorySheetsClient();
  const adapter = new SheetsAdapter(client);
  await adapter.ensureSchema();

  await adapter.approvedIncidents.upsert(sampleIncident({ id: "inc_1", fingerprint: "fp_same", points: 3 }));
  await adapter.approvedIncidents.upsert(sampleIncident({ id: "inc_2", fingerprint: "fp_same", points: 5 }));

  const list = await adapter.approvedIncidents.list();
  assert.equal(list.length, 1);
  assert.equal(list[0]?.id, "inc_1");
  assert.equal(list[0]?.points, 5);
  assert.equal(list[0]?.writeupDate, "2026-02-12");
  assert.equal(list[0]?.level, 2);
});

test("policy repository returns latest version", async () => {
  const client = new InMemorySheetsClient();
  const adapter = new SheetsAdapter(client);
  await adapter.ensureSchema();

  await adapter.policies.upsert(samplePolicy({ version: 1 }));
  await adapter.policies.upsert(samplePolicy({ version: 2, baseThreshold: 12 }));

  const latest = await adapter.policies.getLatest();
  assert.ok(latest);
  assert.equal(latest?.version, 2);
  assert.equal(latest?.baseThreshold, 12);
});

test("adapter surfaces Sheets rate-limit failures with actionable error", async () => {
  class RateLimitedClient implements SheetsClient {
    async read(): Promise<string[][]> {
      return [];
    }
    async update(): Promise<void> {
      throw new Error("Google API 429 RESOURCE_EXHAUSTED: quota exceeded");
    }
    async append(): Promise<void> {
      throw new Error("Google API 429 RESOURCE_EXHAUSTED: quota exceeded");
    }
  }

  const adapter = new SheetsAdapter(new RateLimitedClient());
  await assert.rejects(async () => adapter.ensureSchema(), /429 RESOURCE_EXHAUSTED/);
});
