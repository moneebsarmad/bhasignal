import assert from "node:assert/strict";
import test from "node:test";

import type { ParseRun, RawIncident, ReviewTask } from "@syc/domain";

import { processIngestionUpload, IngestionProcessError } from "../lib/ingestion-workflow";
import type { ParseResponse } from "../lib/parser-contract";
import { createInMemoryStorage } from "./review-actions.test";

function makeParseResponse(overrides: Partial<ParseResponse> = {}): ParseResponse {
  return {
    parserVersion: "parser-v1",
    parsedAt: "2026-02-12T00:00:00.000Z",
    records: [
      {
        student: { value: "Jane Doe", confidence: 0.99 },
        occurredAt: { value: "2026-02-11T08:00:00Z", confidence: 0.95 },
        points: { value: "6", confidence: 0.98 },
        reason: { value: "Disrespect", confidence: 0.93 },
        teacher: { value: "Ms Smith", confidence: 0.95 },
        comment: { value: "Spoke out of turn", confidence: 0.9 },
        sourceSnippet: "row_1",
        recordConfidence: 0.97,
        warnings: []
      }
    ],
    warnings: [],
    ...overrides
  };
}

function makePdfBuffer(): Buffer {
  return Buffer.from("%PDF-1.4\n/Type /Page\n/Type /Page\n", "latin1");
}

test("processIngestionUpload persists parse run, raw incidents, review tasks, and audit trail", async () => {
  const storage = createInMemoryStorage({
    parseRuns: [],
    rawIncidents: [],
    reviewTasks: []
  });
  const parseResponse = makeParseResponse({
    records: [
      {
        student: { value: "Jane Doe", confidence: 0.99 },
        occurredAt: { value: "2026-02-11T08:00:00Z", confidence: 0.95 },
        points: { value: "6", confidence: 0.98 },
        reason: { value: "Disrespect", confidence: 0.93 },
        teacher: { value: "Ms Smith", confidence: 0.95 },
        comment: { value: "Spoke out of turn", confidence: 0.9 },
        sourceSnippet: "row_1",
        recordConfidence: 0.97,
        warnings: []
      },
      {
        student: { value: "John Doe", confidence: 0.6 },
        occurredAt: { value: "2026-02-11T09:00:00Z", confidence: 0.7 },
        points: { value: "5", confidence: 0.7 },
        reason: { value: "Class disruption", confidence: 0.65 },
        teacher: { value: "Mr Adams", confidence: 0.9 },
        comment: { value: "Repeated interruptions", confidence: 0.9 },
        sourceSnippet: "row_2",
        recordConfidence: 0.7,
        warnings: ["low_confidence_student"]
      }
    ],
    warnings: ["parser_minor_warning"]
  });

  const result = await processIngestionUpload({
    storage,
    actorEmail: "admin@school.org",
    fileName: "discipline.pdf",
    fileBuffer: makePdfBuffer(),
    parsePdf: async () => parseResponse,
    sleep: async () => {}
  });

  assert.equal(result.parseRun.status, "review_required");
  assert.equal(result.parseRun.rowsExtracted, 2);
  assert.equal(result.parseRun.rowsFlagged, 1);
  assert.equal(result.parserWarnings.length, 1);

  const rawRows = await storage.rawIncidents.listByParseRun(result.parseRun.id);
  const tasks = await storage.reviewTasks.listByParseRun(result.parseRun.id);
  assert.equal(rawRows.length, 2);
  assert.equal(tasks.length, 2);
  assert.equal(rawRows[0]?.violation, "Disrespect");
  assert.equal(rawRows[0]?.description, "Spoke out of turn");

  const events = await storage.auditEvents.listByEntity("parse_run", result.parseRun.id);
  const eventTypes = new Set(events.map((event) => event.eventType));
  assert.equal(eventTypes.has("ingestion_job_created"), true);
  assert.equal(eventTypes.has("ingestion_job_completed"), true);
  assert.equal(eventTypes.has("ingestion_job_warning"), true);
});

test("processIngestionUpload accepts incomplete parser rows for reviewer completion", async () => {
  const storage = createInMemoryStorage({
    parseRuns: [],
    rawIncidents: [],
    reviewTasks: []
  });

  const result = await processIngestionUpload({
    storage,
    actorEmail: "admin@school.org",
    fileName: "discipline.pdf",
    fileBuffer: makePdfBuffer(),
    parsePdf: async () =>
      makeParseResponse({
        records: [
          {
            student: { value: "Jane Doe", confidence: 0.9 },
            occurredAt: { value: "", confidence: 0.0 },
            points: { value: "2", confidence: 0.8 },
            reason: { value: "", confidence: 0.0 },
            teacher: { value: "Ms Smith", confidence: 0.8 },
            comment: { value: "Needs review", confidence: 0.8 },
            sourceSnippet: "row_missing_fields",
            recordConfidence: 0.42,
            warnings: ["missing_occurred_at", "missing_reason", "record_low_confidence"]
          }
        ]
      }),
    sleep: async () => {}
  });

  assert.equal(result.parseRun.status, "review_required");
  assert.equal(result.parseRun.rowsExtracted, 1);
  assert.equal(result.parseRun.rowsFlagged, 1);

  const rawRows = await storage.rawIncidents.listByParseRun(result.parseRun.id);
  assert.equal(rawRows.length, 1);
  assert.equal(rawRows[0]?.studentReference, "Jane Doe");
  assert.equal(rawRows[0]?.occurredAt, "");
  assert.equal(rawRows[0]?.reason, "");
});

