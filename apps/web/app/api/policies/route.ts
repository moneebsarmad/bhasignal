import { NextRequest, NextResponse } from "next/server";

import { createPolicyVersion, parseInterventionTemplates, policyInputSchema } from "@/lib/policies";
import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter } from "@/lib/storage";

export async function GET() {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storage = createStorageAdapter();
  await storage.ensureSchema();
  const policies = (await storage.policies.list()).sort((left, right) => right.version - left.version);
  const latest = policies[0] ?? null;

  return NextResponse.json({
    latest,
    policies: policies.map((policy) => ({
      ...policy,
      parsedTemplates: parseInterventionTemplates(policy)
    }))
  });
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
  const parsed = policyInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid policy payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const storage = createStorageAdapter();
  await storage.ensureSchema();
  const created = await createPolicyVersion({
    storage,
    actorEmail: session.email,
    payload: parsed.data
  });

  return NextResponse.json({ policy: created }, { status: 201 });
}
