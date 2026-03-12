import assert from "node:assert/strict";
import test from "node:test";

import { confidenceBand, stableStudentId } from "../lib/review";

test("confidenceBand assigns expected buckets", () => {
  assert.equal(confidenceBand(null), "unknown");
  assert.equal(confidenceBand(0.2), "low");
  assert.equal(confidenceBand(0.8), "medium");
  assert.equal(confidenceBand(0.95), "high");
});

test("stableStudentId is deterministic and whitespace-insensitive", () => {
  const first = stableStudentId(" Jane   Doe ");
  const second = stableStudentId("jane doe");
  assert.equal(first, second);
  assert.match(first, /^stu_/);
});