test("processIngestionUpload retries transient parser errors then marks parse run failed", async () => {
  const storage = createInMemoryStorage({
    parseRuns: [],
    rawIncidents: [],
    reviewTasks: []
  });

  let attempts = 0;
  const parser = async () => {
    attempts += 1;
    throw new Error("Parser service returned 503");
  };

  await assert.rejects(
    async () =>
      processIngestionUpload({
        storage,
        actorEmail: "admin@school.org",
        fileName: "discipline.pdf",
        fileBuffer: makePdfBuffer(),
        parsePdf: parser,
        retryMaxAttempts: 3,
        retryBaseDelayMs: 1,
        sleep: async () => {}
      }),
    (error: unknown) => error instanceof IngestionProcessError
  );

  assert.equal(attempts, 3);
  const runs = await storage.parseRuns.list();
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.status, "failed");

  const runId = runs[0]?.id || "";
  const events = await storage.auditEvents.listByEntity("parse_run", runId);
  assert.equal(events.some((event) => event.eventType === "ingestion_job_failed"), true);
});

test("processIngestionUpload retry reuses parse run and rejects stale rows without duplication", async () => {
  const parseRun: ParseRun = {
    id: "run_retry_1",
    sourceType: "manual_pdf",
    fileName: "discipline.pdf",
    uploadedBy: "admin@school.org",
    triggeredBy: "admin@school.org",
    metadataJson: "{}",
    cursorJson: null,
    status: "failed",
    rowsExtracted: 2,
    rowsFlagged: 2,
    startedAt: "2026-02-12T00:00:00.000Z",
    completedAt: "2026-02-12T00:00:10.000Z"
  };
  const staleRawA: RawIncident = {
    id: "run_retry_1:raw:0001",
    parseRunId: "run_retry_1",
    sourceType: "manual_pdf",
    sourceRecordId: "pdf_row_0001",
    studentReference: "Jane Doe",
    externalStudentId: null,
    gradeAtEvent: null,
    eventType: null,
    occurredAt: "2026-02-11T08:00:00Z",
    points: 4,
    reason: "Disrespect",
    comment: "Prior parse",
    teacherName: "Ms Smith",
    sourcePayloadJson: "{}",
    mappingWarningsJson: "[]",
    confidenceJson: "{}",
    status: "pending_review"
  };
  const staleRawB: RawIncident = {
    id: "run_retry_1:raw:0002",
    parseRunId: "run_retry_1",
    sourceType: "manual_pdf",
    sourceRecordId: "pdf_row_0002",
    studentReference: "John Doe",
    externalStudentId: null,
    gradeAtEvent: null,
    eventType: null,
    occurredAt: "2026-02-11T09:00:00Z",
    points: 4,
    reason: "Disrespect",
    comment: "Will become stale",
    teacherName: "Ms Smith",
    sourcePayloadJson: "{}",
    mappingWarningsJson: "[]",
    confidenceJson: "{}",
    status: "pending_review"
  };
  const staleTaskA: ReviewTask = {
    id: "task_a",
    parseRunId: "run_retry_1",
    rawIncidentId: staleRawA.id,
    assignee: null,
    status: "open",
    resolution: "",
    createdAt: "2026-02-12T00:00:00.000Z",
    resolvedAt: null
  };
  const staleTaskB: ReviewTask = {
    id: "task_b",
    parseRunId: "run_retry_1",
    rawIncidentId: staleRawB.id,
    assignee: null,
    status: "open",
    resolution: "",
    createdAt: "2026-02-12T00:00:00.000Z",
    resolvedAt: null
  };
  const storage = createInMemoryStorage({
    parseRuns: [parseRun],
    rawIncidents: [staleRawA, staleRawB],
    reviewTasks: [staleTaskA, staleTaskB]
  });
  const firstRecord = makeParseResponse().records[0];
  assert.ok(firstRecord);

  const result = await processIngestionUpload({
    storage,
    actorEmail: "admin@school.org",
    fileName: "discipline.pdf",
    fileBuffer: makePdfBuffer(),
    retryParseRunId: "run_retry_1",
    parsePdf: async () =>
      makeParseResponse({
        records: [firstRecord]
      }),
    sleep: async () => {}
  });

  assert.equal(result.parseRun.id, "run_retry_1");
  assert.equal(result.parseRun.status, "review_required");
  assert.equal(result.parseRun.rowsExtracted, 1);

  const rawRows = await storage.rawIncidents.listByParseRun("run_retry_1");
  const staleRejected = rawRows.find((row) => row.id === "run_retry_1:raw:0002");
  assert.equal(staleRejected?.status, "rejected");

  const tasks = await storage.reviewTasks.listByParseRun("run_retry_1");
  const taskA = tasks.find((task) => task.rawIncidentId === "run_retry_1:raw:0001");
  const taskB = tasks.find((task) => task.rawIncidentId === "run_retry_1:raw:0002");
  assert.equal(taskA?.status, "open");
  assert.equal(taskB?.status, "rejected");
  assert.equal(taskB?.resolution, "stale_after_retry");
});
