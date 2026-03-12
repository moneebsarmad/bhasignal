import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { queueManualOverrideNotification } from "@/lib/notifications";
import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter } from "@/lib/storage";

const overrideSchema = z.object({
  studentId: z.string().min(1),
  interventionId: z.string().min(1),
  recipient: z.string().email(),
  reason: z.string().min(3),
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
  const parsed = overrideSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid override payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const storage = createStorageAdapter();
  await storage.ensureSchema();
  try {
    const notification = await queueManualOverrideNotification({
      storage,
      actorEmail: session.email,
      payload: parsed.data
    });
    return NextResponse.json({ notification }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Override queue failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
