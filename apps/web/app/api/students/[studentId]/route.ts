import { NextRequest, NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter } from "@/lib/storage";

interface RouteContext {
  params: {
    studentId: string;
  };
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storage = createStorageAdapter();
  await storage.ensureSchema();

  const studentId = context.params.studentId;
  const student = await storage.students.getById(studentId);
  if (!student) {
    return NextResponse.json({ error: "Student not found." }, { status: 404 });
  }

  const incidents = await storage.approvedIncidents.listByStudent(studentId);
  const interventions = await storage.interventions.listByStudent(studentId);
  const notifications = await storage.notifications.listByStudent(studentId);
  const auditEvents = await storage.auditEvents.list();

  const relevantAudit = auditEvents
    .filter((event) => {
      if (event.entityType === "student" && event.entityId === studentId) {
        return true;
      }
      return event.payloadJson.includes(studentId);
    })
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

  return NextResponse.json({
    student,
    incidents: incidents.sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt)),
    interventions: interventions.sort((left, right) => Date.parse(right.dueDate) - Date.parse(left.dueDate)),
    notifications: notifications.sort((left, right) => {
      const leftEpoch = Date.parse(left.sentAt ?? "1970-01-01T00:00:00.000Z");
      const rightEpoch = Date.parse(right.sentAt ?? "1970-01-01T00:00:00.000Z");
      return rightEpoch - leftEpoch;
    }),
    auditEvents: relevantAudit.slice(0, 100)
  });
}
