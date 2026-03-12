import { NextRequest, NextResponse } from "next/server";

import { parseDisciplinePdf } from "@/lib/parser-client";
import { parseRequestSchema } from "@/lib/parser-contract";
import { getCurrentSession } from "@/lib/session";

export async function POST(request: NextRequest) {
  if (!getCurrentSession()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = parseRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid parse request.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const result = await parseDisciplinePdf(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown parser error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
