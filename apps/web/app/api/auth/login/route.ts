import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth-constants";
import { authCookieOptions, authenticate, createSessionToken } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.email !== "string" || typeof body.password !== "string") {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  let user;
  try {
    user = authenticate(body.email, body.password);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Authentication configuration error."
      },
      { status: 500 }
    );
  }
  if (!user) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const sessionToken = createSessionToken(user.email, user.role);
  const response = NextResponse.json({ ok: true, role: user.role });
  response.cookies.set(AUTH_COOKIE_NAME, sessionToken, authCookieOptions);
  return response;
}
