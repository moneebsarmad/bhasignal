import { NextRequest, NextResponse } from "next/server";

import { applyReviewAction, reviewActionSchema } from "@/lib/review";
import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter, prepareStorage } from "@/lib/storage";

interface RouteContext {
  params: {
    taskId: string;
  };
}

export async function POST(request: NextRequest, context: RouteContext) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin" && session.role !== "reviewer") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = reviewActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid review action payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const storage = createStorageAdapter();
  await prepareStorage(storage);

  try {
    const result = await applyReviewAction({
      storage,
      taskId: context.params.taskId,
      actorEmail: session.email,
      action: parsed.data.action,
      reason: parsed.data.reason,
      edits: parsed.data.edits
    });
    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown review action failure.";
    if (/not found/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (/already resolved/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
