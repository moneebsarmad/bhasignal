import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { queueNotificationsForInterventions } from "@/lib/notifications";
import { evaluatePolicyAndInterventions } from "@/lib/policies";
import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter, prepareStorage } from "@/lib/storage";

const evaluatePayloadSchema = z.object({
  policyVersion: z.number().int().positive().optional(),
  queueNotifications: z.boolean().default(true)
});

export async function POST(request: NextRequest) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = evaluatePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid evaluate payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const storage = createStorageAdapter();
  await prepareStorage(storage);

  try {
    const evaluation = await evaluatePolicyAndInterventions({
      storage,
      actorEmail: session.email,
      policyVersion: parsed.data.policyVersion
    });

    let queueSummary = null;
    if (parsed.data.queueNotifications) {
      queueSummary = await queueNotificationsForInterventions({
        storage,
        actorEmail: session.email,
        interventionIds: evaluation.triggeredInterventionIds
      });
    }

    return NextResponse.json(
      {
        evaluation,
        queueSummary
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown policy evaluation failure.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
