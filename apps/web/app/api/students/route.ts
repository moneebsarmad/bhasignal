import { NextRequest, NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter } from "@/lib/storage";
import { buildStudentDirectoryRows, normalizeStudentSourceType } from "@/lib/student-profiles";

export async function GET(request: NextRequest) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const search = (request.nextUrl.searchParams.get("search") || "").trim().toLowerCase();
  const grade = (request.nextUrl.searchParams.get("grade") || "").trim();
  const sourceType = normalizeStudentSourceType(request.nextUrl.searchParams.get("sourceType") || undefined);

  const storage = createStorageAdapter();
  await storage.ensureSchema();

  const rows = await buildStudentDirectoryRows(storage, {
    search,
    grade,
    sourceType
  });

  return NextResponse.json({ students: rows });
}
