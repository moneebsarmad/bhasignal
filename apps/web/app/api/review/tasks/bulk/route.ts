import { NextRequest, NextResponse } from "next/server";

import { applyBulkReviewAction, bulkReviewActionSchema } from "@/lib/review";
import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter, prepareStorage } from "@/lib/storage";

export async function POST(request: NextRequest) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin" && session.role !== "reviewer") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bulkReviewActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid bulk review action payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const storage = createStorageAdapter();
  await prepareStorage(storage);

  try {
    const result = await applyBulkReviewAction({
      storage,
      taskIds: parsed.data.taskIds,
      actorEmail: session.email,
      action: parsed.data.action,
      reason: parsed.data.reason
    });
    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown bulk review action failure.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
