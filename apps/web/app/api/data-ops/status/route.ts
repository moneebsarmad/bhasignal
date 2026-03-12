import { NextResponse } from "next/server";

import { buildDataOpsSnapshot } from "@/lib/data-ops";
import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter } from "@/lib/storage";

export async function GET() {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const storage = createStorageAdapter();
  await storage.ensureSchema();

  const snapshot = await buildDataOpsSnapshot(storage);
  return NextResponse.json(snapshot);
}
