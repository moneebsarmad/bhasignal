import assert from "node:assert/strict";
import test from "node:test";

import type { ApprovedIncident, Student } from "@syc/domain";

import { buildSycamoreReconciliationReport } from "../lib/sycamore-reconciliation";
import type { SycamoreDisciplineLogRecord } from "../lib/sycamore-direct-store";

test("buildSycamoreReconciliationReport matches rows and surfaces field mismatches", () => {
  const students: Student[] = [
    {
      id: "stu-1",
      externalId: null,
      fullName: "Danah Ginawi",
      grade: "8",
      active: true,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z"
    }
  ];

  const approvedIncidents: ApprovedIncident[] = [
    {
      id: "approved-1",
      studentId: "stu-1",
      sourceType: "manual_pdf",
      sourceRecordId: "pdf-1",
      externalStudentId: null,
      gradeAtEvent: "8",
      eventType: "discipline",
      occurredAt: "2026-03-10T14:05:00.000Z",
      writeupDate: "2026-03-10",
      points: 3,
      reason: "Disruptive Behavior",
      violation: "Disruptive Behavior",
      violationRaw: "Level 2: Disruptive Behavior",
      level: 2,
      comment: "Disrupted class",
      description: "Disrupted class",
      resolution: "Lunch detention",
      teacherName: "Abir Bou Imajjane",
      authorName: "Abir Bou Imajjane",
      authorNameRaw: "Bou Imajjane, Abir",
      sourceJobId: "job-1",
      fingerprint: "fp-1",
      reviewedBy: "admin@school.org",
      reviewedAt: "2026-03-11T00:00:00.000Z"
    },
    {
      id: "approved-2",
      studentId: "stu-1",
      sourceType: "manual_pdf",
      sourceRecordId: "pdf-2",
      externalStudentId: null,
      gradeAtEvent: "8",
      eventType: "discipline",
      occurredAt: "2026-03-11T14:05:00.000Z",
      writeupDate: "2026-03-11",
      points: 2,
      reason: "Uniform Code",
      violation: "Uniform Code",
      violationRaw: "Level 1: Uniform Code",
      level: 1,
      comment: "Uniform issue",
      description: "Uniform issue",
      resolution: "Parent contacted",
      teacherName: "Nada Malik",
      authorName: "Nada Malik",
      authorNameRaw: "Nada Malik",
      sourceJobId: "job-1",
      fingerprint: "fp-2",
      reviewedBy: "admin@school.org",
      reviewedAt: "2026-03-11T00:00:00.000Z"
    }
  ];

  const sycamoreLogs: SycamoreDisciplineLogRecord[] = [
    {
      sycamoreLogId: "sync-1",
      studentId: "syc-1",
      studentRecordId: null,
      studentName: "Danah Ginawi",
      grade: "8",
      schoolId: "2307",
      incidentDate: "2026-03-10",
      points: 3,
      level: 2,
      violation: "Disruptive Behavior",
      violationRaw: "Level 2: Disruptive Behavior",
      incidentType: "Level 2: Disruptive Behavior",
      description: "Disrupted class",
      resolution: "Lunch detention",
      consequence: "Lunch detention",
      authorName: "Abir Bou Imajjane",
      authorNameRaw: "Bou Imajjane, Abir",
      assignedBy: "Abir Bou Imajjane",
      quarter: "3",
      createdAtSycamore: "2026-03-10T14:05:00.000Z",
      managerNotified: false,
      familyNotified: false,
      studentNotified: false,
      detentionId: null,
      rawPayload: {},
      detentionPayload: null,
      syncedAt: "2026-03-12T00:00:00.000Z"
    },
    {
      sycamoreLogId: "sync-2",
      studentId: "syc-1",
      studentRecordId: null,
      studentName: "Danah Ginawi",
      grade: "8",
      schoolId: "2307",
      incidentDate: "2026-03-11",
      points: 2,
      level: 1,
      violation: "Uniform Code",
      violationRaw: "Level 1: Uniform Code",
      incidentType: "Level 1: Uniform Code",
      description: "Uniform issue",
      resolution: "Meeting scheduled",
      consequence: "Meeting scheduled",
      authorName: "Nada Malik",
      authorNameRaw: "Nada Malik",
      assignedBy: "Nada Malik",
      quarter: "3",
      createdAtSycamore: "2026-03-11T14:05:00.000Z",
      managerNotified: false,
      familyNotified: false,
      studentNotified: false,
      detentionId: null,
      rawPayload: {},
      detentionPayload: null,
      syncedAt: "2026-03-12T00:00:00.000Z"
    }
  ];

  const report = buildSycamoreReconciliationReport({
    request: {
      studentNames: ["Danah Ginawi"],
      startDate: "2026-03-10",
      endDate: "2026-03-11"
    },
    students,
    approvedIncidents,
    sycamoreLogs
  });

  assert.equal(report.summary.studentsRequested, 1);
  assert.equal(report.summary.sycamoreRecords, 2);
  assert.equal(report.summary.pdfRecords, 2);
  assert.equal(report.summary.matched, 1);
  assert.equal(report.summary.fieldMismatch, 1);
  assert.equal(report.summary.sycamoreOnly, 0);
  assert.equal(report.summary.pdfOnly, 0);
  assert.equal(report.students[0]?.rows[0]?.status, "matched");
  assert.equal(report.students[0]?.rows[1]?.status, "field_mismatch");
  assert.equal(report.students[0]?.rows[1]?.diffs[0]?.field, "resolution");
});

