import { createHmac, timingSafeEqual } from "node:crypto";

import { AUTH_COOKIE_NAME, SESSION_TTL_SECONDS } from "@/lib/auth-constants";

export type UserRole = "admin" | "reviewer";

export interface SessionPayload {
  email: string;
  role: UserRole;
  exp: number;
}

export const authCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_SECONDS
};

interface AuthUser {
  email: string;
  role: UserRole;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value) {
    return value;
  }
  throw new Error(`Missing required environment variable: ${name}`);
}

function getSecret(): string {
  const secret = requireEnv("AUTH_SESSION_SECRET");
  if (isProduction() && secret.length < 32) {
    throw new Error("AUTH_SESSION_SECRET must be at least 32 characters in production.");
  }
  return secret;
}

function encodePayload(payload: SessionPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(payload: string): SessionPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;
    if (!parsed.email || !parsed.role || !parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

export function createSessionToken(email: string, role: UserRole): string {
  const payload: SessionPayload = {
    email,
    role,
    exp: Date.now() + SESSION_TTL_SECONDS * 1000
  };
  const encodedPayload = encodePayload(payload);
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = sign(encodedPayload);
  const expectedBuffer = Buffer.from(expectedSignature);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length) {
    return null;
  }
  if (!timingSafeEqual(expectedBuffer, signatureBuffer)) {
    return null;
  }

  const payload = decodePayload(encodedPayload);
  if (!payload) {
    return null;
  }
  if (payload.exp <= Date.now()) {
    return null;
  }
  return payload;
}

export function authenticate(emailRaw: string, passwordRaw: string): AuthUser | null {
  const email = emailRaw.trim().toLowerCase();
  const password = passwordRaw.trim();

  const adminEmail = requireEnv("AUTH_ADMIN_EMAIL").toLowerCase();
  const adminPassword = requireEnv("AUTH_ADMIN_PASSWORD");

  if (email === adminEmail && password === adminPassword) {
    return { email: adminEmail, role: "admin" };
  }

  const reviewerEmail = requireEnv("AUTH_REVIEWER_EMAIL").toLowerCase();
  const reviewerPassword = requireEnv("AUTH_REVIEWER_PASSWORD");

  if (email === reviewerEmail && password === reviewerPassword) {
    return { email: reviewerEmail, role: "reviewer" };
  }

  return null;
}
