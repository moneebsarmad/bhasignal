import { NextRequest, NextResponse } from "next/server";

import { IngestionProcessError } from "@/lib/ingestion-workflow";
import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter } from "@/lib/storage";
import { isSycamoreSyncConfigured } from "@/lib/sycamore-client";
import { sycamoreSyncRequestSchema } from "@/lib/sycamore-contract";
import { syncSycamoreDiscipline } from "@/lib/sycamore-source";

export async function POST(request: NextRequest) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isSycamoreSyncConfigured()) {
    return NextResponse.json(
      { error: "Sycamore sync is not configured in this environment." },
      { status: 501 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsed = sycamoreSyncRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid Sycamore sync payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const storage = createStorageAdapter();
  await storage.ensureSchema();

  try {
    const result = await syncSycamoreDiscipline({
      storage,
      actorEmail: session.email,
      request: parsed.data
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof IngestionProcessError) {
      return NextResponse.json(
        {
          error: error.message,
          parseRunId: error.parseRunId
        },
        { status: 502 }
      );
    }

    const message = error instanceof Error ? error.message : "Unknown Sycamore sync failure.";
    const status =
      /missing required environment variable/i.test(message)
        ? 500
        : /returned 401|returned 403|returned 429|returned 5\d\d|invalid json/i.test(message)
          ? 502
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
