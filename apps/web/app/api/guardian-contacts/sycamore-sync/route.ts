import { NextResponse } from "next/server";

import { syncGuardianContactsFromSycamore } from "@/lib/guardian-contacts";
import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter, prepareStorage } from "@/lib/storage";

export async function POST() {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const storage = createStorageAdapter();
  await prepareStorage(storage);

  try {
    const summary = await syncGuardianContactsFromSycamore({
      storage,
      actorEmail: session.email
    });
    return NextResponse.json({ summary }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not sync guardian contacts from Sycamore.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
