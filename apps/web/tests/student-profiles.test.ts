import assert from "node:assert/strict";
import test from "node:test";

import type { ApprovedIncident, AuditEvent, Intervention, Notification, Student } from "@syc/domain";

import { buildStudentDetailSnapshot, buildStudentDirectoryRows } from "../lib/student-profiles";
import { createInMemoryStorage } from "./review-actions.test";

function seedStudents(): Student[] {
  return [
    {
      id: "stu_1",
      externalId: "student-1",
      fullName: "Jane Doe",
      grade: "8",
      active: true,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z"
    },
    {
      id: "stu_2",
      externalId: "student-2",
      fullName: "John Roe",
      grade: "7",
      active: true,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z"
    }
  ];
}

function seedIncidents(): ApprovedIncident[] {
  return [
    {
      id: "inc_sycamore_jane",
      studentId: "stu_1",
      sourceType: "sycamore_api",
      sourceRecordId: "disc-1",
      externalStudentId: "student-1",
      gradeAtEvent: "8",
      eventType: "discipline",
      occurredAt: "2026-03-10T10:00:00.000Z",
      writeupDate: "2026-03-10",
      points: 4,
      reason: "Disrespect",
      violation: "Disrespect",
      violationRaw: "Level 1: Disrespect",
      level: 1,
      comment: "",
      description: "Talked back in class",
      resolution: "Lunch detention",
      teacherName: "Ms Smith",
      authorName: "Ms Smith",
      authorNameRaw: null,
      sourceJobId: "run_sycamore",
      fingerprint: "fp_sycamore_jane",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-03-10T11:00:00.000Z"
    },
    {
      id: "inc_manual_john",
      studentId: "stu_2",
      sourceType: "manual_pdf",
      sourceRecordId: "pdf-2",
      externalStudentId: "student-2",
      gradeAtEvent: "7",
      eventType: "discipline",
      occurredAt: "2026-03-12T10:00:00.000Z",
      writeupDate: "2026-03-12",
      points: 2,
      reason: "Tardy",
      violation: "Tardy",
      violationRaw: "Level 0: Tardy",
      level: 0,
      comment: "",
      description: "Late to class",
      resolution: "Warning",
      teacherName: "Ms Jones",
      authorName: "Ms Jones",
      authorNameRaw: null,
      sourceJobId: "run_manual",
      fingerprint: "fp_manual_john",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-03-12T12:00:00.000Z"
    }
  ];
}

function seedInterventions(): Intervention[] {
  return [
    {
      id: "int_1",
      studentId: "stu_1",
      policyVersion: 1,
      milestoneLabel: "Parent outreach",
      status: "open",
      dueDate: "2026-03-15T00:00:00.000Z",
      completedAt: null,
      assignedTo: "Dean",
      notes: "Follow up this week"
    }
  ];
}

function seedNotifications(): Notification[] {
  return [
    {
      id: "notif_1",
      studentId: "stu_1",
      interventionId: "int_1",
      channel: "email",
      recipient: "family@example.com",
      status: "sent",
      providerId: "provider_1",
      sentAt: "2026-03-12T15:00:00.000Z",
      error: ""
    }
  ];
}

function seedAuditEvents(): AuditEvent[] {
  return [
    {
      id: "audit_1",
      eventType: "student.synced",
      entityType: "student",
      entityId: "stu_1",
      actor: "system",
      payloadJson: JSON.stringify({ studentId: "stu_1", externalId: "student-1" }),
      createdAt: "2026-03-12T16:00:00.000Z"
    }
  ];
}

function withoutSupabaseEnv<T>(run: () => Promise<T>): Promise<T> {
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalPublicSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  delete process.env.SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  return run().finally(() => {
    process.env.SUPABASE_URL = originalSupabaseUrl;
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalPublicSupabaseUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
  });
}

test("buildStudentDirectoryRows defaults to Sycamore incidents for student totals", async () => {
  await withoutSupabaseEnv(async () => {
    const storage = createInMemoryStorage({
      parseRuns: [],
      rawIncidents: [],
      reviewTasks: [],
      students: seedStudents(),
      approvedIncidents: seedIncidents(),
      interventions: seedInterventions(),
      notifications: seedNotifications(),
      auditEvents: seedAuditEvents()
    });

    const rows = await buildStudentDirectoryRows(storage, {});

    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.id, "stu_1");
    assert.equal(rows[0]?.totalPoints, 4);
    assert.equal(rows[0]?.incidentCount, 1);
    assert.equal(rows[0]?.interventionCount, 1);
    assert.equal(rows[1]?.id, "stu_2");
    assert.equal(rows[1]?.totalPoints, 0);
    assert.equal(rows[1]?.incidentCount, 0);
  });
});

test("buildStudentDetailSnapshot returns Sycamore incident history for the selected student", async () => {
  await withoutSupabaseEnv(async () => {
    const storage = createInMemoryStorage({
      parseRuns: [],
      rawIncidents: [],
      reviewTasks: [],
      students: seedStudents(),
      approvedIncidents: seedIncidents(),
      interventions: seedInterventions(),
      notifications: seedNotifications(),
      auditEvents: seedAuditEvents()
    });

    const detail = await buildStudentDetailSnapshot(storage, "stu_1");

    assert.ok(detail);
    assert.equal(detail?.student.id, "stu_1");
    assert.equal(detail?.incidents.length, 1);
    assert.equal(detail?.incidents[0]?.reason, "Disrespect");
    assert.equal(detail?.incidents[0]?.authorName, "Ms Smith");
    assert.equal(detail?.incidents[0]?.resolution, "Lunch detention");
    assert.equal(detail?.interventions.length, 1);
    assert.equal(detail?.notifications.length, 1);
    assert.equal(detail?.auditEvents.length, 1);
  });
});
