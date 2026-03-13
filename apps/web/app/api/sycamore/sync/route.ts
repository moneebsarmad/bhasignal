import { NextRequest, NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/session";
import { runSycamoreDirectSync, sycamoreDirectSyncRequestSchema } from "@/lib/sycamore-direct-sync";

export const maxDuration = 600;

function cronSecret(): string | null {
  const value = process.env.CRON_SECRET?.trim();
  return value || null;
}

function isAuthorizedCronRequest(request: NextRequest): boolean {
  const secret = cronSecret();
  if (!secret) {
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${secret}`;
}

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

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized cron request." }, { status: 401 });
  }

  try {
    const result = await runSycamoreDirectSync({
      triggeredBy: "cron"
    });
    if (result.status === "failed") {
      return NextResponse.json(
        {
          error: result.warnings.join("\n") || "Sycamore sync failed before any records could be stored.",
          sycamoreSync: result
        },
        { status: 502 }
      );
    }
    return NextResponse.json({ sycamoreSync: result }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Sycamore sync failure.";
    return NextResponse.json({ error: message }, { status: statusCodeForError(message) });
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
  const parsed = sycamoreDirectSyncRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid Sycamore sync payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const result = await runSycamoreDirectSync({
      request: parsed.data,
      triggeredBy: "manual"
    });
    if (result.status === "failed") {
      return NextResponse.json(
        {
          error: result.warnings.join("\n") || "Sycamore sync failed before any records could be stored.",
          sycamoreSync: result
        },
        { status: 502 }
      );
    }
    return NextResponse.json({ sycamoreSync: result }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Sycamore sync failure.";
    return NextResponse.json({ error: message }, { status: statusCodeForError(message) });
  }
}
