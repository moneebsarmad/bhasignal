import { NextRequest, NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/session";
import {
  buildSycamoreReconciliationReport,
  listSycamoreLogsForReconciliation,
  parseStudentNamesInput,
  sycamoreReconciliationRequestSchema
} from "@/lib/sycamore-reconciliation";
import { createStorageAdapter } from "@/lib/storage";

export async function GET(request: NextRequest) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = sycamoreReconciliationRequestSchema.safeParse({
    startDate: request.nextUrl.searchParams.get("startDate") || "",
    endDate: request.nextUrl.searchParams.get("endDate") || "",
    studentNames: parseStudentNamesInput(request.nextUrl.searchParams.get("studentNames") || "")
  });

  if (!payload.success) {
    return NextResponse.json(
      {
        error: "Invalid reconciliation request.",
        details: payload.error.flatten()
      },
      { status: 400 }
    );
  }

  const storage = createStorageAdapter();
  await storage.ensureSchema();

  const [students, approvedIncidents, sycamoreLogs] = await Promise.all([
    storage.students.list(),
    storage.approvedIncidents.list(),
    listSycamoreLogsForReconciliation({
      startDate: payload.data.startDate,
      endDate: payload.data.endDate
    })
  ]);

  const report = buildSycamoreReconciliationReport({
    request: payload.data,
    students,
    approvedIncidents,
    sycamoreLogs
  });

  return NextResponse.json(report);
}
