import { NextResponse } from "next/server";

import { parserBaseUrl, parserRequestTimeoutMs } from "@/lib/parser-config";
import { getCurrentSession } from "@/lib/session";

export async function GET() {
  if (!getCurrentSession()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = parserBaseUrl();
  const timeoutMs = parserRequestTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/health`, {
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) {
      return NextResponse.json(
        { ok: false, status: response.status, error: "Parser health check failed." },
        { status: 502 }
      );
    }
    const body = (await response.json()) as unknown;
    return NextResponse.json({ ok: true, parser: body });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `Parser health check timed out after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : "Unknown parser connection error.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
