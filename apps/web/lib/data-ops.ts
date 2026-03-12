import { resolve } from "node:path";

import type { StorageRepositories } from "@syc/storage";

import { parserBaseUrl, parserRequestTimeoutMs } from "@/lib/parser-config";
import { buildSycamoreDataOpsSummary } from "@/lib/sycamore-direct-sync";
import type { SycamoreStore } from "@/lib/sycamore-direct-store";

export interface DataOpsSnapshot {
  generatedAt: string;
  storage: {
    mode: "supabase" | "google_sheets" | "local_file";
    label: string;
    detail: string;
  };
  parser: {
    ok: boolean;
    baseUrl: string;
    status?: number;
    error?: string;
  };
  ingestion: {
    totalJobs: number;
    failedJobs: number;
    reviewRequiredJobs: number;
    activeJobs: number;
    flaggedRows: number;
    lastCompletedAt: string | null;
    bySource: Record<
      string,
      {
        totalJobs: number;
        failedJobs: number;
        reviewRequiredJobs: number;
        activeJobs: number;
        flaggedRows: number;
        lastCompletedAt: string | null;
      }
    >;
  };
  sycamore: {
    configured: boolean;
    baseUrl: string;
    schoolId: string | null;
    pathTemplate: string;
    totalLogs: number;
    linkedLogs: number;
    totalSyncs: number;
    failedSyncs: number;
    lastCompletedAt: string | null;
    lastSuccessfulCompletedAt: string | null;
    lastFailedAt: string | null;
    lastWindow: {
      startDate: string;
      endDate: string;
    } | null;
    lastSuccessfulWindow: {
      startDate: string;
      endDate: string;
    } | null;
    lastRecordsDiscovered: number | null;
    lastRecordsUpserted: number | null;
    lastSyncMode: "initial_backfill" | "manual_range" | "incremental" | null;
    error?: string;
  };
  review: {
    open: number;
    approved: number;
    edited: number;
    rejected: number;
  };
  backlog: {
    queuedNotifications: number;
    overdueInterventions: number;
    activeInterventions: number;
  };
  recentFailures: Array<{
    id: string;
    kind: "parse_run" | "notification";
    label: string;
    createdAt: string;
  }>;
}

function hasSheetsEnv(): boolean {
  return Boolean(
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID &&
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  );
}

