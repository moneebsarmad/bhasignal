import { NextRequest, NextResponse } from "next/server";

import { listReviewQueue } from "@/lib/review";
import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter, prepareStorage } from "@/lib/storage";

const VALID_STATUSES = new Set(["all", "open", "approved", "rejected", "edited"]);
const VALID_CONFIDENCE = new Set(["all", "low", "medium", "high", "unknown"]);
const VALID_SOURCE_TYPES = new Set(["all", "manual_pdf", "sycamore_api"]);

export async function GET(request: NextRequest) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const statusRaw = request.nextUrl.searchParams.get("status") || "open";
  const confidenceRaw = request.nextUrl.searchParams.get("confidence") || "all";
  const parseRunId = request.nextUrl.searchParams.get("parseRunId") || undefined;
  const assignee = request.nextUrl.searchParams.get("assignee") || undefined;
  const sourceTypeRaw = request.nextUrl.searchParams.get("sourceType") || "all";

  if (!VALID_STATUSES.has(statusRaw)) {
    return NextResponse.json({ error: "Invalid status filter." }, { status: 400 });
  }
  if (!VALID_CONFIDENCE.has(confidenceRaw)) {
    return NextResponse.json({ error: "Invalid confidence filter." }, { status: 400 });
  }
  if (!VALID_SOURCE_TYPES.has(sourceTypeRaw)) {
    return NextResponse.json({ error: "Invalid source type filter." }, { status: 400 });
  }

  const storage = createStorageAdapter();
  await prepareStorage(storage);

  const items = await listReviewQueue(storage, {
    status: statusRaw as "all" | "open" | "approved" | "rejected" | "edited",
    confidence: confidenceRaw as "all" | "low" | "medium" | "high" | "unknown",
    parseRunId,
    assignee,
    sourceType: sourceTypeRaw as "all" | "manual_pdf" | "sycamore_api"
  });

  return NextResponse.json({ items });
}
