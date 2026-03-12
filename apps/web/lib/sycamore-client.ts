import type { SycamoreDateWindow, SycamoreDisciplineFetchResult } from "@/lib/sycamore-contract";

export interface SycamoreClientConfig {
  baseUrl: string;
  accessToken: string;
  schoolId: string;
  disciplinePathTemplate: string;
  studentsPathTemplate: string;
  timeoutMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
}

export interface SycamoreClientDependencies {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface SycamoreDisciplineFetchInput extends SycamoreDateWindow {}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value) {
    return value;
  }
  throw new Error(`Missing required environment variable: ${name}`);
}

function requireOneOfEnv(names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
  throw new Error(`Missing required environment variable: ${names.join(" or ")}`);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizePath(value: string): string {
  return value.startsWith("/") ? value : `/${value}`;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function shouldRetry(status: number | null, error: unknown): boolean {
  if (status !== null) {
    return status === 429 || status >= 500;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|network|fetch failed|econn|enotfound|aborted/i.test(message);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildDisciplinePath(config: SycamoreClientConfig): string {
  return normalizePath(
    config.disciplinePathTemplate.replaceAll("{schoolId}", encodeURIComponent(config.schoolId))
  );
}

function buildStudentsPath(config: SycamoreClientConfig): string {
  return normalizePath(
    config.studentsPathTemplate.replaceAll("{schoolId}", encodeURIComponent(config.schoolId))
  );
}

function buildDisciplineUrl(config: SycamoreClientConfig, date: string): string {
  const url = new URL(`${trimTrailingSlash(config.baseUrl)}${buildDisciplinePath(config)}`);
  url.searchParams.set("Date", date);
  return url.toString();
}

function buildStudentsUrl(config: SycamoreClientConfig): string {
  return new URL(`${trimTrailingSlash(config.baseUrl)}${buildStudentsPath(config)}`).toString();
}

function buildStudentDisciplineLogUrl(
  config: SycamoreClientConfig,
  studentId: string,
  logId: string
): string {
  const baseUrl = trimTrailingSlash(config.baseUrl);
  return `${baseUrl}/Student/${encodeURIComponent(studentId)}/Discipline/${encodeURIComponent(logId)}`;
}

function buildStudentDisciplineOverviewUrl(config: SycamoreClientConfig, studentId: string): string {
  const baseUrl = trimTrailingSlash(config.baseUrl);
  return `${baseUrl}/Student/${encodeURIComponent(studentId)}/Discipline`;
}

function buildStudentDetentionUrl(
  config: SycamoreClientConfig,
  studentId: string,
  detentionId: string
): string {
  const baseUrl = trimTrailingSlash(config.baseUrl);
  return `${baseUrl}/Student/${encodeURIComponent(studentId)}/Detention/${encodeURIComponent(detentionId)}`;
}

function extractDataArray(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("Sycamore discipline response was not an object or array.");
  }

  const source = payload as Record<string, unknown>;
  const candidates = [source.Data, source.data, source.Items, source.items];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
    }
  }

  throw new Error("Sycamore discipline response did not contain a data array.");
}

async function fetchResponseWithRetry(
  url: string,
  config: SycamoreClientConfig,
  dependencies: SycamoreClientDependencies
): Promise<Response> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const sleep = dependencies.sleep ?? defaultSleep;

  let attempt = 1;
  while (true) {
    let status: number | null = null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${config.accessToken}`
          },
          cache: "no-store",
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }

      status = response.status;
      if (!response.ok) {
        if (attempt < config.maxAttempts && shouldRetry(status, null)) {
          await sleep(config.retryBaseDelayMs * 2 ** (attempt - 1));
          attempt += 1;
          continue;
        }
        throw new Error(`Sycamore API returned ${response.status}`);
      }

      return response;
    } catch (error) {
      if (attempt < config.maxAttempts && shouldRetry(status, error)) {
        await sleep(config.retryBaseDelayMs * 2 ** (attempt - 1));
        attempt += 1;
        continue;
      }
      throw error;
    }
  }
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return [];
  }

  const text = await response.text();
  if (!text.trim()) {
    return [];
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error.";
    throw new Error(`Sycamore API returned invalid JSON: ${message}`);
  }
}

function extractDataObject(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const source = payload as Record<string, unknown>;
    const candidates = [source.Data, source.data, source.Item, source.item];
    for (const candidate of candidates) {
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        return candidate as Record<string, unknown>;
      }
    }
    return source;
  }

  if (Array.isArray(payload)) {
    const firstRecord = payload.find(
      (item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))
    );
    if (firstRecord) {
      return firstRecord;
    }
  }

  throw new Error("Sycamore response did not contain an object payload.");
}

export function isSycamoreSyncConfigured(): boolean {
  const enabled = (process.env.SYCAMORE_API_ENABLED ?? "true").trim().toLowerCase();
  if (enabled === "false" || enabled === "0" || enabled === "off") {
    return false;
  }

  return Boolean(
    (process.env.SYCAMORE_ACCESS_TOKEN || process.env.SYCAMORE_API_ACCESS_TOKEN || process.env.SYCAMORE_API_TOKEN) &&
      process.env.SYCAMORE_SCHOOL_ID
  );
}

export function getSycamoreClientConfigFromEnv(): SycamoreClientConfig {
  return {
    baseUrl: trimTrailingSlash(process.env.SYCAMORE_API_BASE_URL?.trim() || "https://app.sycamoreschool.com/api/v1"),
    accessToken: requireOneOfEnv(["SYCAMORE_ACCESS_TOKEN", "SYCAMORE_API_ACCESS_TOKEN", "SYCAMORE_API_TOKEN"]),
    schoolId: requireEnv("SYCAMORE_SCHOOL_ID"),
    disciplinePathTemplate: process.env.SYCAMORE_DISCIPLINE_PATH_TEMPLATE?.trim() || "/School/{schoolId}/Discipline",
    studentsPathTemplate: process.env.SYCAMORE_STUDENTS_PATH_TEMPLATE?.trim() || "/School/{schoolId}/Students",
    timeoutMs: envNumber("SYCAMORE_API_TIMEOUT_MS", 15_000),
    maxAttempts: envNumber("SYCAMORE_API_MAX_ATTEMPTS", 3),
    retryBaseDelayMs: envNumber("SYCAMORE_API_RETRY_BASE_MS", 500)
  };
}

export async function fetchSycamoreDisciplineRange(
  input: SycamoreDisciplineFetchInput,
  config: SycamoreClientConfig,
  dependencies: SycamoreClientDependencies = {}
): Promise<SycamoreDisciplineFetchResult> {
  const records: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];

  let currentDate = input.startDate;
  while (currentDate <= input.endDate) {
    const url = buildDisciplineUrl(config, currentDate);
    const response = await fetchResponseWithRetry(url, config, dependencies);
    const payload = await parseJsonResponse(response);
    const dayRecords = extractDataArray(payload);
    if (dayRecords.length === 0) {
      warnings.push(`sycamore_no_records:${currentDate}`);
    }
    records.push(...dayRecords.map((record) => ({ ...record, __sycamoreOccurredOn: currentDate })));
    currentDate = addDays(currentDate, 1);
  }

  return {
    records,
    warnings,
    dateWindow: {
      startDate: input.startDate,
      endDate: input.endDate
    }
  };
}

export async function fetchSycamoreStudents(
  config: SycamoreClientConfig,
  dependencies: SycamoreClientDependencies = {}
): Promise<Array<Record<string, unknown>>> {
  const response = await fetchResponseWithRetry(buildStudentsUrl(config), config, dependencies);
  const payload = await parseJsonResponse(response);
  return extractDataArray(payload);
}

export async function fetchSycamoreStudentDisciplineOverview(
  studentId: string,
  config: SycamoreClientConfig,
  dependencies: SycamoreClientDependencies = {}
): Promise<Array<Record<string, unknown>>> {
  const response = await fetchResponseWithRetry(buildStudentDisciplineOverviewUrl(config, studentId), config, dependencies);
  const payload = await parseJsonResponse(response);
  return extractDataArray(payload);
}

export async function fetchSycamoreDisciplineLogDetail(
  studentId: string,
  logId: string,
  config: SycamoreClientConfig,
  dependencies: SycamoreClientDependencies = {}
): Promise<Record<string, unknown>> {
  const response = await fetchResponseWithRetry(
    buildStudentDisciplineLogUrl(config, studentId, logId),
    config,
    dependencies
  );
  const payload = await parseJsonResponse(response);
  return extractDataObject(payload);
}

export async function fetchSycamoreDetentionDetail(
  studentId: string,
  detentionId: string,
  config: SycamoreClientConfig,
  dependencies: SycamoreClientDependencies = {}
): Promise<Record<string, unknown>> {
  const response = await fetchResponseWithRetry(
    buildStudentDetentionUrl(config, studentId, detentionId),
    config,
    dependencies
  );
  const payload = await parseJsonResponse(response);
  return extractDataObject(payload);
}
