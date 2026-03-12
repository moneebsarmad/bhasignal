import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRawIncident,
  buildReviewTask,
  countPdfPages,
  createPendingParseRun,
  shouldRequireReview
} from "../lib/ingestion";
import type { ParseRecord } from "../lib/parser-contract";

function makeRecord(overrides: Partial<ParseRecord> = {}): ParseRecord {
  return {
    student: { value: "Jane Doe", confidence: 0.99 },
    occurredAt: { value: "2026-02-11T08:15:00", confidence: 0.97 },
    writeupDate: { value: "2026-02-11", confidence: 0.97 },
    points: { value: "3", confidence: 0.98 },
    reason: { value: "Disrespect", confidence: 0.94 },
    violation: { value: "Disrespect", confidence: 0.94 },
    violationRaw: { value: "Level 2: Disrespect", confidence: 0.94 },
    level: { value: "2", confidence: 0.98 },
    teacher: { value: "Mr. Adams", confidence: 0.93 },
    authorName: { value: "Mr. Adams", confidence: 0.93 },
    authorNameRaw: { value: "Adams, Mr.", confidence: 0.93 },
    comment: { value: "Talking back in class", confidence: 0.88 },
    description: { value: "Talking back in class", confidence: 0.88 },
    resolution: { value: "", confidence: 1 },
    sourceSnippet: "source row",
    recordConfidence: 0.95,
    warnings: [],
    ...overrides
  };
}

test("countPdfPages uses /Type /Page markers", () => {
  const bytes = Buffer.from(
    "%PDF-1.4\n/Type /Catalog\n/Type /Page\n/Type /Page\n/Type /Pages\n",
    "latin1"
  );
  assert.equal(countPdfPages(bytes), 2);
});

test("createPendingParseRun initializes ingestion lifecycle fields", () => {
  const run = createPendingParseRun({
    id: "run-1",
    fileName: "discipline.pdf",
    uploadedBy: "admin@school.org",
    startedAt: "2026-02-12T00:00:00.000Z"
  });

  assert.equal(run.status, "pending");
  assert.equal(run.rowsExtracted, 0);
  assert.equal(run.rowsFlagged, 0);
  assert.equal(run.completedAt, null);
});

test("buildRawIncident carries parser teacher and confidence payload", () => {
  const incident = buildRawIncident({
    parseRunId: "run-55",
    record: makeRecord(),
    rowNumber: 7
  });

  assert.equal(incident.id, "run-55:raw:0007");
  assert.equal(incident.teacherName, "Mr. Adams");
  assert.equal(incident.writeupDate, "2026-02-11");
  assert.equal(incident.level, 2);
  assert.equal(incident.violation, "Disrespect");
  assert.equal(incident.authorNameRaw, "Adams, Mr.");
  assert.equal(incident.points, 3);
  assert.equal(incident.status, "pending_review");
  assert.match(incident.confidenceJson, /recordConfidence/);
});

test("buildReviewTask uses stable id for parse-run + raw pair", () => {
  const task = buildReviewTask({
    parseRunId: "run-55",
    rawIncidentId: "run-55:raw:0007",
    createdAt: "2026-02-12T00:00:00.000Z"
  });
  assert.equal(task.id, "run-55:review:run-55:raw:0007");
  assert.equal(task.status, "open");
});

test("shouldRequireReview returns true when critical confidence is low", () => {
  const shouldReview = shouldRequireReview(
    makeRecord({
      points: { value: "3", confidence: 0.5 },
      warnings: []
    })
  );
  assert.equal(shouldReview, true);
});

test("shouldRequireReview returns false for high-confidence clean row", () => {
  const shouldReview = shouldRequireReview(makeRecord());
  assert.equal(shouldReview, false);
});
