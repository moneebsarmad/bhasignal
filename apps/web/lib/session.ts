import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AUTH_COOKIE_NAME } from "@/lib/auth-constants";
import { type SessionPayload, type UserRole, verifySessionToken } from "@/lib/auth";

export function getCurrentSession(): SessionPayload | null {
  const token = cookies().get(AUTH_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}

export function requireSession(): SessionPayload {
  const session = getCurrentSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

export function requireRole(allowedRoles: UserRole[]): SessionPayload {
  const session = requireSession();
  if (!allowedRoles.includes(session.role)) {
    redirect("/dashboard");
  }
  return session;
}