test("buildSycamoreReconciliationReport ignores placeholder PDF grades when the rest of the record matches", () => {
  const students: Student[] = [
    {
      id: "stu-2",
      externalId: null,
      fullName: "Abdulahad Lalani",
      grade: "unknown",
      active: true,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z"
    }
  ];

  const approvedIncidents: ApprovedIncident[] = [
    {
      id: "approved-grade",
      studentId: "stu-2",
      sourceType: "manual_pdf",
      sourceRecordId: "pdf-grade",
      externalStudentId: null,
      gradeAtEvent: "unknown",
      eventType: "discipline",
      occurredAt: "2025-08-15T14:05:00.000Z",
      writeupDate: "2025-08-15",
      points: 1,
      reason: "Disruptive Behavior",
      violation: "Disruptive Behavior",
      violationRaw: "Level 2: Disruptive Behavior",
      level: 2,
      comment: "Disrupted class",
      description: "Disrupted class",
      resolution: "Moved seat.",
      teacherName: "Taylor Chelliah",
      authorName: "Taylor Chelliah",
      authorNameRaw: "Taylor Chelliah",
      sourceJobId: "job-grade",
      fingerprint: "fp-grade",
      reviewedBy: "admin@school.org",
      reviewedAt: "2026-03-11T00:00:00.000Z"
    }
  ];

  const sycamoreLogs: SycamoreDisciplineLogRecord[] = [
    {
      sycamoreLogId: "sync-grade",
      studentId: "1549200",
      studentRecordId: null,
      studentName: "Abdulahad Lalani",
      grade: "7",
      schoolId: "2307",
      incidentDate: "2025-08-15",
      points: 1,
      level: 2,
      violation: "Disruptive Behavior",
      violationRaw: "Level 2: Disruptive Behavior",
      incidentType: "Level 2: Disruptive Behavior",
      description: "Disrupted class",
      resolution: "Moved seat.",
      consequence: "Moved seat.",
      authorName: "Taylor Chelliah",
      authorNameRaw: "Taylor Chelliah",
      assignedBy: "Taylor Chelliah",
      quarter: "1",
      createdAtSycamore: "2025-08-15T14:05:00.000Z",
      managerNotified: false,
      familyNotified: false,
      studentNotified: false,
      detentionId: null,
      rawPayload: {},
      detentionPayload: null,
      syncedAt: "2026-03-12T00:00:00.000Z"
    }
  ];

  const report = buildSycamoreReconciliationReport({
    request: {
      studentNames: ["Abdulahad Lalani"],
      startDate: "2025-08-15",
      endDate: "2025-08-15"
    },
    students,
    approvedIncidents,
    sycamoreLogs
  });

  assert.equal(report.summary.matched, 1);
  assert.equal(report.summary.fieldMismatch, 0);
  assert.equal(report.students[0]?.rows[0]?.status, "matched");
});

