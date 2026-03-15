import { NextRequest, NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/session";
import { runNextQueuedSycamoreSyncJob } from "@/lib/sycamore-sync-jobs";

export const maxDuration = 300;

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

function isAuthorized(request: NextRequest): boolean {
  if (isAuthorizedCronRequest(request)) {
    return true;
  }

  const session = getCurrentSession();
  return Boolean(session && session.role === "admin");
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized cron request." }, { status: 401 });
  }

  try {
    const result = await runNextQueuedSycamoreSyncJob({
      actorEmail: "system:cron"
    });
    return NextResponse.json(
      {
        executed: result.executed,
        jobId: result.job?.id ?? null,
        sycamoreSync: result.batch
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Sycamore async worker failure.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = getCurrentSession();

  try {
    const result = await runNextQueuedSycamoreSyncJob({
      actorEmail: session?.email ?? "system:sycamore"
    });
    return NextResponse.json(
      {
        executed: result.executed,
        jobId: result.job?.id ?? null,
        sycamoreSync: result.batch
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Sycamore async worker failure.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
