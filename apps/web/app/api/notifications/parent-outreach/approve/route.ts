import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { approveParentOutreachNotifications } from "@/lib/notifications";
import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter, prepareStorage } from "@/lib/storage";

const approveSchema = z.object({
  notificationIds: z.array(z.string().min(1)).min(1)
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
  const parsed = approveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid approval payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const storage = createStorageAdapter();
  await prepareStorage(storage);
  const summary = await approveParentOutreachNotifications({
    storage,
    actorEmail: session.email,
    notificationIds: parsed.data.notificationIds
  });
  return NextResponse.json({ summary }, { status: 200 });
}
