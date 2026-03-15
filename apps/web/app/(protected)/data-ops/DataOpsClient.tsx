"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RefreshCcw, Server, ShieldAlert, Workflow } from "lucide-react";

import {
  Button,
  InlineAlert,
  PageHeader,
  Panel,
  StatCard,
  StatusBadge,
  tableCellClassName,
  tableClassName,
  tableHeadCellClassName,
  tableShellClassName
} from "@/components/ui";
import { cn } from "@/lib/cn";

interface DataOpsSnapshot {
  generatedAt: string;
  storage: {
    mode: "supabase" | "google_sheets" | "local_file";
    label: string;
    detail: string;
  };
  parser: {
    configured: boolean;
    ok: boolean | null;
    baseUrl: string | null;
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

function sourceLabel(sourceType: string): string {
  return sourceType === "sycamore_api" ? "Sycamore sync" : sourceType === "manual_pdf" ? "Legacy PDF import" : sourceType;
}

function formatSurfaceValue(value: string): string {
  return value.replace(/\.$/, "");
}

function summarizeEndpoint(value: string | null): string {
  if (!value) {
    return "Not configured";
  }

  const trimmed = formatSurfaceValue(value.replace(/^Project URL\s+/i, ""));

  try {
    return new URL(trimmed).host;
  } catch {
    return trimmed;
  }
}

function parserTone(parser: DataOpsSnapshot["parser"]): "neutral" | "warning" | "success" | "danger" {
  if (!parser.configured) {
    return "warning";
  }
  if (parser.ok === null) {
    return "neutral";
  }
  return parser.ok ? "success" : "danger";
}

function parserLabel(parser: DataOpsSnapshot["parser"]): string {
  if (!parser.configured) {
    return "retired";
  }
  if (parser.ok === null) {
    return "unknown";
  }
  return parser.ok ? "healthy" : "failing";
}

function syncStatusTone(
  sycamore: DataOpsSnapshot["sycamore"]
): "success" | "warning" | "danger" {
  if (sycamore.error) {
    return "danger";
  }
  if (!sycamore.configured || sycamore.failedSyncs > 0) {
    return "warning";
  }
  return "success";
}

export function DataOpsClient() {
  const [data, setData] = useState<DataOpsSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const response = await fetch("/api/data-ops/status", { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as DataOpsSnapshot | { error?: string } | null;
    if (!response.ok) {
      setError((body as { error?: string } | null)?.error || "Failed to load data operations status.");
      setIsLoading(false);
      return;
    }

    setData(body as DataOpsSnapshot);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const sycamoreNeedsAttention = Boolean(data?.sycamore.error);
  const systemsNeedAttention = sycamoreNeedsAttention;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin controls"
        title="Data operations and system health"
        description="Track dependency health, workflow backlog, and failure signals without turning this page into a second intake dashboard."
        actions={
          <Button type="button" variant="secondary" onClick={() => void loadStatus()} disabled={isLoading}>
            <RefreshCcw className={cn("h-4 w-4", isLoading ? "animate-spin" : "")} />
            {isLoading ? "Refreshing..." : "Refresh status"}
          </Button>
        }
      />

      {error ? (
        <InlineAlert tone="danger" title="Data operations status could not be loaded.">
          {error}
        </InlineAlert>
      ) : null}

      {data ? (
        <>
          <Panel className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <h2 className="font-display text-2xl text-[var(--color-ink)]">
                {systemsNeedAttention ? "Systems need attention" : "Systems reachable"}
              </h2>
              <p className="text-sm text-[var(--color-muted)]">
                Snapshot from {new Date(data.generatedAt).toLocaleString()}.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone={data.sycamore.configured ? "success" : "warning"}>
                {data.sycamore.configured ? "Sycamore configured" : "Sycamore not configured"}
              </StatusBadge>
              <StatusBadge tone="info">{data.storage.label}</StatusBadge>
            </div>
          </Panel>

          <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
            <StatCard
              label="Failed syncs"
              value={data.sycamore.failedSyncs}
              description="Sycamore runs needing follow-up."
              icon={Workflow}
              href="/ingestion"
            />
            <StatCard
              label="Queued notifications"
              value={data.backlog.queuedNotifications}
              description="Waiting for dispatch."
              icon={Server}
              href="/notifications"
            />
            <StatCard
              label="Overdue interventions"
              value={data.backlog.overdueInterventions}
              description="Past due."
              icon={ShieldAlert}
              href="/students"
            />
            <StatCard
              label="Review-required imports"
              value={data.ingestion.reviewRequiredJobs}
              description="Legacy/manual jobs still needing attention."
              icon={Workflow}
              href="/ingestion"
            />
            <StatCard
              label="Recent failures"
              value={data.recentFailures.length}
              description="Surfaced across sync and notification workflows."
              icon={ShieldAlert}
              href="/audit"
            />
          </section>

          <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <Panel className="space-y-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Environment</p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Dependency surface</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-muted)]">
                    Keep the dependency readout compact: live storage, the retired parser lane, and the active Sycamore target.
                  </p>
                </div>
                <StatusBadge tone={syncStatusTone(data.sycamore)}>
                  {data.sycamore.error
                    ? "sync attention needed"
                    : data.sycamore.failedSyncs > 0
                      ? `${data.sycamore.failedSyncs} failed sync${data.sycamore.failedSyncs === 1 ? "" : "s"}`
                      : "sync path stable"}
                </StatusBadge>
              </div>

              <div className="grid gap-3 lg:grid-cols-3">
                <div className="rounded-[1.25rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Storage</p>
                      <h3 className="mt-2 text-lg font-semibold text-[var(--color-ink)]">{data.storage.label}</h3>
                    </div>
                    <StatusBadge tone="info">{data.storage.mode.replace(/_/g, " ")}</StatusBadge>
                  </div>
                  <dl className="mt-4 space-y-3 text-sm">
                    <div className="flex items-start justify-between gap-4">
                      <dt className="text-[var(--color-subtle)]">Endpoint</dt>
                      <dd className="max-w-[16rem] text-right font-medium text-[var(--color-ink)] break-all">
                        {summarizeEndpoint(data.storage.detail)}
                      </dd>
                    </div>
                    <div className="border-t border-[var(--color-line)] pt-3 text-[var(--color-muted)]">
                      {formatSurfaceValue(data.storage.detail)}
                    </div>
                  </dl>
                </div>

                <div className="rounded-[1.25rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Legacy parser</p>
                      <h3 className="mt-2 text-lg font-semibold text-[var(--color-ink)]">PDF lane</h3>
                    </div>
                    <StatusBadge tone={parserTone(data.parser)}>{parserLabel(data.parser)}</StatusBadge>
                  </div>
                  <div className="mt-4 space-y-3 text-sm">
                    <p className="font-medium text-[var(--color-ink)]">
                      {data.parser.configured ? summarizeEndpoint(data.parser.baseUrl) : "Retired in this environment"}
                    </p>
                    <p className="leading-6 text-[var(--color-muted)]">
                      {!data.parser.configured
                        ? "Kept only for historical context. Active intake runs through Sycamore sync."
                        : data.parser.ok === null
                          ? "Configured, but no health probe has been recorded yet."
                          : data.parser.ok
                            ? "Health probe succeeded."
                            : data.parser.error || `Health probe failed${data.parser.status ? ` with status ${data.parser.status}` : ""}.`}
                    </p>
                  </div>
                </div>

                <div className="rounded-[1.25rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Sycamore</p>
                      <h3 className="mt-2 text-lg font-semibold text-[var(--color-ink)]">Live source target</h3>
                    </div>
                    <StatusBadge tone={data.sycamore.configured ? "success" : "warning"}>
                      {data.sycamore.configured ? "configured" : "not configured"}
                    </StatusBadge>
                  </div>
                  <dl className="mt-4 space-y-3 text-sm">
                    <div className="flex items-start justify-between gap-4">
                      <dt className="text-[var(--color-subtle)]">Host</dt>
                      <dd className="max-w-[16rem] text-right font-medium text-[var(--color-ink)] break-all">
                        {summarizeEndpoint(data.sycamore.baseUrl)}
                      </dd>
                    </div>
                    <div className="flex items-start justify-between gap-4 border-t border-[var(--color-line)] pt-3">
                      <dt className="text-[var(--color-subtle)]">School</dt>
                      <dd className="text-right font-medium text-[var(--color-ink)]">
                        {data.sycamore.schoolId ? `#${data.sycamore.schoolId}` : "Missing"}
                      </dd>
                    </div>
                    <div className="flex items-start justify-between gap-4 border-t border-[var(--color-line)] pt-3">
                      <dt className="text-[var(--color-subtle)]">Window</dt>
                      <dd className="text-right font-medium text-[var(--color-ink)]">
                        {data.sycamore.lastWindow
                          ? `${data.sycamore.lastWindow.startDate} to ${data.sycamore.lastWindow.endDate}`
                          : "No sync window"}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-xs leading-5 text-[var(--color-muted)] break-all">
                    Path {data.sycamore.pathTemplate}
                  </p>
                  {data.sycamore.error ? <p className="mt-2 text-sm text-[var(--color-danger)]">{data.sycamore.error}</p> : null}
                </div>
              </div>

              {Object.keys(data.ingestion.bySource).length > 0 ? (
                <div className="overflow-hidden rounded-[1.25rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)]">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3">
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--color-ink)]">Historical import footprint</h3>
                      <p className="text-xs text-[var(--color-muted)]">
                        Stored job history by source, kept for audit and cleanup visibility.
                      </p>
                    </div>
                    <StatusBadge tone="neutral">
                      {Object.keys(data.ingestion.bySource).length} source{Object.keys(data.ingestion.bySource).length === 1 ? "" : "s"}
                    </StatusBadge>
                  </div>

                  <div className="divide-y divide-[var(--color-line)]">
                    {Object.entries(data.ingestion.bySource).map(([key, summary]) => (
                      <div key={key} className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,0.7fr))] lg:items-center">
                        <div className="space-y-1">
                          <p className="font-semibold text-[var(--color-ink)]">{sourceLabel(key)}</p>
                          <p className="text-xs text-[var(--color-muted)]">
                            {summary.lastCompletedAt
                              ? `Last completed ${new Date(summary.lastCompletedAt).toLocaleString()}`
                              : "No completed jobs recorded"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">Jobs</p>
                          <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">{summary.totalJobs}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">Failed</p>
                          <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">{summary.failedJobs}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">Review</p>
                          <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">{summary.reviewRequiredJobs}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">Flagged</p>
                          <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">{summary.flaggedRows}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </Panel>

            <Panel className="space-y-4">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Baseline</p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Operational baseline</h2>
                </div>
                <StatusBadge tone={data.backlog.activeInterventions > 0 || data.ingestion.flaggedRows > 0 ? "warning" : "success"}>
                  {data.backlog.activeInterventions + data.ingestion.flaggedRows} visible load
                </StatusBadge>
              </div>

              <div className="grid gap-3">
                <div className="rounded-[1.25rem] border border-[var(--color-line)] bg-[linear-gradient(135deg,rgba(17,94,89,0.06),rgba(255,255,255,0.98)_55%)] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Last successful sync</p>
                  <p className="mt-2 text-base font-semibold text-[var(--color-ink)]">
                    {data.sycamore.lastSuccessfulCompletedAt
                      ? new Date(data.sycamore.lastSuccessfulCompletedAt).toLocaleString()
                      : "No successful sync yet"}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
                    {data.sycamore.lastSuccessfulWindow
                      ? `Window ${data.sycamore.lastSuccessfulWindow.startDate} to ${data.sycamore.lastSuccessfulWindow.endDate}.`
                      : "No successful window recorded yet."}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[1.25rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Active interventions</p>
                    <p className="mt-2 font-display text-4xl text-[var(--color-ink)]">{data.backlog.activeInterventions}</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">Students currently carrying intervention work.</p>
                  </div>

                  <div className="rounded-[1.25rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Legacy backlog</p>
                    <p className="mt-2 font-display text-4xl text-[var(--color-ink)]">{data.ingestion.flaggedRows}</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
                      Historical flagged rows that may still need cleanup.
                    </p>
                  </div>
                </div>

                <div className="rounded-[1.25rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">Sync mode</p>
                      <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">
                        {data.sycamore.lastSyncMode ? data.sycamore.lastSyncMode.replace(/_/g, " ") : "No runs yet"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">Discovered</p>
                      <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">
                        {data.sycamore.lastRecordsDiscovered ?? 0}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">Upserted</p>
                      <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">
                        {data.sycamore.lastRecordsUpserted ?? 0}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </Panel>

            <Panel className="space-y-5 xl:col-span-2">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Failures</p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Recent workflow failures</h2>
                </div>
                <StatusBadge tone={data.recentFailures.length > 0 ? "warning" : "success"}>
                  {data.recentFailures.length} surfaced
                </StatusBadge>
              </div>

              {data.recentFailures.length === 0 ? (
                <Panel className="border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4 shadow-none">
                  <p className="text-sm leading-7 text-[var(--color-muted)]">
                    No recent Sycamore sync issues or failed notifications are currently visible in this environment.
                  </p>
                </Panel>
              ) : (
                <div className={tableShellClassName}>
                  <div className="overflow-x-auto">
                    <table className={tableClassName}>
                      <thead>
                        <tr>
                          <th className={tableHeadCellClassName}>Time</th>
                          <th className={tableHeadCellClassName}>Kind</th>
                          <th className={tableHeadCellClassName}>Label</th>
                          <th className={tableHeadCellClassName}>Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-line)]">
                        {data.recentFailures.map((failure) => (
                          <tr key={failure.id}>
                            <td className={tableCellClassName}>{new Date(failure.createdAt).toLocaleString()}</td>
                            <td className={tableCellClassName}>
                              <StatusBadge tone={failure.kind === "parse_run" ? "danger" : "warning"}>
                                {failure.kind === "parse_run" ? "legacy import" : failure.kind.replace(/_/g, " ")}
                              </StatusBadge>
                            </td>
                            <td className={tableCellClassName}>{failure.label}</td>
                            <td className={tableCellClassName}>
                              <Link
                                href={
                                  failure.kind === "parse_run" ? "/ingestion" : "/notifications"
                                }
                                className="font-semibold text-[var(--color-primary)] hover:text-[var(--color-primary-strong)]"
                              >
                                Open
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Panel>
          </section>
        </>
      ) : null}
    </div>
  );
}
