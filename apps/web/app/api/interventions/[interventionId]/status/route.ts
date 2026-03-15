import { NextRequest, NextResponse } from "next/server";

import { interventionStatusUpdateSchema, updateInterventionStatus } from "@/lib/interventions";
import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter, prepareStorage } from "@/lib/storage";

interface RouteContext {
  params: {
    interventionId: string;
  };
}

export async function POST(request: NextRequest, context: RouteContext) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin" && session.role !== "reviewer") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = interventionStatusUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid intervention status payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const storage = createStorageAdapter();
  await prepareStorage(storage);
  try {
    const intervention = await updateInterventionStatus({
      storage,
      interventionId: context.params.interventionId,
      actorEmail: session.email,
      payload: parsed.data
    });
    return NextResponse.json({ intervention }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Intervention status update failed.";
    if (/not found/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (/invalid intervention transition/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
