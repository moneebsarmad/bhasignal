import { NextResponse } from "next/server";

import { listParentOutreachQueue } from "@/lib/notifications";
import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter } from "@/lib/storage";

export async function GET() {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storage = createStorageAdapter();
  await storage.ensureSchema();
  const rows = await listParentOutreachQueue(storage);
  return NextResponse.json({ rows }, { status: 200 });
}
