import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { importGuardianContactsCsv } from "@/lib/guardian-contacts";
import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter, prepareStorage } from "@/lib/storage";

const importSchema = z.object({
  csv: z.string().min(1)
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
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid guardian contact import payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const storage = createStorageAdapter();
  await prepareStorage(storage);
  const summary = await importGuardianContactsCsv({
    storage,
    actorEmail: session.email,
    csv: parsed.data.csv
  });
  return NextResponse.json({ summary }, { status: 200 });
}
