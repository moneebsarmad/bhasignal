import { NextRequest, NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/session";
import {
  enqueueSycamoreSyncBatch,
  getActiveSycamoreSyncBatchSummary,
  getSycamoreSyncBatchSummary,
  listRecentSycamoreSyncBatches
} from "@/lib/sycamore-sync-jobs";

export async function GET(request: NextRequest) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const batchId = request.nextUrl.searchParams.get("batchId")?.trim() || null;
  const limit = Number(request.nextUrl.searchParams.get("limit") || "8");

  try {
    if (batchId) {
      const batch = await getSycamoreSyncBatchSummary({ batchId });
      if (!batch) {
        return NextResponse.json({ error: "Sycamore sync batch not found." }, { status: 404 });
      }
      return NextResponse.json({ sycamoreSync: batch }, { status: 200 });
    }

    const [activeSycamoreSync, recentSycamoreSyncs] = await Promise.all([
      getActiveSycamoreSyncBatchSummary(),
      listRecentSycamoreSyncBatches({ limit: Number.isFinite(limit) ? Math.max(1, Math.min(limit, 20)) : 8 })
    ]);
    return NextResponse.json({ activeSycamoreSync, recentSycamoreSyncs }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Sycamore sync jobs.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));

  try {
    const result = await enqueueSycamoreSyncBatch({
      request: body,
      triggeredBy: "manual"
    });
    return NextResponse.json(
      {
        sycamoreSync: result.batch,
        alreadyQueued: result.alreadyQueued
      },
      { status: result.alreadyQueued ? 200 : 202 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not queue the Sycamore sync.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
