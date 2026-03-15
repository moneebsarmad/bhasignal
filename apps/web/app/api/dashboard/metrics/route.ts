import { NextRequest, NextResponse } from "next/server";

import { handleRouteError } from "@/app/api/_lib/route-errors";
import { buildDashboardSnapshot, readDashboardFilters } from "@/lib/dashboard";
import { getCurrentSession } from "@/lib/session";
import { buildSycamoreDashboardSummary } from "@/lib/sycamore-direct-sync";
import { createStorageAdapter, prepareStorage } from "@/lib/storage";

export async function GET(request: NextRequest) {
  try {
    const session = getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const storage = createStorageAdapter();
    await prepareStorage(storage);

    const [snapshot, sycamore] = await Promise.all([
      buildDashboardSnapshot(storage, readDashboardFilters(request.nextUrl.searchParams)),
      buildSycamoreDashboardSummary()
    ]);
    return NextResponse.json({
      ...snapshot,
      sycamore
    });
  } catch (error) {
    return handleRouteError("GET /api/dashboard/metrics", error, "Failed to load dashboard metrics.");
  }
}
