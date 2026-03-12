import { NextRequest, NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter } from "@/lib/storage";

export async function GET(request: NextRequest) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = request.nextUrl.searchParams.get("status");
  const studentId = request.nextUrl.searchParams.get("studentId");
  const channel = request.nextUrl.searchParams.get("channel");

  const storage = createStorageAdapter();
  await storage.ensureSchema();
  let notifications = await storage.notifications.list();

  if (status) {
    notifications = notifications.filter((notification) => notification.status === status);
  }
  if (studentId) {
    notifications = notifications.filter((notification) => notification.studentId === studentId);
  }
  if (channel) {
    notifications = notifications.filter((notification) => notification.channel === channel);
  }

  notifications.sort((left, right) => {
    const leftEpoch = Date.parse(left.sentAt ?? "1970-01-01T00:00:00.000Z");
    const rightEpoch = Date.parse(right.sentAt ?? "1970-01-01T00:00:00.000Z");
    return rightEpoch - leftEpoch;
  });

  return NextResponse.json({ notifications });
}