function hasSupabaseEnv(): boolean {
  return Boolean(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function localStoragePath(): string {
  const configured = process.env.LOCAL_STORAGE_FILE?.trim();
  if (configured) {
    return resolve(configured);
  }
  return resolve(process.cwd(), ".local", "web-storage.json");
}

function sycamoreBaseUrl(): string {
  return process.env.SYCAMORE_API_BASE_URL?.trim() || "https://app.sycamoreschool.com/api/v1";
}

function sycamorePathTemplate(): string {
  return process.env.SYCAMORE_DISCIPLINE_PATH_TEMPLATE?.trim() || "/School/{schoolId}/Discipline";
}

function summarizeParseRuns(parseRuns: Awaited<ReturnType<StorageRepositories["parseRuns"]["list"]>>) {
  const bySource: DataOpsSnapshot["ingestion"]["bySource"] = {};

  for (const parseRun of parseRuns) {
    const summary =
      bySource[parseRun.sourceType] ??
      {
        totalJobs: 0,
        failedJobs: 0,
        reviewRequiredJobs: 0,
        activeJobs: 0,
        flaggedRows: 0,
        lastCompletedAt: null
      };

    summary.totalJobs += 1;
    summary.failedJobs += parseRun.status === "failed" ? 1 : 0;
    summary.reviewRequiredJobs += parseRun.status === "review_required" ? 1 : 0;
    summary.activeJobs += parseRun.status === "pending" || parseRun.status === "processing" ? 1 : 0;
    summary.flaggedRows += parseRun.rowsFlagged;
    if (parseRun.completedAt) {
      const currentEpoch = Date.parse(summary.lastCompletedAt ?? "");
      const nextEpoch = Date.parse(parseRun.completedAt);
      if (summary.lastCompletedAt === null || (!Number.isNaN(nextEpoch) && nextEpoch > currentEpoch)) {
        summary.lastCompletedAt = parseRun.completedAt;
      }
    }
    bySource[parseRun.sourceType] = summary;
  }

  return bySource;
}

async function probeParser(): Promise<DataOpsSnapshot["parser"]> {
  const baseUrl = parserBaseUrl();
  const timeoutMs = parserRequestTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/health`, { cache: "no-store", signal: controller.signal });
    if (!response.ok) {
      return {
        ok: false,
        baseUrl,
        status: response.status,
        error: "Parser health check failed."
      };
    }
    return {
      ok: true,
      baseUrl,
      status: response.status
    };
  } catch (error) {
    return {
      ok: false,
      baseUrl,
      error:
        error instanceof Error && error.name === "AbortError"
          ? `Parser health check timed out after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : "Unknown parser connection error."
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function buildDataOpsSnapshot(
  storage: StorageRepositories,
  options?: {
    sycamoreStore?: SycamoreStore;
  }
): Promise<DataOpsSnapshot> {
  const [parseRuns, openTasks, approvedTasks, editedTasks, rejectedTasks, interventions, notifications, parser] =
    await Promise.all([
      storage.parseRuns.list(),
      storage.reviewTasks.listByStatus("open"),
      storage.reviewTasks.listByStatus("approved"),
      storage.reviewTasks.listByStatus("edited"),
      storage.reviewTasks.listByStatus("rejected"),
      storage.interventions.list(),
      storage.notifications.list(),
      probeParser()
    ]);
  const ingestionBySource = summarizeParseRuns(parseRuns);
  const sycamore = await buildSycamoreDataOpsSummary(options?.sycamoreStore);

  const lastCompletedAt =
    [...parseRuns]
      .filter((run) => Boolean(run.completedAt))
      .sort((left, right) => Date.parse(right.completedAt ?? "") - Date.parse(left.completedAt ?? ""))[0]
      ?.completedAt ?? null;

  const failedRuns = [...parseRuns]
    .filter((run) => run.status === "failed")
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
    .slice(0, 5)
    .map((run) => ({
      id: run.id,
      kind: "parse_run" as const,
      label: run.fileName,
      createdAt: run.startedAt
    }));

  const failedNotifications = [...notifications]
    .filter((notification) => notification.status === "failed")
    .sort((left, right) => {
      const leftEpoch = Date.parse(left.sentAt ?? "1970-01-01T00:00:00.000Z");
      const rightEpoch = Date.parse(right.sentAt ?? "1970-01-01T00:00:00.000Z");
      return rightEpoch - leftEpoch;
    })
    .slice(0, 5)
    .map((notification) => ({
      id: notification.id,
      kind: "notification" as const,
      label: notification.recipient,
      createdAt: notification.sentAt ?? new Date(0).toISOString()
    }));

  return {
    generatedAt: new Date().toISOString(),
    storage: hasSupabaseEnv()
      ? {
          mode: "supabase",
          label: "Supabase",
          detail: `Project URL ${process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL}.`
        }
      : hasSheetsEnv()
      ? {
          mode: "google_sheets",
          label: "Google Sheets",
          detail: "Spreadsheet-backed adapter configured through service-account credentials."
        }
      : {
          mode: "local_file",
          label: "Local file",
          detail: `Development fallback at ${localStoragePath()}.`
        },
    parser,
    ingestion: {
      totalJobs: parseRuns.length,
      failedJobs: parseRuns.filter((run) => run.status === "failed").length,
      reviewRequiredJobs: parseRuns.filter((run) => run.status === "review_required").length,
      activeJobs: parseRuns.filter((run) => run.status === "pending" || run.status === "processing").length,
      flaggedRows: parseRuns.reduce((sum, run) => sum + run.rowsFlagged, 0),
      lastCompletedAt,
      bySource: ingestionBySource
    },
    sycamore,
    review: {
      open: openTasks.length,
      approved: approvedTasks.length,
      edited: editedTasks.length,
      rejected: rejectedTasks.length
    },
    backlog: {
      queuedNotifications: notifications.filter((notification) => notification.status === "queued").length,
      overdueInterventions: interventions.filter((intervention) => intervention.status === "overdue").length,
      activeInterventions: interventions.filter((intervention) =>
        ["open", "in_progress", "overdue"].includes(intervention.status)
      ).length
    },
    recentFailures: [...failedRuns, ...failedNotifications]
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, 8)
  };
}
