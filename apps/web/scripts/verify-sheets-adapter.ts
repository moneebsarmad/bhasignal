import { createIncidentFingerprint } from "@syc/domain";

import { createStorageAdapter } from "../lib/storage";

function nowIso(): string {
  return new Date().toISOString();
}

async function main() {
  const storage = createStorageAdapter();
  await storage.ensureSchema();

  const stamp = Date.now().toString();
  const studentId = `verify_student_${stamp}`;
  const parseRunId = `verify_parse_run_${stamp}`;
  const incidentId = `verify_incident_${stamp}`;
  const fingerprint = createIncidentFingerprint({
    studentReference: studentId,
    occurredAt: nowIso(),
    points: 2,
    reason: "verification",
    comment: "repository adapter verification",
    teacherName: "system",
    sourceJobId: parseRunId
  });

  await storage.students.upsert({
    id: studentId,
    externalId: null,
    fullName: "Adapter Verify",
    grade: "0",
    active: true,
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  await storage.parseRuns.upsert({
    id: parseRunId,
    sourceType: "manual_pdf",
    fileName: "verify.pdf",
    uploadedBy: "system",
    triggeredBy: "system",
    metadataJson: JSON.stringify({ purpose: "adapter_verify" }),
    cursorJson: null,
    status: "completed",
    rowsExtracted: 1,
    rowsFlagged: 0,
    startedAt: nowIso(),
    completedAt: nowIso()
  });

  await storage.approvedIncidents.upsert({
    id: incidentId,
    studentId,
    sourceType: "manual_pdf",
    sourceRecordId: incidentId,
    externalStudentId: null,
    gradeAtEvent: "0",
    eventType: null,
    occurredAt: nowIso(),
    points: 2,
    reason: "verification",
    comment: "repository adapter verification",
    teacherName: "system",
    sourceJobId: parseRunId,
    fingerprint,
    reviewedBy: "system",
    reviewedAt: nowIso()
  });

  const storedStudent = await storage.students.getById(studentId);
  const storedIncident = await storage.approvedIncidents.getByFingerprint(fingerprint);

  if (!storedStudent || !storedIncident) {
    throw new Error("Sheets adapter verification failed: expected records were not persisted.");
  }

  console.log("Sheets adapter verification passed.");
  console.log(`Student: ${storedStudent.id}`);
  console.log(`Incident: ${storedIncident.id}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
