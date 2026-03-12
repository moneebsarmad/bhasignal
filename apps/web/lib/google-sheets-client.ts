import { google } from "googleapis";

import type { SheetsClient } from "@syc/storage";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getSpreadsheetId(): string {
  return requiredEnv("GOOGLE_SHEETS_SPREADSHEET_ID");
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableSheetsError(error: unknown): boolean {
  const status =
    typeof (error as { status?: unknown })?.status === "number"
      ? Number((error as { status: number }).status)
      : null;
  if (status !== null && (status === 429 || status >= 500)) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /quota exceeded|resource_exhausted|too many requests|rate limit|429|5\d\d/i.test(message);
}

async function withSheetsRetry<T>(operation: () => Promise<T>): Promise<T> {
  const maxAttempts = envNumber("SHEETS_API_MAX_ATTEMPTS", 6);
  const baseDelayMs = envNumber("SHEETS_API_RETRY_BASE_MS", 500);

  let attempt = 1;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      const canRetry = attempt < maxAttempts && isRetryableSheetsError(error);
      if (!canRetry) {
        throw error;
      }
      const waitMs = baseDelayMs * 2 ** (attempt - 1);
      await sleep(waitMs);
      attempt += 1;
    }
  }
}

export function createGoogleSheetsClient(): SheetsClient {
  const auth = new google.auth.JWT({
    email: requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    key: requiredEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = getSpreadsheetId();

  return {
    async read(range: string): Promise<string[][]> {
      const response = await withSheetsRetry(async () =>
        sheets.spreadsheets.values.get({
          spreadsheetId,
          range
        })
      );
      return (response.data.values as string[][] | undefined) ?? [];
    },
    async update(range: string, values: string[][]): Promise<void> {
      await withSheetsRetry(async () =>
        sheets.spreadsheets.values.update({
          spreadsheetId,
          range,
          valueInputOption: "RAW",
          requestBody: { values }
        })
      );
    },
    async append(range: string, values: string[][]): Promise<void> {
      await withSheetsRetry(async () =>
        sheets.spreadsheets.values.append({
          spreadsheetId,
          range,
          valueInputOption: "RAW",
          requestBody: { values }
        })
      );
    }
  };
}
