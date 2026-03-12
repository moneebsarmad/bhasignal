import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { dispatchNotificationQueue } from "@/lib/notifications";
import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter } from "@/lib/storage";

const dispatchSchema = z.object({
  limit: z.number().int().positive().max(500).optional()
});

export async function POST(request: NextRequest) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = dispatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid dispatch payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const storage = createStorageAdapter();
  await storage.ensureSchema();
  const summary = await dispatchNotificationQueue({
    storage,
    actorEmail: session.email,
    limit: parsed.data.limit
  });
  return NextResponse.json({ summary }, { status: 200 });
}
