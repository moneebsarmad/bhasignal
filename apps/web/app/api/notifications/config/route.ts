import { NextRequest, NextResponse } from "next/server";

import { getNotificationConfig, parseNotificationConfig, saveNotificationConfig } from "@/lib/notifications";
import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter } from "@/lib/storage";

export async function GET() {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storage = createStorageAdapter();
  await storage.ensureSchema();
  const config = await getNotificationConfig(storage);
  return NextResponse.json({ config });
}

export async function POST(request: NextRequest) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  let parsedConfig;
  try {
    parsedConfig = parseNotificationConfig(body);
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid notification config payload.", detail: error instanceof Error ? error.message : "" },
      { status: 400 }
    );
  }

  const storage = createStorageAdapter();
  await storage.ensureSchema();
  const config = await saveNotificationConfig({
    storage,
    actorEmail: session.email,
    payload: parsedConfig
  });

  return NextResponse.json({ config }, { status: 200 });
}
