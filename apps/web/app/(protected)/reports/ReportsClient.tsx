"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { BellDot, FileSpreadsheet, RefreshCcw, ShieldCheck, Users } from "lucide-react";

import {
  Button,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  InsightPanel,
  PageHeader,
  Panel,
  Select,
  StatCard,
  StatusBadge,
  buttonStyles,
  tableCellClassName,
  tableClassName,
  tableHeadCellClassName,
  tableShellClassName
} from "@/components/ui";
import { cn } from "@/lib/cn";

interface ReportSnapshot {
  generatedAt: string;
  filters: {
    grade: string;
    from: string;
    to: string;
    sourceType: string;
  };
  summary: Array<{
    label: string;
    value: number;
    description: string;
  }>;
  incidentsByGrade: Array<{
    grade: string;
    studentCount: number;
    incidentCount: number;
    totalPoints: number;
    activeInterventions: number;
  }>;
  topReasons: Array<{
    reason: string;
    incidentCount: number;
    totalPoints: number;
  }>;
  studentRows: Array<{
    studentId: string;
    fullName: string;
    grade: string;
    incidentCount: number;
    totalPoints: number;
    activeInterventions: number;
    notificationCount: number;
    latestIncidentAt: string | null;
  }>;
  interventionStatus: Record<string, number>;
  notificationStatus: Record<string, number>;
  sourceBreakdown: Record<string, number>;
  narrative: string;
}

function buildQuery(filters: { grade: string; from: string; to: string; sourceType: string }): string {
  const params = new URLSearchParams();
  if (filters.grade.trim()) {
    params.set("grade", filters.grade.trim());
  }
  if (filters.from) {
    params.set("from", filters.from);
  }
  if (filters.to) {
    params.set("to", filters.to);
  }
  if (filters.sourceType) {
    params.set("sourceType", filters.sourceType);
  }
  return params.toString();
}

function statusRows(record: Record<string, number>) {
  return Object.entries(record).sort((left, right) => right[1] - left[1]);
}

function sourceLabel(sourceType: string): string {
  return sourceType === "sycamore_api" ? "Sycamore API" : sourceType === "manual_pdf" ? "Manual PDF" : "All sources";
}

