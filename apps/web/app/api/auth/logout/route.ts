import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth-constants";
import { authCookieOptions } from "@/lib/auth";

function clearSession(request: NextRequest): NextResponse {
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    ...authCookieOptions,
    maxAge: 0
  });
  return response;
}

export async function GET(request: NextRequest) {
  return clearSession(request);
}

export async function POST(request: NextRequest) {
  return clearSession(request);
}
