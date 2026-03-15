import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter } from "@/lib/storage";
import { updateParentOutreachDraft } from "@/lib/notifications";

const updateDraftSchema = z.object({
  notificationId: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1)
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
  const parsed = updateDraftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid draft update payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const storage = createStorageAdapter();
  await storage.ensureSchema();
  try {
    const notification = await updateParentOutreachDraft({
      storage,
      actorEmail: session.email,
      notificationId: parsed.data.notificationId,
      subject: parsed.data.subject,
      body: parsed.data.body
    });
    return NextResponse.json({ notification }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update parent outreach draft.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
