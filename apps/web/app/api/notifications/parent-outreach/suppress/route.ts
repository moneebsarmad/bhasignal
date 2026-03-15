import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter } from "@/lib/storage";
import { suppressParentOutreachNotifications } from "@/lib/notifications";

const suppressSchema = z.object({
  notificationIds: z.array(z.string().min(1)).min(1),
  reason: z.string().min(3)
});

export async function POST(request: NextRequest) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = suppressSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid suppression payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const storage = createStorageAdapter();
  await storage.ensureSchema();
  const summary = await suppressParentOutreachNotifications({
    storage,
    actorEmail: session.email,
    notificationIds: parsed.data.notificationIds,
    reason: parsed.data.reason
  });
  return NextResponse.json({ summary }, { status: 200 });
}
