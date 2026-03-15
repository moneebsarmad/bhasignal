import { NextResponse } from "next/server";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message || fallback;
  }

  if (typeof error === "string") {
    const message = error.trim();
    return message || fallback;
  }

  return fallback;
}

export function handleRouteError(routeName: string, error: unknown, fallback: string) {
  console.error(`${routeName} failed`, error);
  return NextResponse.json({ error: errorMessage(error, fallback) }, { status: 500 });
}
