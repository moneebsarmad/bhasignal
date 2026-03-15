import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/session";

export async function POST() {
  if (!getCurrentSession()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    {
      error: "The PDF parser API has been retired. Use the Sycamore sync workflow instead.",
      retired: true
    },
    { status: 410 }
  );
}
