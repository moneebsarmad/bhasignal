import { NextRequest, NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/session";
import { resolveSycamoreDirectSyncPlan, sycamoreDirectSyncRequestSchema } from "@/lib/sycamore-direct-sync";

export async function POST(request: NextRequest) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = sycamoreDirectSyncRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid Sycamore sync payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const plan = await resolveSycamoreDirectSyncPlan({ request: parsed.data });
    return NextResponse.json({ plan }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not resolve the Sycamore sync plan.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
