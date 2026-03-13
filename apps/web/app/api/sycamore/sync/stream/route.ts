import { NextRequest, NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/session";
import {
  runSycamoreDirectSync,
  sycamoreDirectSyncRequestSchema,
  type SycamoreSyncProgressSnapshot
} from "@/lib/sycamore-direct-sync";

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

function ndjsonLine(payload: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(payload)}\n`);
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
      { error: "Invalid Sycamore sync payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const writeProgress = (progress: SycamoreSyncProgressSnapshot) => {
        controller.enqueue(
          ndjsonLine({
            type: "progress",
            progress
          })
        );
      };

      try {
        const result = await runSycamoreDirectSync({
          request: parsed.data,
          triggeredBy: "manual",
          onProgress: writeProgress
        });

        controller.enqueue(
          ndjsonLine({
            type: "result",
            sycamoreSync: result
          })
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown Sycamore sync failure.";
        controller.enqueue(
          ndjsonLine({
            type: "error",
            error: message,
            status: statusCodeForError(message)
          })
        );
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform"
    }
  });
}
