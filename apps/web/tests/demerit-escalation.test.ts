import assert from "node:assert/strict";
import test from "node:test";

import { escalationBandOptions, getDemeritEscalationBand } from "../lib/demerit-escalation";

test("30-point totals now stay in the 20-plus escalation tier", () => {
  const band = getDemeritEscalationBand(30);

  assert.equal(band.id, "points_20_29");
  assert.equal(band.label, "20 to 34 points");
  assert.equal(band.shortLabel, "20-34");
  assert.equal(band.parentCommunication, "Parents should meet with BHA administration.");
  assert.doesNotMatch(band.adminAction, /certified letter/i);
});

test("escalation options no longer expose a separate 30-point band", () => {
  const options = escalationBandOptions();

  assert.equal(options.some((option) => option.id === "points_30_34"), false);
  assert.equal(options.some((option) => option.label === "30 to 34 points"), false);
  assert.equal(options.some((option) => option.label === "20 to 34 points"), true);
});
