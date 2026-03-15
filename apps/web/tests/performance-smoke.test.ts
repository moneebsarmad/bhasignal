import assert from "node:assert/strict";
import test from "node:test";

import { processIngestionUpload } from "../lib/ingestion-workflow";
import { createPolicyVersion, evaluatePolicyAndInterventions } from "../lib/policies";
import { applyReviewAction } from "../lib/review";
import { createInMemoryStorage } from "./review-actions.test";

test.skip("performance smoke: upload-to-policy-evaluation stays within MVP SLA on medium batch", async () => {
  const storage = createInMemoryStorage({
    parseRuns: [],
    rawIncidents: [],
    reviewTasks: []
  });

  const batchSize = 120;
  const t0 = Date.now();
  const ingestion = await processIngestionUpload({
    storage,
    actorEmail: "admin@school.org",
    fileName: "discipline-batch.pdf",
    fileBuffer: Buffer.from("%PDF-1.4\n/Type /Page\n", "latin1"),
    parsePdf: async () => ({
      parserVersion: "parser-v1",
      parsedAt: "2026-02-12T00:00:00.000Z",
      records: Array.from({ length: batchSize }, (_, index) => ({
        student: { value: `Student ${index + 1}`, confidence: 0.98 },
        occurredAt: { value: "2026-02-11T08:00:00Z", confidence: 0.95 },
        points: { value: "1", confidence: 0.96 },
        reason: { value: "Disrespect", confidence: 0.94 },
        teacher: { value: "Teacher A", confidence: 0.92 },
        comment: { value: "Auto-generated test record", confidence: 0.9 },
        sourceSnippet: `row_${index + 1}`,
        recordConfidence: 0.95,
        warnings: []
      })),
      warnings: []
    }),
    sleep: async () => {}
  });

  const tasks = await storage.reviewTasks.listByParseRun(ingestion.parseRun.id);
  for (const task of tasks) {
    await applyReviewAction({
      storage,
      taskId: task.id,
      actorEmail: "reviewer@school.org",
      action: "approve"
    });
  }

  await createPolicyVersion({
    storage,
    actorEmail: "admin@school.org",
    payload: {
      baseThreshold: 10,
      warningOffsets: [-3, -1],
      milestones: [0, 10, 20],
      interventionTemplates: []
    }
  });
  const evaluation = await evaluatePolicyAndInterventions({
    storage,
    actorEmail: "admin@school.org"
  });

  const elapsedMs = Date.now() - t0;
  assert.equal(evaluation.studentsEvaluated, batchSize);
  assert.equal(elapsedMs < 15000, true);
});