test("buildSycamoreReconciliationReport ignores punctuation and spacing noise in author and resolution fields", () => {
  const students: Student[] = [
    {
      id: "stu-3",
      externalId: null,
      fullName: "Aybach Charkas",
      grade: "unknown",
      active: true,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z"
    }
  ];

  const approvedIncidents: ApprovedIncident[] = [
    {
      id: "approved-noise",
      studentId: "stu-3",
      sourceType: "manual_pdf",
      sourceRecordId: "pdf-noise",
      externalStudentId: null,
      gradeAtEvent: "unknown",
      eventType: "discipline",
      occurredAt: "2025-09-16T14:05:00.000Z",
      writeupDate: "2025-09-16",
      points: 2,
      reason: "Horseplay / Verbal Altercation / Minor Disrespect betw",
      violation: "Horseplay / Verbal Altercation / Minor Disrespect betw",
      violationRaw: "Level 1: Horseplay / Verbal Altercation / Minor Disrespect betw",
      level: 1,
      comment: "Incident",
      description: "Incident",
      resolution:
        "Both students were called to the office. Aybach will be serving lunch detention tomorrow 9-17- 25.",
      teacherName: "Sami Moussa",
      authorName: ", Student Support",
      authorNameRaw: ", Student Support",
      sourceJobId: "job-noise",
      fingerprint: "fp-noise",
      reviewedBy: "admin@school.org",
      reviewedAt: "2026-03-11T00:00:00.000Z"
    }
  ];

  const sycamoreLogs: SycamoreDisciplineLogRecord[] = [
    {
      sycamoreLogId: "sync-noise",
      studentId: "1500883",
      studentRecordId: null,
      studentName: "Aybach Charkas",
      grade: "8",
      schoolId: "2307",
      incidentDate: "2025-09-16",
      points: 2,
      level: 1,
      violation: "Horseplay / Verbal Altercation / Minor Disrespect betw",
      violationRaw: "Level 1:  Horseplay / Verbal Altercation / Minor Disrespect betw",
      incidentType: "Level 1:  Horseplay / Verbal Altercation / Minor Disrespect betw",
      description: "Incident",
      resolution:
        "Both students were called to the office. Aybach will be serving lunch detention tomorrow 9-17-25.",
      consequence: "Both students were called to the office. Aybach will be serving lunch detention tomorrow 9-17-25.",
      authorName: "Student Support",
      authorNameRaw: "Student Support",
      assignedBy: "Student Support",
      quarter: "1",
      createdAtSycamore: "2025-09-16T14:05:00.000Z",
      managerNotified: false,
      familyNotified: false,
      studentNotified: false,
      detentionId: null,
      rawPayload: {},
      detentionPayload: null,
      syncedAt: "2026-03-12T00:00:00.000Z"
    }
  ];

  const report = buildSycamoreReconciliationReport({
    request: {
      studentNames: ["Aybach Charkas"],
      startDate: "2025-09-16",
      endDate: "2025-09-16"
    },
    students,
    approvedIncidents,
    sycamoreLogs
  });

  assert.equal(report.summary.matched, 1);
  assert.equal(report.summary.fieldMismatch, 0);
  assert.equal(report.students[0]?.rows[0]?.status, "matched");
});
