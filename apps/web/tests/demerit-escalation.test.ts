import assert from "node:assert/strict";
import test from "node:test";

import { getDemeritEscalationBand } from "../lib/demerit-escalation";

test("30-point escalation band keeps the certified-letter step without Sycamore file-scanning copy", () => {
  const band = getDemeritEscalationBand(30);

  assert.equal(band.id, "points_30_34");
  assert.match(band.parentCommunication, /certified letter/i);
  assert.match(band.adminAction, /formal certified letter/i);
  assert.doesNotMatch(band.adminAction, /sycamore|student file/i);
  assert.equal(band.policyImpact, "The handbook expects a documented certified letter at 30 points.");
});
