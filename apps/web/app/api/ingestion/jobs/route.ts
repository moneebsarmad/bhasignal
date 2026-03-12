import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter } from "@/lib/storage";

export async function GET() {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storage = createStorageAdapter();
  await storage.ensureSchema();

  const jobs = await storage.parseRuns.list();
  const sorted = jobs.sort((left, right) => {
    const leftEpoch = Date.parse(left.startedAt);
    const rightEpoch = Date.parse(right.startedAt);
    return rightEpoch - leftEpoch;
  });

  return NextResponse.json({ jobs: sorted });
}
