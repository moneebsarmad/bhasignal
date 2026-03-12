import { NextRequest, NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter } from "@/lib/storage";

export async function GET(request: NextRequest) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const search = (request.nextUrl.searchParams.get("search") || "").trim().toLowerCase();
  const grade = (request.nextUrl.searchParams.get("grade") || "").trim();

  const storage = createStorageAdapter();
  await storage.ensureSchema();

  const students = await storage.students.list();
  const incidents = await storage.approvedIncidents.list();
  const interventions = await storage.interventions.list();

  const pointsByStudent = new Map<string, number>();
  const lastIncidentByStudent = new Map<string, string>();
  for (const incident of incidents) {
    pointsByStudent.set(incident.studentId, (pointsByStudent.get(incident.studentId) ?? 0) + incident.points);
    const current = lastIncidentByStudent.get(incident.studentId);
    if (!current || Date.parse(incident.occurredAt) > Date.parse(current)) {
      lastIncidentByStudent.set(incident.studentId, incident.occurredAt);
    }
  }

  const interventionCountByStudent = new Map<string, number>();
  for (const intervention of interventions) {
    interventionCountByStudent.set(
      intervention.studentId,
      (interventionCountByStudent.get(intervention.studentId) ?? 0) + 1
    );
  }

  const rows = students
    .filter((student) => {
      if (grade && student.grade !== grade) {
        return false;
      }
      if (search && !student.fullName.toLowerCase().includes(search)) {
        return false;
      }
      return true;
    })
    .map((student) => ({
      ...student,
      totalPoints: pointsByStudent.get(student.id) ?? 0,
      interventionCount: interventionCountByStudent.get(student.id) ?? 0,
      lastIncidentAt: lastIncidentByStudent.get(student.id) ?? null
    }))
    .sort((left, right) => right.totalPoints - left.totalPoints);

  return NextResponse.json({ students: rows });
}
