import { NextRequest, NextResponse } from "next/server";

import { buildReportSnapshot, readReportFilters, toCsv } from "@/lib/reporting";
import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter } from "@/lib/storage";

const VALID_DATASETS = new Set(["students", "grades", "reasons"]);

export async function GET(request: NextRequest) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dataset = request.nextUrl.searchParams.get("dataset") || "students";
  if (!VALID_DATASETS.has(dataset)) {
    return NextResponse.json({ error: "Invalid export dataset." }, { status: 400 });
  }

  const storage = createStorageAdapter();
  await storage.ensureSchema();

  const snapshot = await buildReportSnapshot(storage, readReportFilters(request.nextUrl.searchParams));
  const rows =
    dataset === "grades"
      ? snapshot.incidentsByGrade.map((row) => ({
          grade: row.grade,
          student_count: row.studentCount,
          incident_count: row.incidentCount,
          total_points: row.totalPoints,
          active_interventions: row.activeInterventions
        }))
      : dataset === "reasons"
        ? snapshot.topReasons.map((row) => ({
            reason: row.reason,
            incident_count: row.incidentCount,
            total_points: row.totalPoints
          }))
        : snapshot.studentRows.map((row) => ({
            student_id: row.studentId,
            full_name: row.fullName,
            grade: row.grade,
            incident_count: row.incidentCount,
            total_points: row.totalPoints,
            active_interventions: row.activeInterventions,
            notification_count: row.notificationCount,
            latest_incident_at: row.latestIncidentAt ?? ""
          }));

  const csv = toCsv(rows);
  const stamp = snapshot.generatedAt.slice(0, 10);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${dataset}-report-${stamp}.csv"`
    }
  });
}
