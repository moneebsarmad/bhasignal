import { NextRequest, NextResponse } from "next/server";

import { buildReportSnapshot, readReportFilters } from "@/lib/reporting";
import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter, prepareStorage } from "@/lib/storage";

export async function GET(request: NextRequest) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storage = createStorageAdapter();
  await prepareStorage(storage);

  const snapshot = await buildReportSnapshot(storage, readReportFilters(request.nextUrl.searchParams));
  return NextResponse.json(snapshot);
}
