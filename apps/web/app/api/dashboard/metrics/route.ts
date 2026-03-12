import { NextRequest, NextResponse } from "next/server";

import { buildDashboardSnapshot, readDashboardFilters } from "@/lib/dashboard";
import { getCurrentSession } from "@/lib/session";
import { buildSycamoreDashboardSummary } from "@/lib/sycamore-direct-sync";
import { createStorageAdapter } from "@/lib/storage";

export async function GET(request: NextRequest) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storage = createStorageAdapter();
  await storage.ensureSchema();

  const [snapshot, sycamore] = await Promise.all([
    buildDashboardSnapshot(storage, readDashboardFilters(request.nextUrl.searchParams)),
    buildSycamoreDashboardSummary()
  ]);
  return NextResponse.json({
    ...snapshot,
    sycamore
  });
}
