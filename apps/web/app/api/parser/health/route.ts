import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/session";

export async function GET() {
  if (!getCurrentSession()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    retired: true,
    message: "The PDF parser has been retired. Sycamore sync is the active intake path."
  });
}
