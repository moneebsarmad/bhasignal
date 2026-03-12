import assert from "node:assert/strict";
import test from "node:test";

import { createIncidentFingerprint } from "../src/index";

test("createIncidentFingerprint is deterministic", () => {
  const base = {
    studentReference: "Jane Doe",
    occurredAt: "2026-02-11T08:15:00Z",
    points: 3,
    reason: "Disrespect",
    comment: "Talking over teacher",
    teacherName: "Ms. Smith",
    sourceJobId: "job_123"
  };

  const first = createIncidentFingerprint(base);
  const second = createIncidentFingerprint(base);
  assert.equal(first, second);
});

test("createIncidentFingerprint normalizes spacing and casing", () => {
  const first = createIncidentFingerprint({
    studentReference: "  JANE DOE ",
    occurredAt: "2026-02-11T08:15:00Z",
    points: 3,
    reason: "  Disrespect ",
    comment: "Talking   over teacher ",
    teacherName: "MS. SMITH",
    sourceJobId: "JOB_123"
  });

  const second = createIncidentFingerprint({
    studentReference: "jane doe",
    occurredAt: "2026-02-11t08:15:00z",
    points: 3,
    reason: "disrespect",
    comment: "talking over teacher",
    teacherName: "ms. smith",
    sourceJobId: "job_123"
  });

  assert.equal(first, second);
});

test("createIncidentFingerprint dedupes Sycamore incidents by source record across sync jobs", () => {
  const first = createIncidentFingerprint({
    sourceType: "sycamore_api",
    sourceRecordId: "DISC-100",
    studentReference: "Jane Doe",
    occurredAt: "2026-02-11T08:15:00Z",
    points: 3,
    reason: "Disrespect",
    comment: "Talking over teacher",
    teacherName: "Ms. Smith",
    sourceJobId: "job_123"
  });

  const second = createIncidentFingerprint({
    sourceType: "sycamore_api",
    sourceRecordId: " disc-100 ",
    studentReference: "Different Name",
    occurredAt: "2026-03-01T10:00:00Z",
    points: 9,
    reason: "Different Reason",
    comment: "Different Comment",
    teacherName: "Different Teacher",
    sourceJobId: "job_999"
  });

  assert.equal(first, second);
});
