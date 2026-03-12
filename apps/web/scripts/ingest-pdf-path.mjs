#!/usr/bin/env node

import assert from "node:assert/strict";
import { basename, resolve } from "node:path";
import { readFile } from "node:fs/promises";

const baseUrl = process.env.INGEST_BASE_URL || process.env.SMOKE_BASE_URL || "http://127.0.0.1:3003";

function usage() {
  process.stderr.write("Usage: npm run ingest:pdf --workspace @syc/web -- /absolute/or/relative/file.pdf\n");
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  assert.ok(value, `Missing required environment variable: ${name}`);
  return value;
}

async function jsonRequest(path, options = {}, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const raw = await response.text();
  if (expectedStatus !== undefined) {
    assert.equal(response.status, expectedStatus, `${path} expected ${expectedStatus}, got ${response.status}: ${raw}`);
  }

  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }

  return { response, payload, raw };
}

async function login(email, password) {
  const { response, payload } = await jsonRequest(
    "/api/auth/login",
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ email, password })
    },
    200
  );

  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, "Expected auth cookie on login response.");
  return {
    cookie: setCookie.split(";")[0],
    role: payload?.role ?? "unknown"
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
  const adminEmail = requireEnv("AUTH_ADMIN_EMAIL");
  const adminPassword = requireEnv("AUTH_ADMIN_PASSWORD");

  const admin = await login(adminEmail, adminPassword);
  assert.ok(admin.cookie, "Admin login did not return an auth cookie.");

  const form = new FormData();
  form.append("file", new Blob([fileBuffer], { type: "application/pdf" }), basename(filePath));

  const upload = await jsonRequest(
    "/api/ingestion/upload",
    {
      method: "POST",
      headers: {
        cookie: admin.cookie
      },
      body: form
    },
    200
  );

  const parseRunId = upload.payload?.parseRun?.id;
  assert.ok(parseRunId, "Expected parseRun.id from ingestion response.");

  const queue = await jsonRequest(
    `/api/review/queue?status=open&parseRunId=${encodeURIComponent(parseRunId)}`,
    {
      headers: {
        cookie: admin.cookie
      }
    },
    200
  );

  const items = Array.isArray(queue.payload?.items) ? queue.payload.items : [];
  const queuePreview = items.map((item, index) => ({
    index: index + 1,
    taskId: item?.task?.id ?? null,
    sourceType: item?.rawIncident?.sourceType ?? null,
    studentName: item?.rawIncident?.studentReference ?? null,
    writeupDate: item?.rawIncident?.writeupDate ?? null,
    authorName: item?.rawIncident?.authorName ?? item?.rawIncident?.teacherName ?? null,
    points: item?.rawIncident?.points ?? null,
    level: item?.rawIncident?.level ?? null,
    violation: item?.rawIncident?.violation ?? item?.rawIncident?.reason ?? null,
    resolution: item?.rawIncident?.resolution ?? null,
    recordConfidence: item?.recordConfidence ?? null,
    warnings: Array.isArray(item?.parseWarnings) ? item.parseWarnings : []
  }));

  process.stdout.write(
    `${JSON.stringify(
      {
        filePath,
        baseUrl,
        parseRun: upload.payload?.parseRun ?? null,
        parserVersion: upload.payload?.parserVersion ?? null,
        parserWarnings: upload.payload?.parserWarnings ?? [],
        reviewQueue: queuePreview
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
