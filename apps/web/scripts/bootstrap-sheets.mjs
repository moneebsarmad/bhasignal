import { google } from "googleapis";

const requiredEnv = [
  "GOOGLE_SHEETS_SPREADSHEET_ID",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const serviceAccountPrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n");

const tabHeaders = {
  students: ["student_id", "external_id", "full_name", "grade", "active", "created_at", "updated_at"],
  incidents_raw: [
    "raw_id",
    "parse_run_id",
    "student_reference",
    "occurred_at",
    "points",
    "reason",
    "comment",
    "teacher_name",
    "confidence_json",
    "status"
  ],
  incidents_approved: [
    "incident_id",
    "student_id",
    "occurred_at",
    "points",
    "reason",
    "comment",
    "teacher_name",
    "source_job_id",
    "fingerprint",
    "reviewed_by",
    "reviewed_at"
  ],
  parse_runs: [
    "parse_run_id",
    "file_name",
    "uploaded_by",
    "status",
    "rows_extracted",
    "rows_flagged",
    "started_at",
    "completed_at"
  ],
  review_tasks: [
    "review_task_id",
    "parse_run_id",
    "raw_id",
    "assignee",
    "status",
    "resolution",
    "created_at",
    "resolved_at"
  ],
  policies: [
    "policy_version",
    "base_threshold",
    "warning_offsets",
    "milestones",
    "intervention_templates",
    "created_by",
    "created_at"
  ],
  interventions: [
    "intervention_id",
    "student_id",
    "policy_version",
    "milestone_label",
    "status",
    "due_date",
    "completed_at",
    "assigned_to",
    "notes"
  ],
  notifications: [
    "notification_id",
    "student_id",
    "intervention_id",
    "channel",
    "recipient",
    "status",
    "provider_id",
    "sent_at",
    "error"
  ],
  audit_events: [
    "audit_id",
    "event_type",
    "entity_type",
    "entity_id",
    "actor",
    "payload_json",
    "created_at"
  ]
};

const auth = new google.auth.JWT({
  email: serviceAccountEmail,
  key: serviceAccountPrivateKey,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

async function ensureTabs() {
  const current = await sheets.spreadsheets.get({ spreadsheetId });
  const currentTitles = new Set(
    (current.data.sheets || [])
      .map((sheet) => sheet.properties?.title)
      .filter((title) => typeof title === "string")
  );

  const missing = Object.keys(tabHeaders).filter((title) => !currentTitles.has(title));
  if (missing.length === 0) {
    return;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: missing.map((title) => ({
        addSheet: {
          properties: { title }
        }
      }))
    }
  });
}

async function seedHeaders() {
  for (const [tab, headers] of Object.entries(tabHeaders)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tab}!A1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [headers]
      }
    });
  }
}

async function main() {
  await ensureTabs();
  await seedHeaders();
  console.log("Google Sheets tabs and headers are ready.");
}

main().catch((error) => {
  console.error("Failed to bootstrap sheets:", error);
  process.exitCode = 1;
});

