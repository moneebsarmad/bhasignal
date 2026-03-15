import { NextRequest, NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter, prepareStorage } from "@/lib/storage";
import { buildStudentDetailSnapshot, normalizeStudentSourceType } from "@/lib/student-profiles";

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
  await prepareStorage(storage);

  const studentId = context.params.studentId;
  const sourceType = normalizeStudentSourceType(_request.nextUrl.searchParams.get("sourceType") || undefined);
  const detail = await buildStudentDetailSnapshot(storage, studentId, sourceType);
  if (!detail) {
    return NextResponse.json({ error: "Student not found." }, { status: 404 });
  }

  return NextResponse.json(detail);
}
