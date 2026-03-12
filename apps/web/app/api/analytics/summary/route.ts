import { NextRequest, NextResponse } from "next/server";

import { buildAnalyticsSnapshot, readAnalyticsFilters } from "@/lib/analytics";
import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter } from "@/lib/storage";

export async function GET(request: NextRequest) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storage = createStorageAdapter();
  await storage.ensureSchema();

  const snapshot = await buildAnalyticsSnapshot(storage, readAnalyticsFilters(request.nextUrl.searchParams));
  return NextResponse.json(snapshot);
}
