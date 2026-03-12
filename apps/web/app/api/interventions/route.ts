import { NextRequest, NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter } from "@/lib/storage";

export async function GET(request: NextRequest) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = request.nextUrl.searchParams.get("status");
  const studentId = request.nextUrl.searchParams.get("studentId");
  const policyVersionRaw = request.nextUrl.searchParams.get("policyVersion");
  const policyVersion = policyVersionRaw ? Number(policyVersionRaw) : null;

  const storage = createStorageAdapter();
  await storage.ensureSchema();
  let interventions = await storage.interventions.list();

  if (status) {
    interventions = interventions.filter((intervention) => intervention.status === status);
  }
  if (studentId) {
    interventions = interventions.filter((intervention) => intervention.studentId === studentId);
  }
  if (policyVersion !== null && Number.isFinite(policyVersion)) {
    interventions = interventions.filter((intervention) => intervention.policyVersion === policyVersion);
  }

  const sorted = interventions.sort((left, right) => Date.parse(right.dueDate) - Date.parse(left.dueDate));
  return NextResponse.json({ interventions: sorted });
}
