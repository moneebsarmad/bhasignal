#!/usr/bin/env node

import { strict as assert } from "node:assert";

const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3003";
const maxAttempts = Number(process.env.SMOKE_MAX_ATTEMPTS || "6");
const baseRetryMs = Number(process.env.SMOKE_RETRY_BASE_MS || "2000");

function logStep(message) {
  process.stdout.write(`\n[smoke] ${message}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  assert.ok(value, `Missing required environment variable: ${name}`);
  return value;
}

function shouldRetry(status, bodySnippet) {
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  const body = (bodySnippet || "").toLowerCase();
  return body.includes("quota exceeded") || body.includes("resource_exhausted");
}

async function request(path, options = {}, expectedStatus) {
  let attempt = 1;
  while (true) {
    const response = await fetch(`${baseUrl}${path}`, {
      redirect: "manual",
      ...options
    });

    if (expectedStatus === undefined || response.status === expectedStatus) {
      return response;
    }

    const bodySnippet = (await response.text()).slice(0, 500);
    if (attempt < maxAttempts && shouldRetry(response.status, bodySnippet)) {
      const waitMs = baseRetryMs * 2 ** (attempt - 1);
      process.stdout.write(
        `[smoke] retrying ${path} after status ${response.status} (attempt ${attempt + 1}/${maxAttempts})\n`
      );
      await sleep(waitMs);
      attempt += 1;
      continue;
    }

    assert.equal(
      response.status,
      expectedStatus,
      `Expected ${expectedStatus} for ${path}, got ${response.status}. body=${bodySnippet}`
    );
  }
}

async function jsonRequest(path, options = {}, expectedStatus) {
  const response = await request(path, options, expectedStatus);
  const raw = await response.text();
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
  assert.ok(setCookie, "Expected auth cookie on login response");
  const cookie = setCookie.split(";")[0];
  assert.ok(cookie && cookie.includes("="), "Expected parseable auth cookie");
  return { cookie, role: payload?.role ?? "unknown" };
}

function buildSyntheticPdf() {
  const content = [
    "%PDF-1.4",
    "1 0 obj",
    "<< /Length 220 >>",
    "stream",
    "BT",
    "(Student: Jane Doe | Date: 02/12/2026 08:00 AM | Points: 12 | Reason: Disrespect | Teacher: Ms Smith | Comment: Smoke flow validation record) Tj",
    "ET",
    "endstream",
    "endobj",
    "%%EOF"
  ].join("\n");
  return Buffer.from(content, "latin1");
}

async function main() {
  logStep(`Using base URL ${baseUrl}`);

  const adminEmail = requireEnv("AUTH_ADMIN_EMAIL");
  const adminPassword = requireEnv("AUTH_ADMIN_PASSWORD");
  const reviewerEmail = requireEnv("AUTH_REVIEWER_EMAIL");
  const reviewerPassword = requireEnv("AUTH_REVIEWER_PASSWORD");

  logStep("Logging in as admin");
  const admin = await login(adminEmail, adminPassword);
  assert.equal(admin.role, "admin");

  logStep("Logging in as reviewer");
  const reviewer = await login(reviewerEmail, reviewerPassword);
  assert.equal(reviewer.role, "reviewer");

  logStep("Uploading synthetic PDF for ingestion");
  const form = new FormData();
  form.append("file", new Blob([buildSyntheticPdf()], { type: "application/pdf" }), "smoke.pdf");
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
  assert.ok(parseRunId, "Expected parseRun.id from ingestion upload");

  logStep(`Ingestion parse run created: ${parseRunId}`);
  assert.equal(
    ["review_required", "completed"].includes(upload.payload?.parseRun?.status),
    true,
    "Unexpected parse run status"
  );

  logStep("Loading review queue and approving uploaded incident");
  const queue = await jsonRequest(
    `/api/review/queue?status=open&parseRunId=${encodeURIComponent(parseRunId)}`,
    {
      headers: {
        cookie: reviewer.cookie
      }
    },
    200
  );
  const task = queue.payload?.items?.[0]?.task;
  assert.ok(task?.id, "Expected at least one review task for parse run");

  await jsonRequest(
    `/api/review/tasks/${encodeURIComponent(task.id)}`,
    {
      method: "POST",
      headers: {
        cookie: reviewer.cookie,
        "content-type": "application/json"
      },
      body: JSON.stringify({ action: "approve" })
    },
    200
  );

  logStep("Verifying reviewer is blocked from admin-only policy creation");
  await jsonRequest(
    "/api/policies",
    {
      method: "POST",
      headers: {
        cookie: reviewer.cookie,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        baseThreshold: 10,
        warningOffsets: [-3, -1],
        milestones: [0, 10, 20],
        interventionTemplates: []
      })
    },
    403
  );

  logStep("Creating policy as admin");
  const createPolicy = await jsonRequest(
    "/api/policies",
    {
      method: "POST",
      headers: {
        cookie: admin.cookie,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        baseThreshold: 10,
        warningOffsets: [-3, -1],
        milestones: [0, 10, 20, 30],
        interventionTemplates: [
          { label: "X-3", dueDays: 3, assignedTo: "Dean", notesTemplate: "Warning at X-3" },
          { label: "X-1", dueDays: 3, assignedTo: "Dean", notesTemplate: "Warning at X-1" },
          { label: "X", dueDays: 7, assignedTo: "Dean", notesTemplate: "Threshold reached" },
          { label: "X+10", dueDays: 7, assignedTo: "Principal", notesTemplate: "Escalated threshold" },
          { label: "X+20", dueDays: 5, assignedTo: "Principal", notesTemplate: "Severe threshold" },
          { label: "X+30", dueDays: 5, assignedTo: "Principal", notesTemplate: "Critical threshold" }
        ]
      })
    },
    201
  );
  const policyVersion = createPolicy.payload?.policy?.version;
  assert.ok(policyVersion, "Expected policy version");

  logStep("Configuring notification recipients");
  await jsonRequest(
    "/api/notifications/config",
    {
      method: "POST",
      headers: {
        cookie: admin.cookie,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sendStaffEmails: true,
        sendParentEmails: true,
        staffRecipients: ["staff@school.org"],
        parentRecipients: ["parent@home.org"],
        subjectTemplate: "Discipline {{milestoneLabel}} for {{studentName}}",
        bodyTemplate: "Student {{studentName}} points={{points}} due={{dueDate}}",
        maxAttempts: 2,
        provider: "console"
      })
    },
    200
  );

  logStep("Evaluating policy and queueing notifications");
  const evaluate = await jsonRequest(
    "/api/policies/evaluate",
    {
      method: "POST",
      headers: {
        cookie: admin.cookie,
        "content-type": "application/json"
      },
      body: JSON.stringify({ policyVersion, queueNotifications: true })
    },
    200
  );
  const triggeredInterventions = evaluate.payload?.evaluation?.triggeredInterventions ?? 0;

  const policyInterventionsResponse = await jsonRequest(
    `/api/interventions?policyVersion=${encodeURIComponent(String(policyVersion))}`,
    {
      headers: {
        cookie: admin.cookie
      }
    },
    200
  );
  const policyInterventions = policyInterventionsResponse.payload?.interventions ?? [];
  assert.equal(
    triggeredInterventions > 0 || policyInterventions.length > 0,
    true,
    "Expected policy evaluation to create or retain interventions for this policy version"
  );

  logStep("Dispatching queued notifications");
  let dispatch = await jsonRequest(
    "/api/notifications/dispatch",
    {
      method: "POST",
      headers: {
        cookie: admin.cookie,
        "content-type": "application/json"
      },
      body: JSON.stringify({ limit: 25 })
    },
    200
  );
  if ((dispatch.payload?.summary?.attempted ?? 0) === 0) {
    const fallbackIntervention = policyInterventions[0];
    assert.ok(
      fallbackIntervention?.id && fallbackIntervention?.studentId,
      "Expected intervention for fallback notification queueing"
    );

    await jsonRequest(
      "/api/notifications/override",
      {
        method: "POST",
        headers: {
          cookie: admin.cookie,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          studentId: fallbackIntervention.studentId,
          interventionId: fallbackIntervention.id,
          recipient: "staff@school.org",
          reason: "smoke_dispatch_fallback",
          subject: "Smoke fallback notification",
          body: "Smoke fallback dispatch check."
        })
      },
      200
    );

    dispatch = await jsonRequest(
      "/api/notifications/dispatch",
      {
        method: "POST",
        headers: {
          cookie: admin.cookie,
          "content-type": "application/json"
        },
        body: JSON.stringify({ limit: 25 })
      },
      200
    );
  }
  assert.equal(
    (dispatch.payload?.summary?.attempted ?? 0) > 0,
    true,
    "Expected at least one notification dispatch attempt"
  );

  logStep("Fetching interventions and completing one as reviewer");
  const interventions = await jsonRequest(
    `/api/interventions?policyVersion=${encodeURIComponent(String(policyVersion))}`,
    {
      headers: {
        cookie: reviewer.cookie
      }
    },
    200
  );
  const interventionId = interventions.payload?.interventions?.[0]?.id;
  assert.ok(interventionId, "Expected at least one intervention");

  await jsonRequest(
    `/api/interventions/${encodeURIComponent(interventionId)}/status`,
    {
      method: "POST",
      headers: {
        cookie: reviewer.cookie,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        status: "in_progress",
        notes: "Smoke test status change",
        assignee: "Counselor"
      })
    },
    200
  );
  await jsonRequest(
    `/api/interventions/${encodeURIComponent(interventionId)}/status`,
    {
      method: "POST",
      headers: {
        cookie: reviewer.cookie,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        status: "completed",
        notes: "Smoke test completion"
      })
    },
    200
  );

  logStep("Verifying dashboard, students, and audit endpoints");
  const dashboard = await jsonRequest(
    "/api/dashboard/metrics",
    {
      headers: {
        cookie: admin.cookie
      }
    },
    200
  );
  assert.ok(dashboard.payload?.metrics, "Expected dashboard metrics payload");

  const students = await jsonRequest(
    "/api/students",
    {
      headers: {
        cookie: admin.cookie
      }
    },
    200
  );
  const studentId = students.payload?.students?.[0]?.id;
  assert.ok(studentId, "Expected at least one student");

  await jsonRequest(
    `/api/students/${encodeURIComponent(studentId)}`,
    {
      headers: {
        cookie: admin.cookie
      }
    },
    200
  );

  const audits = await jsonRequest(
    "/api/audit/events?limit=50",
    {
      headers: {
        cookie: admin.cookie
      }
    },
    200
  );
  assert.equal((audits.payload?.events?.length ?? 0) > 0, true, "Expected audit events");

  logStep("Smoke workflow PASSED");
  process.stdout.write(
    `${JSON.stringify(
      {
        baseUrl,
        parseRunId,
        reviewTaskId: task.id,
        policyVersion,
        interventionId,
        notificationSummary: dispatch.payload?.summary,
        dashboard: dashboard.payload?.metrics
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`\n[smoke] FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
