import type { ParseRun } from "@syc/domain";
import type { StorageRepositories } from "@syc/storage";

import { processSourceIngestionRecords } from "@/lib/ingestion-workflow";
import {
  fetchSycamoreDisciplineRange,
  fetchSycamoreStudents,
  getSycamoreClientConfigFromEnv,
  type SycamoreClientDependencies
} from "@/lib/sycamore-client";
import {
  resolveSycamoreDateWindow,
  sycamoreSyncRequestSchema,
  type SycamoreSyncRequest
} from "@/lib/sycamore-contract";
import {
  normalizeSycamoreDisciplineRecords,
  normalizeSycamoreStudentRecords
} from "@/lib/sycamore-normalizer";
import { upsertRosterStudent } from "@/lib/student-identity";

export interface SyncSycamoreDisciplineInput {
  storage: StorageRepositories;
  actorEmail: string;
  request: SycamoreSyncRequest;
  dependencies?: SycamoreClientDependencies;
}

export interface SyncSycamoreDisciplineResult {
  parseRun: ParseRun;
  sourceWarnings: string[];
  fetchedRecords: number;
  syncMode: "manual_range" | "incremental";
  dateWindow: {
    startDate: string;
    endDate: string;
  };
  rosterSync: {
    attempted: boolean;
    fetchedStudents: number;
    upsertedStudents: number;
  };
}

interface ResolvedSycamoreSyncPlan {
  dateWindow: {
    startDate: string;
    endDate: string;
  };
  syncMode: "manual_range" | "incremental";
  previousCursorEndDate: string | null;
}

function envNumber(name: string, fallback: number, min: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.trunc(parsed));
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayIsoDate(): string {
  const configured = process.env.SYCAMORE_SYNC_TODAY?.trim();
  if (configured && /^\d{4}-\d{2}-\d{2}$/.test(configured)) {
    return configured;
  }
  return new Date().toISOString().slice(0, 10);
}

function parseCursorEndDate(cursorJson: string | null): string | null {
  if (!cursorJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(cursorJson) as { endDate?: unknown };
    return typeof parsed.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.endDate)
      ? parsed.endDate
      : null;
  } catch {
    return null;
  }
}

function isSuccessfulSycamoreRun(parseRun: ParseRun): boolean {
  return parseRun.sourceType === "sycamore_api" && parseRun.status !== "failed";
}

async function resolveSycamoreSyncPlan(
  storage: StorageRepositories,
  request: SycamoreSyncRequest
): Promise<ResolvedSycamoreSyncPlan> {
  if (!request.incremental) {
    return {
      dateWindow: resolveSycamoreDateWindow(request),
      syncMode: "manual_range",
      previousCursorEndDate: null
    };
  }

  const overlapDays = envNumber("SYCAMORE_INCREMENTAL_OVERLAP_DAYS", 1, 0);
  const lookbackDays = envNumber("SYCAMORE_INCREMENTAL_LOOKBACK_DAYS", 7, 1);
  const successfulRuns = (await storage.parseRuns.list())
    .filter(isSuccessfulSycamoreRun)
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
  const previousCursorEndDate = parseCursorEndDate(successfulRuns[0]?.cursorJson ?? null);
  const endDate = todayIsoDate();
  const startDate = previousCursorEndDate
    ? addDays(previousCursorEndDate, -overlapDays)
    : addDays(endDate, -(lookbackDays - 1));

  return {
    dateWindow: {
      startDate: startDate > endDate ? endDate : startDate,
      endDate
    },
    syncMode: "incremental",
    previousCursorEndDate
  };
}

function isRosterSyncEnabled(): boolean {
  const raw = (process.env.SYCAMORE_ROSTER_SYNC_ENABLED ?? "true").trim().toLowerCase();
  return !(raw === "false" || raw === "0" || raw === "off");
}

async function syncSycamoreRoster(input: {
  storage: StorageRepositories;
  dependencies?: SycamoreClientDependencies;
}): Promise<{
  attempted: boolean;
  fetchedStudents: number;
  upsertedStudents: number;
  warnings: string[];
}> {
  if (!isRosterSyncEnabled()) {
    return {
      attempted: false,
      fetchedStudents: 0,
      upsertedStudents: 0,
      warnings: []
    };
  }

  const nowIso = new Date().toISOString();
  const config = getSycamoreClientConfigFromEnv();

  try {
    const records = await fetchSycamoreStudents(config, input.dependencies);
    const normalized = normalizeSycamoreStudentRecords(records, nowIso);

    let upsertedStudents = 0;
    for (const student of normalized.students) {
      await upsertRosterStudent(input.storage, student, nowIso);
      upsertedStudents += 1;
    }

    return {
      attempted: true,
      fetchedStudents: records.length,
      upsertedStudents,
      warnings: normalized.warnings
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown roster sync error.";
    return {
      attempted: true,
      fetchedStudents: 0,
      upsertedStudents: 0,
      warnings: [`sycamore_roster_sync_failed:${message}`]
    };
  }
}

export async function syncSycamoreDiscipline(
  input: SyncSycamoreDisciplineInput
): Promise<SyncSycamoreDisciplineResult> {
  const request = sycamoreSyncRequestSchema.parse(input.request);
  const config = getSycamoreClientConfigFromEnv();
  const syncPlan = await resolveSycamoreSyncPlan(input.storage, request);
  const fetched = await fetchSycamoreDisciplineRange(syncPlan.dateWindow, config, input.dependencies);
  const rosterSync = await syncSycamoreRoster({
    storage: input.storage,
    dependencies: input.dependencies
  });
  const normalized = normalizeSycamoreDisciplineRecords(fetched.records);
  const combinedWarnings = [...fetched.warnings, ...rosterSync.warnings, ...normalized.warnings];

  const metadataJson = JSON.stringify({
    kind: "sycamore_discipline_sync",
    schoolId: config.schoolId,
    baseUrl: config.baseUrl,
    startDate: syncPlan.dateWindow.startDate,
    endDate: syncPlan.dateWindow.endDate,
    fetchedRecords: fetched.records.length,
    syncMode: syncPlan.syncMode,
    previousCursorEndDate: syncPlan.previousCursorEndDate,
    rosterSync: {
      attempted: rosterSync.attempted,
      fetchedStudents: rosterSync.fetchedStudents,
      upsertedStudents: rosterSync.upsertedStudents
    }
  });

  const result = await processSourceIngestionRecords({
    storage: input.storage,
    actorEmail: input.actorEmail,
    sourceType: "sycamore_api",
    fileName: `sycamore-discipline-${syncPlan.dateWindow.startDate}_to_${syncPlan.dateWindow.endDate}.json`,
    sourceRecords: normalized.sourceRecords,
    sourceWarnings: combinedWarnings,
    retryParseRunId: request.retryParseRunId,
    triggeredBy: input.actorEmail,
    metadataJson,
    cursorJson: JSON.stringify({
      endDate: syncPlan.dateWindow.endDate,
      syncMode: syncPlan.syncMode
    })
  });

  return {
    parseRun: result.parseRun,
    sourceWarnings: result.sourceWarnings,
    fetchedRecords: fetched.records.length,
    syncMode: syncPlan.syncMode,
    dateWindow: syncPlan.dateWindow,
    rosterSync: {
      attempted: rosterSync.attempted,
      fetchedStudents: rosterSync.fetchedStudents,
      upsertedStudents: rosterSync.upsertedStudents
    }
  };
}
