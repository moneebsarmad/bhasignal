import { NextRequest, NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/session";
import { sycamoreDirectSyncRequestSchema } from "@/lib/sycamore-direct-sync";
import { enqueueSycamoreSyncBatch } from "@/lib/sycamore-sync-jobs";

export const maxDuration = 300;

function statusCodeForError(message: string): number {
  if (/not configured|required environment variable|credentials/i.test(message)) {
    return 500;
  }
  if (/returned 401|returned 403|returned 429|returned 5\d\d|invalid json|timed out|fetch failed/i.test(message)) {
    return 502;
  }
  if (/schema check|apply the sql/i.test(message)) {
    return 500;
  }
  return 400;
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
  const parsed = sycamoreDirectSyncRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid Sycamore sync payload.",
        details: parsed.error.flatten(),
        deprecated: true,
        replacementPath: "/api/sycamore/sync"
      },
      { status: 400 }
    );
  }

  try {
    const result = await enqueueSycamoreSyncBatch({
      request: parsed.data,
      triggeredBy: "manual"
    });
    return NextResponse.json(
      {
        sycamoreSync: result.batch,
        alreadyQueued: result.alreadyQueued,
        deprecated: true,
        replacementPath: "/api/sycamore/sync"
      },
      { status: result.alreadyQueued ? 200 : 202 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Sycamore sync failure.";
    return NextResponse.json(
      {
        error: message,
        deprecated: true,
        replacementPath: "/api/sycamore/sync"
      },
      { status: statusCodeForError(message) }
    );
  }
}