export function ReportsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [grade, setGrade] = useState(() => searchParams.get("grade") || "");
  const [from, setFrom] = useState(() => searchParams.get("from") || "");
  const [to, setTo] = useState(() => searchParams.get("to") || "");
  const [sourceType, setSourceType] = useState(() => searchParams.get("sourceType") || "");
  const [data, setData] = useState<ReportSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGrade(searchParams.get("grade") || "");
    setFrom(searchParams.get("from") || "");
    setTo(searchParams.get("to") || "");
    setSourceType(searchParams.get("sourceType") || "");
  }, [searchParams]);

  const currentQuery = useMemo(
    () => buildQuery({ grade, from, to, sourceType }),
    [grade, from, sourceType, to]
  );

  const loadSnapshot = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const response = await fetch(`/api/reports/summary?${currentQuery}`, { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as ReportSnapshot | { error?: string } | null;
    if (!response.ok) {
      setError((body as { error?: string } | null)?.error || "Failed to load reports.");
      setIsLoading(false);
      return;
    }

    setData(body as ReportSnapshot);
    setIsLoading(false);
  }, [currentQuery]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  function onApplyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.replace(currentQuery ? `/reports?${currentQuery}` : "/reports", { scroll: false });
    void loadSnapshot();
  }

  const exportHref = useCallback(
    (dataset: "students" | "grades" | "reasons") => {
      const params = new URLSearchParams(currentQuery);
      params.set("dataset", dataset);
      return `/api/reports/export?${params.toString()}`;
    },
    [currentQuery]
  );

  const interventionRows = useMemo(() => statusRows(data?.interventionStatus ?? {}), [data]);
  const notificationRows = useMemo(() => statusRows(data?.notificationStatus ?? {}), [data]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analysis"
        title="Reporting studio for discipline trends and exports"
        description="Filter the canonical dataset, scan cohort shifts, and export the exact slices staff need for review packets or leadership reporting."
        actions={
          <div className="flex flex-wrap gap-3">
            <Link href="/reports/reconciliation" className={buttonStyles({ variant: "secondary" })}>
              Student reconciliation
            </Link>
            <Button type="button" variant="secondary" onClick={() => void loadSnapshot()} disabled={isLoading}>
              <RefreshCcw className={cn("h-4 w-4", isLoading ? "animate-spin" : "")} />
              {isLoading ? "Refreshing..." : "Refresh report"}
            </Button>
          </div>
        }
      />

      <Panel className="space-y-5">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Filters</p>
            <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Pin the reporting window</h2>
          </div>
          <div className="flex flex-wrap gap-3">
            <a href={exportHref("students")} className="text-sm font-semibold text-[var(--color-primary)]">
              Export students CSV
            </a>
            <a href={exportHref("grades")} className="text-sm font-semibold text-[var(--color-primary)]">
              Export grades CSV
            </a>
            <a href={exportHref("reasons")} className="text-sm font-semibold text-[var(--color-primary)]">
              Export reasons CSV
            </a>
          </div>
        </div>

        <form onSubmit={onApplyFilters} className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_auto]">
          <Field label="Grade" hint="Leave blank for all grades.">
            <Input value={grade} onChange={(event) => setGrade(event.currentTarget.value)} placeholder="e.g. 8" />
          </Field>
          <Field label="From">
            <Input type="date" value={from} onChange={(event) => setFrom(event.currentTarget.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(event) => setTo(event.currentTarget.value)} />
          </Field>
          <Field label="Source">
            <Select value={sourceType} onChange={(event) => setSourceType(event.currentTarget.value)}>
              <option value="">All sources</option>
              <option value="manual_pdf">Manual PDF</option>
              <option value="sycamore_api">Sycamore API</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <Button type="submit" variant="primary" className="w-full xl:w-auto" disabled={isLoading}>
              Apply filters
            </Button>
          </div>
        </form>
      </Panel>

      {error ? (
        <InlineAlert tone="danger" title="Reporting data could not be loaded.">
          {error}
        </InlineAlert>
      ) : null}

      {data ? (
        <>
          <InsightPanel
            eyebrow="Readout"
            title="Current reporting signal"
            description={data.narrative}
          >
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge tone="info">Generated {new Date(data.generatedAt).toLocaleString()}</StatusBadge>
              {data.filters.grade ? <StatusBadge tone="neutral">Grade {data.filters.grade}</StatusBadge> : null}
              {data.filters.from ? <StatusBadge tone="neutral">From {data.filters.from}</StatusBadge> : null}
              {data.filters.to ? <StatusBadge tone="neutral">To {data.filters.to}</StatusBadge> : null}
              {data.filters.sourceType ? (
                <StatusBadge tone="neutral">{sourceLabel(data.filters.sourceType)}</StatusBadge>
              ) : null}
            </div>
          </InsightPanel>

          <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
            {data.summary.map((metric, index) => {
              const icons = [Users, FileSpreadsheet, ShieldCheck, BellDot, ShieldCheck];
              const hrefs = [
                `/students${currentQuery ? `?${currentQuery}` : ""}`,
                `/reports${currentQuery ? `?${currentQuery}` : ""}`,
                `/students${currentQuery ? `?${currentQuery}` : ""}`,
                "/notifications",
                "/notifications"
              ];
              return (
                <StatCard
                  key={metric.label}
                  label={metric.label}
                  value={metric.value}
                  description={metric.description}
                  icon={icons[index]}
                  href={hrefs[index]}
                  linkLabel={index === 1 ? "Stay on report" : "Open"}
                />
              );
            })}
          </section>

          {Object.keys(data.sourceBreakdown).length > 0 ? (
            <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {Object.entries(data.sourceBreakdown).map(([key, value]) => (
                <Panel key={key} className="border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4 shadow-none">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                    Source mix
                  </p>
                  <p className="mt-2 font-display text-3xl text-[var(--color-ink)]">{value}</p>
                  <p className="mt-2 text-sm text-[var(--color-muted)]">{sourceLabel(key)} incidents in the current report slice.</p>
                </Panel>
              ))}
            </section>
          ) : null}

          <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
            <Panel className="space-y-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Cohorts</p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Incidents by grade</h2>
                </div>
                <StatusBadge tone="info">{data.incidentsByGrade.length} grades</StatusBadge>
              </div>

              {data.incidentsByGrade.length === 0 ? (
                <EmptyState
                  title="No grade rollups yet"
                  description="Adjust the filters or wait for discipline events to enter the unified reporting set."
                />
              ) : (
                <div className={tableShellClassName}>
                  <div className="overflow-x-auto">
                    <table className={tableClassName}>
                      <thead>
                        <tr>
                          <th className={tableHeadCellClassName}>Grade</th>
                          <th className={tableHeadCellClassName}>Students</th>
                          <th className={tableHeadCellClassName}>Incidents</th>
                          <th className={tableHeadCellClassName}>Points</th>
                          <th className={tableHeadCellClassName}>Active interventions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-line)]">
                        {data.incidentsByGrade.map((row) => (
                          <tr key={row.grade}>
                            <td className={tableCellClassName}>
                              <Link
                                href={`/students?grade=${encodeURIComponent(row.grade)}`}
                                className="font-semibold text-[var(--color-ink)] hover:text-[var(--color-primary)]"
                              >
                                Grade {row.grade}
                              </Link>
                            </td>
                            <td className={tableCellClassName}>{row.studentCount}</td>
                            <td className={tableCellClassName}>{row.incidentCount}</td>
                            <td className={tableCellClassName}>{row.totalPoints}</td>
                            <td className={tableCellClassName}>{row.activeInterventions}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Panel>

            <Panel className="space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Patterns</p>
                <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Top incident reasons</h2>
              </div>
              {data.topReasons.length === 0 ? (
                <EmptyState
                  title="No reasons in scope"
                  description="Reasons will populate once discipline events fall inside the current reporting frame."
                />
              ) : (
                <div className="space-y-3">
                  {data.topReasons.map((row) => (
                    <Panel key={row.reason} className="border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4 shadow-none">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-semibold text-[var(--color-ink)]">{row.reason}</p>
                          <p className="mt-1 text-sm text-[var(--color-muted)]">{row.incidentCount} incidents</p>
                        </div>
                        <StatusBadge tone="warning">{row.totalPoints} pts</StatusBadge>
                      </div>
                    </Panel>
                  ))}
                </div>
              )}
            </Panel>
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
            <Panel className="space-y-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Roster</p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Students with reportable activity</h2>
                </div>
                <StatusBadge tone="info">{data.studentRows.length} rows</StatusBadge>
              </div>

              {data.studentRows.length === 0 ? (
                <EmptyState
                  title="No student activity in this window"
                  description="Widen the filters or wait for discipline events, interventions, or notifications to accumulate."
                />
              ) : (
                <div className={tableShellClassName}>
                  <div className="overflow-x-auto">
                    <table className={tableClassName}>
                      <thead>
                        <tr>
                          <th className={tableHeadCellClassName}>Student</th>
                          <th className={tableHeadCellClassName}>Incidents</th>
                          <th className={tableHeadCellClassName}>Points</th>
                          <th className={tableHeadCellClassName}>Active interventions</th>
                          <th className={tableHeadCellClassName}>Notifications</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-line)]">
                        {data.studentRows.map((row) => (
                          <tr key={row.studentId}>
                            <td className={tableCellClassName}>
                              <div className="space-y-1">
                                <Link
                                  href={`/students?studentId=${encodeURIComponent(row.studentId)}&grade=${encodeURIComponent(row.grade)}`}
                                  className="font-semibold text-[var(--color-ink)] hover:text-[var(--color-primary)]"
                                >
                                  {row.fullName}
                                </Link>
                                <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">
                                  Grade {row.grade}
                                  {row.latestIncidentAt ? ` • last ${new Date(row.latestIncidentAt).toLocaleDateString()}` : ""}
                                </p>
                              </div>
                            </td>
                            <td className={tableCellClassName}>{row.incidentCount}</td>
                            <td className={tableCellClassName}>{row.totalPoints}</td>
                            <td className={tableCellClassName}>{row.activeInterventions}</td>
                            <td className={tableCellClassName}>{row.notificationCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Panel>

            <Panel className="space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Pipeline context</p>
                <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Status distributions</h2>
              </div>

              <div className="space-y-4">
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-[var(--color-ink)]">Interventions</p>
                  {interventionRows.length === 0 ? (
                    <p className="text-sm text-[var(--color-muted)]">No intervention rows in scope.</p>
                  ) : (
                    interventionRows.map(([status, count]) => (
                      <div key={status} className="flex items-center justify-between gap-3 rounded-[1.1rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] px-4 py-3">
                        <span className="text-sm font-semibold text-[var(--color-ink)]">{status.replace(/_/g, " ")}</span>
                        <StatusBadge tone="info">{count}</StatusBadge>
                      </div>
                    ))
                  )}
                </div>

                <div className="space-y-3">
                  <p className="text-sm font-semibold text-[var(--color-ink)]">Notifications</p>
                  {notificationRows.length === 0 ? (
                    <p className="text-sm text-[var(--color-muted)]">No notification rows in scope.</p>
                  ) : (
                    notificationRows.map(([status, count]) => (
                      <div key={status} className="flex items-center justify-between gap-3 rounded-[1.1rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] px-4 py-3">
                        <span className="text-sm font-semibold text-[var(--color-ink)]">{status.replace(/_/g, " ")}</span>
                        <StatusBadge tone="info">{count}</StatusBadge>
                      </div>
                    ))
                  )}
                </div>

                <Panel className="border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4 shadow-none">
                  <p className="text-sm leading-7 text-[var(--color-muted)]">
                    Reports are built from the unified discipline event layer, with Sycamore as the primary source and approved PDF fallback records filling any remaining gaps.
                  </p>
                </Panel>
              </div>
            </Panel>
          </section>
        </>
      ) : null}
    </div>
  );
}
