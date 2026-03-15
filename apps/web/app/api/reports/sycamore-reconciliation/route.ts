import { NextRequest, NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/session";

export async function GET(_request: NextRequest) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    {
      error: "The Sycamore/PDF reconciliation report has been retired.",
      retired: true
    },
    { status: 410 }
  );
}
