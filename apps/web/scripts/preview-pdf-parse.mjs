#!/usr/bin/env node

import assert from "node:assert/strict";
import { basename, resolve } from "node:path";
import { readFile } from "node:fs/promises";

const parserBaseUrl = process.env.PARSER_BASE_URL || "http://127.0.0.1:8000";

function usage() {
  process.stderr.write("Usage: npm run preview:pdf --workspace @syc/web -- /absolute/or/relative/file.pdf\n");
}

function normalizeField(record, snakeKey, camelKey = null) {
  const field = record?.[snakeKey] ?? (camelKey ? record?.[camelKey] : undefined);
  return {
    value: typeof field?.value === "string" ? field.value : "",
    confidence: typeof field?.confidence === "number" ? field.confidence : null
  };
}

async function main() {
  const fileArg = process.argv[2];
  if (!fileArg) {
    usage();
    process.exitCode = 1;
    return;
  }

  const filePath = resolve(fileArg);
  const fileBuffer = await readFile(filePath);
  assert.ok(fileBuffer.length > 0, "PDF file is empty.");

  const response = await fetch(`${parserBaseUrl}/parse`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      file_name: basename(filePath),
      content_base64: fileBuffer.toString("base64")
    })
  });

  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(`Parser request failed with ${response.status}: ${rawBody}`);
  }

  const payload = rawBody ? JSON.parse(rawBody) : {};
  const records = Array.isArray(payload.records) ? payload.records : [];
  const preview = records.map((record, index) => ({
    index: index + 1,
    studentName: normalizeField(record, "student").value,
    writeupDate: normalizeField(record, "writeup_date", "writeupDate").value,
    occurredAt: normalizeField(record, "occurred_at", "occurredAt").value,
    authorName: normalizeField(record, "author_name", "authorName").value,
    authorNameRaw: normalizeField(record, "author_name_raw", "authorNameRaw").value,
    points: normalizeField(record, "points").value,
    level: normalizeField(record, "level").value,
    violation: normalizeField(record, "violation").value,
    violationRaw: normalizeField(record, "violation_raw", "violationRaw").value,
    description: normalizeField(record, "description").value,
    resolution: normalizeField(record, "resolution").value,
    recordConfidence:
      typeof record?.record_confidence === "number"
        ? record.record_confidence
        : typeof record?.recordConfidence === "number"
          ? record.recordConfidence
          : null,
    warnings: Array.isArray(record?.warnings) ? record.warnings : []
  }));

  process.stdout.write(
    `${JSON.stringify(
      {
        filePath,
        parserBaseUrl,
        parserVersion: payload.parser_version ?? payload.parserVersion ?? "unknown",
        parserWarnings: Array.isArray(payload.warnings) ? payload.warnings : [],
        records: preview
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
