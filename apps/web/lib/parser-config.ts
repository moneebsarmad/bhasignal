function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parserBaseUrl(): string {
  return process.env.PARSER_BASE_URL?.trim() || "http://127.0.0.1:8000";
}

export function parserRequestTimeoutMs(): number {
  return envNumber("PARSER_REQUEST_TIMEOUT_MS", 30_000);
}
