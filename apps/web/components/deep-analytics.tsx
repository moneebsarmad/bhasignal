"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, ChevronDown, RefreshCcw, Users } from "lucide-react";

import {
  Button,
  EmptyState,
  Field,
  InlineAlert,
  InsightPanel,
  Input,
  Panel,
  Select,
  SoftPanel,
  StatCard,
  StatusBadge,
  tableCellClassName,
  tableClassName,
  tableHeadCellClassName,
  tableShellClassName
} from "@/components/ui";
import { analyticsStatusRows } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { getDemeritEscalationBand } from "@/lib/demerit-escalation";

interface AnalyticsSnapshot {
  generatedAt: string;
  filters: {
    grade: string;
    from: string;
    to: string;
    sourceType: string;
    student: string;
    violation: string;
    author: string;
    thresholdBand: string;
  };
  comparisonWindow: {
    current: {
      from: string;
      to: string;
      label: string;
    };
    previous: {
      from: string;
      to: string;
      label: string;
    };
    spanDays: number;
    usedDefaultWindow: boolean;
  };
  availableFilters: {
    grades: string[];
    violations: string[];
    authors: string[];
    thresholdBands: Array<{ id: string; label: string }>;
  };
  summary: Array<{
    label: string;
    value: number;
    description: string;
  }>;
  trend: Array<{
    period: string;
    incidentCount: number;
    totalPoints: number;
  }>;
  thresholdPressure: {
    escalatedStudents: number;
    criticalStudents: number;
    crossedIntoHigherBand: number;
    rows: Array<{
      bandId: string;
      label: string;
      shortLabel: string;
      tone: "neutral" | "info" | "success" | "warning" | "danger";
      studentCount: number;
      share: number;
      enteredCount: number;
    }>;
  };
  gradePressureRows: Array<{
    grade: string;
    activeStudents: number;
    studentsInvolved: number;
    incidentCount: number;
    totalPoints: number;
    incidentsPer100: number;
    pointsPer100: number;
    escalatedStudents: number;
    criticalStudents: number;
  }>;
  severityMix: {
    averagePointsPerIncident: number;
    highSeverityShare: number;
    rows: Array<{
      key: "low" | "medium" | "high";
      label: string;
      tone: "neutral" | "info" | "warning" | "danger";
      incidentCount: number;
      totalPoints: number;
      incidentShare: number;
      pointShare: number;
    }>;
  };
  repeatIncident: {
    studentsWithIncidents: number;
    repeat14Count: number;
    repeat14Rate: number;
    repeat30Count: number;
    repeat30Rate: number;
    sameBehavior30Count: number;
    sameBehavior30Rate: number;
  };
  concentration: {
    studentsWithPoints: number;
    topDecileStudents: number;
    topDecileShare: number;
    topThreeShare: number;
    medianPoints: number | null;
    profile: string;
  };
  behaviorShiftRows: Array<{
    behavior: string;
    currentIncidents: number;
    previousIncidents: number;
    deltaIncidents: number;
    deltaPercent: number | null;
    currentStudents: number;
    currentPoints: number;
    trend: "up" | "down" | "flat";
  }>;
  hotspotTiming: {
    timedIncidentCount: number;
    timeCoverageRate: number;
    rows: Array<{
      label: string;
      weekday: string;
      timeBlock: string;
      incidentCount: number;
      totalPoints: number;
    }>;
  };
  interventionHealth: {
    activeCount: number;
    overdueCount: number;
    completedCount: number;
    completedOnTimeCount: number;
    completedOnTimeRate: number;
    medianCompletedLateDays: number | null;
    medianActiveOverdueDays: number | null;
  };
  postIntervention: {
    completedInterventions: number;
    rows: Array<{
      days: 14 | 30 | 45;
      reentryCount: number;
      reentryRate: number;
    }>;
  };
  narrativeThemeRows: Array<{
    theme: string;
    incidentCount: number;
    uniqueStudents: number;
    share: number;
  }>;
  studentRows: Array<{
    studentId: string;
    fullName: string;
    grade: string;
    incidentCount: number;
    totalPoints: number;
    currentTotalPoints: number;
    currentBandId: string;
    currentBandLabel: string;
    latestIncidentAt: string | null;
    activeInterventions: number;
    queuedNotifications: number;
    failedNotifications: number;
  }>;
  interventionStatus: Record<string, number>;
  notificationStatus: Record<string, number>;
  narrative: string;
}

const DEFAULT_SOURCE_TYPE = "sycamore_api";

function compareGradesAscending(left: string, right: string) {
  const leftGrade = Number(left);
  const rightGrade = Number(right);

  if (Number.isFinite(leftGrade) && Number.isFinite(rightGrade)) {
    return leftGrade - rightGrade;
  }

  return left.localeCompare(right, undefined, { numeric: true });
}

function toneForStatus(status: string): "neutral" | "info" | "success" | "warning" | "danger" {
  if (status === "completed" || status === "sent") {
    return "success";
  }
  if (status === "in_progress") {
    return "info";
  }
  if (status === "queued" || status === "open") {
    return "warning";
  }
  if (status === "failed" || status === "overdue") {
    return "danger";
  }
  return "neutral";
}

function toneForTrend(trend: "up" | "down" | "flat"): "neutral" | "success" | "danger" {
  if (trend === "up") {
    return "danger";
  }
  if (trend === "down") {
    return "success";
  }
  return "neutral";
}

function formatPercent(value: number): string {
  return `${value.toFixed(Number.isInteger(value) ? 0 : 1)}%`;
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

function formatNullableDays(value: number | null): string {
  if (value === null) {
    return "n/a";
  }
  return `${value.toFixed(Number.isInteger(value) ? 0 : 1)}d`;
}

function formatDelta(row: AnalyticsSnapshot["behaviorShiftRows"][number]): string {
  if (row.deltaPercent === null) {
    return "No change";
  }
  if (row.previousIncidents === 0 && row.currentIncidents > 0) {
    return "New in current window";
  }
  const sign = row.deltaIncidents > 0 ? "+" : "";
  return `${sign}${row.deltaIncidents} incidents (${sign}${row.deltaPercent}%)`;
}

function summaryValue(metric: AnalyticsSnapshot["summary"][number]): string {
  return metric.label.includes("%") ? formatPercent(metric.value) : formatNumber(metric.value);
}

export function DeepAnalytics({ embedded = false }: { embedded?: boolean }) {
  const [grade, setGrade] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sourceType, setSourceType] = useState(DEFAULT_SOURCE_TYPE);
  const [student, setStudent] = useState("");
  const [violation, setViolation] = useState("");
  const [author, setAuthor] = useState("");
  const [thresholdBand, setThresholdBand] = useState("");
  const [data, setData] = useState<AnalyticsSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filtersRef = useRef({
    grade: "",
    from: "",
    to: "",
    sourceType: DEFAULT_SOURCE_TYPE,
    student: "",
    violation: "",
    author: "",
    thresholdBand: ""
  });
  filtersRef.current = {
    grade,
    from,
    to,
    sourceType,
    student,
    violation,
    author,
    thresholdBand
  };

  const loadSnapshot = useCallback(async (nextFilters = filtersRef.current) => {
    setIsLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (nextFilters.grade.trim()) {
      params.set("grade", nextFilters.grade.trim());
    }
    if (nextFilters.from) {
      params.set("from", nextFilters.from);
    }
    if (nextFilters.to) {
      params.set("to", nextFilters.to);
    }
    if (nextFilters.sourceType) {
      params.set("sourceType", nextFilters.sourceType);
    }
    if (nextFilters.student.trim()) {
      params.set("student", nextFilters.student.trim());
    }
    if (nextFilters.violation) {
      params.set("violation", nextFilters.violation);
    }
    if (nextFilters.author) {
      params.set("author", nextFilters.author);
    }
    if (nextFilters.thresholdBand) {
      params.set("thresholdBand", nextFilters.thresholdBand);
    }

    const response = await fetch(`/api/analytics/summary?${params.toString()}`, { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as AnalyticsSnapshot | { error?: string } | null;
    if (!response.ok) {
      setError((body as { error?: string } | null)?.error || "Failed to load deep analytics.");
      setIsLoading(false);
      return;
    }

    const snapshot = body as AnalyticsSnapshot;
    setData(snapshot);
    setGrade(snapshot.filters.grade);
    setFrom(snapshot.filters.from);
    setTo(snapshot.filters.to);
    setSourceType(snapshot.filters.sourceType || DEFAULT_SOURCE_TYPE);
    setStudent(snapshot.filters.student);
    setViolation(snapshot.filters.violation);
    setAuthor(snapshot.filters.author);
    setThresholdBand(snapshot.filters.thresholdBand);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  const sortedGradePressureRows = useMemo(
    () =>
      data
        ? [...data.gradePressureRows].sort((left, right) => compareGradesAscending(left.grade, right.grade))
        : [],
    [data]
  );

  function onApplyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadSnapshot({
      grade,
      from,
      to,
      sourceType,
      student,
      violation,
      author,
      thresholdBand
    });
  }

  const trendMax = useMemo(
    () => Math.max(...(data?.trend.map((row) => row.incidentCount) ?? [1]), 1),
    [data]
  );
  const interventionRows = useMemo(() => analyticsStatusRows(data?.interventionStatus ?? {}), [data]);
  const notificationRows = useMemo(() => analyticsStatusRows(data?.notificationStatus ?? {}), [data]);

  return (
    <div className="space-y-6">
      <Panel className={cn("space-y-5", embedded ? "border-white/70 bg-white/90" : "")}>
        <div>
          <h2 className="font-display text-2xl text-[var(--color-ink)]">Filters</h2>
        </div>

        <form onSubmit={onApplyFilters} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Grade">
            <Select value={grade} onChange={(event) => setGrade(event.currentTarget.value)}>
              <option value="">All grades</option>
              {(data?.availableFilters.grades ?? []).map((option) => (
                <option key={option} value={option}>
                  Grade {option}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From" hint="Leave blank to use the latest recommended window.">
            <Input type="date" value={from} onChange={(event) => setFrom(event.currentTarget.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(event) => setTo(event.currentTarget.value)} />
          </Field>
          <Field label="Dataset mode">
            <Select value={sourceType} onChange={(event) => setSourceType(event.currentTarget.value)}>
              <option value="sycamore_api">Sycamore primary</option>
              <option value="manual_pdf">PDF exception mode</option>
            </Select>
          </Field>
          <Field label="Student">
            <Input
              value={student}
              onChange={(event) => setStudent(event.currentTarget.value)}
              placeholder="Name, ID, or external ID"
            />
          </Field>
          <Field label="Violation">
            <Select value={violation} onChange={(event) => setViolation(event.currentTarget.value)}>
              <option value="">All violations</option>
              {(data?.availableFilters.violations ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Author">
            <Select value={author} onChange={(event) => setAuthor(event.currentTarget.value)}>
              <option value="">All staff</option>
              {(data?.availableFilters.authors ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Live escalation band">
            <Select value={thresholdBand} onChange={(event) => setThresholdBand(event.currentTarget.value)}>
              <option value="">All bands</option>
              {(data?.availableFilters.thresholdBands ?? []).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end gap-3 xl:col-span-4">
            <Button type="submit" variant="primary" disabled={isLoading}>
              {isLoading ? "Applying..." : "Apply filters"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => void loadSnapshot()} disabled={isLoading}>
              <RefreshCcw className={cn("h-4 w-4", isLoading ? "animate-spin" : "")} />
              Refresh
            </Button>
          </div>
        </form>
      </Panel>

      {error ? (
        <InlineAlert tone="danger" title="Deep analytics could not be loaded.">
          {error}
        </InlineAlert>
      ) : null}

      {data ? (
        <>
          <InsightPanel
            eyebrow="Decision readout"
            title="What the discipline data is saying"
            description={data.narrative}
          >
            <div className="flex flex-wrap gap-3">
              <StatusBadge tone="info">Generated {new Date(data.generatedAt).toLocaleString()}</StatusBadge>
              <StatusBadge tone="neutral">Current {data.comparisonWindow.current.label}</StatusBadge>
              <StatusBadge tone="neutral">Prior {data.comparisonWindow.previous.label}</StatusBadge>
              {data.comparisonWindow.usedDefaultWindow ? (
                <StatusBadge tone="warning">Latest recommended window</StatusBadge>
              ) : null}
              {data.filters.grade ? <StatusBadge tone="neutral">Grade {data.filters.grade}</StatusBadge> : null}
              {data.filters.thresholdBand ? (
                <StatusBadge tone="warning">
                  {data.availableFilters.thresholdBands.find((band) => band.id === data.filters.thresholdBand)?.label ??
                    data.filters.thresholdBand}
                </StatusBadge>
              ) : null}
            </div>
          </InsightPanel>

          <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-6">
            {data.summary.map((metric) => (
              <StatCard
                key={metric.label}
                label={metric.label}
                value={summaryValue(metric)}
                description={metric.description}
                icon={metric.label.includes("Students") ? Users : BarChart3}
              />
            ))}
          </section>

          <section className="grid gap-5 xl:grid-cols-[1fr_1.1fr]">
            <Panel className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                    Threshold pressure
                  </p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Live band distribution</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge tone="warning">{data.thresholdPressure.escalatedStudents} live 10+</StatusBadge>
                  <StatusBadge tone="danger">{data.thresholdPressure.criticalStudents} live 35+</StatusBadge>
                  <StatusBadge tone="info">{data.thresholdPressure.crossedIntoHigherBand} entered higher band</StatusBadge>
                </div>
              </div>

              <div className="space-y-3">
                {data.thresholdPressure.rows.map((row) => (
                  <div key={row.bandId} className="space-y-2 rounded-[1.25rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <StatusBadge tone={row.tone}>{row.shortLabel}</StatusBadge>
                        <div>
                          <p className="font-semibold text-[var(--color-ink)]">{row.label}</p>
                          <p className="text-sm text-[var(--color-muted)]">
                            {row.studentCount} students • {formatPercent(row.share)} of live scope
                          </p>
                        </div>
                      </div>
                      <p className="text-sm font-semibold text-[var(--color-ink)]">
                        {row.enteredCount > 0 ? `+${row.enteredCount} this window` : "No new entries"}
                      </p>
                    </div>
                    <div className="h-2 rounded-full bg-white">
                      <div className="h-2 rounded-full bg-[var(--color-primary)]" style={{ width: `${Math.max(row.share, row.studentCount > 0 ? 8 : 0)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel className="space-y-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                    Grade pressure
                  </p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Rates by grade</h2>
                </div>
                <StatusBadge tone="info">{data.gradePressureRows.length} grades</StatusBadge>
              </div>

              {data.gradePressureRows.length === 0 ? (
                <EmptyState
                  title="No grade pressure data"
                  description="Adjust the filters to restore grade-level pressure rates."
                />
              ) : (
                <div className={tableShellClassName}>
                  <div className="overflow-x-auto">
                    <table className={tableClassName}>
                      <thead>
                        <tr>
                          <th className={tableHeadCellClassName}>Grade</th>
                          <th className={tableHeadCellClassName}>Active</th>
                          <th className={tableHeadCellClassName}>Students</th>
                          <th className={tableHeadCellClassName}>Incidents /100</th>
                          <th className={tableHeadCellClassName}>Points /100</th>
                          <th className={tableHeadCellClassName}>Live 10+</th>
                          <th className={tableHeadCellClassName}>Live 35+</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-line)]">
                        {sortedGradePressureRows.map((row) => (
                          <tr key={row.grade}>
                            <td className={cn(tableCellClassName, "whitespace-nowrap")}>Grade {row.grade}</td>
                            <td className={tableCellClassName}>{formatNumber(row.activeStudents)}</td>
                            <td className={tableCellClassName}>{formatNumber(row.studentsInvolved)}</td>
                            <td className={tableCellClassName}>{row.incidentsPer100}</td>
                            <td className={tableCellClassName}>{row.pointsPer100}</td>
                            <td className={tableCellClassName}>{formatNumber(row.escalatedStudents)}</td>
                            <td className={tableCellClassName}>{formatNumber(row.criticalStudents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Panel>
          </section>

          <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
            <Panel className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                    Severity mix
                  </p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Incident intensity</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge tone="info">
                    Avg {data.severityMix.averagePointsPerIncident} pts / incident
                  </StatusBadge>
                  <StatusBadge tone="danger">
                    {formatPercent(data.severityMix.highSeverityShare)} high severity
                  </StatusBadge>
                </div>
              </div>

              <div className="space-y-3">
                {data.severityMix.rows.map((row) => (
                  <SoftPanel key={row.key} className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-[var(--color-ink)]">{row.label}</p>
                        <p className="text-sm text-[var(--color-muted)]">
                          {row.incidentCount} incidents • {row.totalPoints} points
                        </p>
                      </div>
                      <StatusBadge tone={row.tone}>{formatPercent(row.incidentShare)} of incidents</StatusBadge>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3 text-sm text-[var(--color-muted)]">
                        <span>Point share</span>
                        <span>{formatPercent(row.pointShare)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-white">
                        <div className="h-2 rounded-full bg-[var(--color-primary)]" style={{ width: `${Math.max(row.pointShare, row.totalPoints > 0 ? 8 : 0)}%` }} />
                      </div>
                    </div>
                  </SoftPanel>
                ))}
              </div>
            </Panel>

            <Panel className="space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                  Recurrence and concentration
                </p>
                <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Where the pressure sits</h2>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <SoftPanel className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Repeat 14d</p>
                  <p className="font-display text-3xl text-[var(--color-ink)]">
                    {formatPercent(data.repeatIncident.repeat14Rate)}
                  </p>
                  <p className="text-sm text-[var(--color-muted)]">
                    {data.repeatIncident.repeat14Count} of {data.repeatIncident.studentsWithIncidents} students had a prior incident in the last 14 days.
                  </p>
                </SoftPanel>
                <SoftPanel className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Repeat 30d</p>
                  <p className="font-display text-3xl text-[var(--color-ink)]">
                    {formatPercent(data.repeatIncident.repeat30Rate)}
                  </p>
                  <p className="text-sm text-[var(--color-muted)]">
                    {data.repeatIncident.repeat30Count} students carried a 30-day recurrence pattern.
                  </p>
                </SoftPanel>
                <SoftPanel className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Same pattern</p>
                  <p className="font-display text-3xl text-[var(--color-ink)]">
                    {formatPercent(data.repeatIncident.sameBehavior30Rate)}
                  </p>
                  <p className="text-sm text-[var(--color-muted)]">
                    {data.repeatIncident.sameBehavior30Count} students repeated the same behavior family inside 30 days.
                  </p>
                </SoftPanel>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <SoftPanel className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Top decile share</p>
                  <p className="font-display text-3xl text-[var(--color-ink)]">
                    {formatPercent(data.concentration.topDecileShare)}
                  </p>
                  <p className="text-sm text-[var(--color-muted)]">
                    Top {data.concentration.topDecileStudents} students account for this share of window points.
                  </p>
                </SoftPanel>
                <SoftPanel className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Concentration profile</p>
                  <p className="font-display text-3xl text-[var(--color-ink)]">{data.concentration.profile}</p>
                  <p className="text-sm text-[var(--color-muted)]">
                    Top three students hold {formatPercent(data.concentration.topThreeShare)} of points. Median student load is{" "}
                    {data.concentration.medianPoints ?? 0} points.
                  </p>
                </SoftPanel>
              </div>
            </Panel>
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
            <Panel className="space-y-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                    Momentum
                  </p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Trend across the active window</h2>
                </div>
                <StatusBadge tone="info">{data.trend.length} periods</StatusBadge>
              </div>

              {data.trend.length === 0 ? (
                <EmptyState title="No trend data" description="The current filters returned no incidents to trend." />
              ) : (
                <div className="space-y-3">
                  {data.trend.map((row) => (
                    <div key={row.period} className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-[var(--color-ink)]">{row.period}</p>
                        <p className="text-sm text-[var(--color-muted)]">
                          {row.incidentCount} incidents • {row.totalPoints} pts
                        </p>
                      </div>
                      <div className="h-2 rounded-full bg-[var(--color-soft-surface)]">
                        <div
                          className="h-2 rounded-full bg-[linear-gradient(90deg,var(--color-primary),rgba(17,94,89,0.45))]"
                          style={{ width: `${Math.max((row.incidentCount / trendMax) * 100, row.incidentCount > 0 ? 8 : 0)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel className="space-y-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                    Driver shift
                  </p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Behavior movement</h2>
                </div>
                <StatusBadge tone="info">Current vs prior</StatusBadge>
              </div>

              {data.behaviorShiftRows.length === 0 ? (
                <EmptyState
                  title="No behavior shifts yet"
                  description="Once incidents are present in the current window, rising and easing behavior families will appear here."
                />
              ) : (
                <div className="space-y-3">
                  {data.behaviorShiftRows.map((row) => (
                    <SoftPanel key={row.behavior} className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-[var(--color-ink)]">{row.behavior}</p>
                          <p className="text-sm text-[var(--color-muted)]">
                            {row.currentIncidents} current • {row.previousIncidents} prior • {row.currentStudents} students
                          </p>
                        </div>
                        <StatusBadge tone={toneForTrend(row.trend)}>{formatDelta(row)}</StatusBadge>
                      </div>
                      <p className="text-sm text-[var(--color-muted)]">{row.currentPoints} points in the current window.</p>
                    </SoftPanel>
                  ))}
                </div>
              )}
            </Panel>
          </section>

          <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
            <Panel className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                    Timing hotspots
                  </p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">When incidents cluster</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge tone="info">{formatPercent(data.hotspotTiming.timeCoverageRate)} time coverage</StatusBadge>
                  <StatusBadge tone="neutral">{data.hotspotTiming.timedIncidentCount} timestamped incidents</StatusBadge>
                </div>
              </div>

              {data.hotspotTiming.rows.length === 0 ? (
                <EmptyState
                  title="No timing hotspots"
                  description="The current window does not contain enough timestamped incidents to surface time-of-day patterns."
                />
              ) : (
                <div className="space-y-3">
                  {data.hotspotTiming.rows.map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-3 rounded-[1.25rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] px-4 py-3">
                      <div>
                        <p className="font-semibold text-[var(--color-ink)]">{row.label}</p>
                        <p className="text-sm text-[var(--color-muted)]">
                          {row.incidentCount} incidents • {row.totalPoints} points
                        </p>
                      </div>
                      <StatusBadge tone="warning">{row.weekday}</StatusBadge>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel className="space-y-6">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                    Follow-through health
                  </p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Intervention reliability</h2>
                </div>
                <StatusBadge tone="info">Window close posture</StatusBadge>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <SoftPanel className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Active</p>
                  <p className="font-display text-3xl text-[var(--color-ink)]">{data.interventionHealth.activeCount}</p>
                  <p className="text-sm text-[var(--color-muted)]">Open, in-progress, or overdue interventions in scope.</p>
                </SoftPanel>
                <SoftPanel className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Overdue</p>
                  <p className="font-display text-3xl text-[var(--color-ink)]">{data.interventionHealth.overdueCount}</p>
                  <p className="text-sm text-[var(--color-muted)]">
                    Median overdue age {formatNullableDays(data.interventionHealth.medianActiveOverdueDays)}.
                  </p>
                </SoftPanel>
                <SoftPanel className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">On-time rate</p>
                  <p className="font-display text-3xl text-[var(--color-ink)]">
                    {formatPercent(data.interventionHealth.completedOnTimeRate)}
                  </p>
                  <p className="text-sm text-[var(--color-muted)]">
                    {data.interventionHealth.completedOnTimeCount} of {data.interventionHealth.completedCount} completed on time.
                  </p>
                </SoftPanel>
                <SoftPanel className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Late close</p>
                  <p className="font-display text-3xl text-[var(--color-ink)]">
                    {formatNullableDays(data.interventionHealth.medianCompletedLateDays)}
                  </p>
                  <p className="text-sm text-[var(--color-muted)]">Median late days among completed interventions that missed SLA.</p>
                </SoftPanel>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-3">
                  <p className="font-semibold text-[var(--color-ink)]">Interventions</p>
                  {interventionRows.length === 0 ? (
                    <p className="text-sm text-[var(--color-muted)]">No intervention statuses in this window.</p>
                  ) : (
                    interventionRows.map((row) => (
                      <div key={`intervention-${row.key}`} className="flex items-center justify-between gap-3">
                        <StatusBadge tone={toneForStatus(row.key)}>{row.label}</StatusBadge>
                        <span className="text-sm font-semibold text-[var(--color-ink)]">{row.count}</span>
                      </div>
                    ))
                  )}
                </div>
                <div className="space-y-3">
                  <p className="font-semibold text-[var(--color-ink)]">Notifications</p>
                  {notificationRows.length === 0 ? (
                    <p className="text-sm text-[var(--color-muted)]">No notification statuses in this window.</p>
                  ) : (
                    notificationRows.map((row) => (
                      <div key={`notification-${row.key}`} className="flex items-center justify-between gap-3">
                        <StatusBadge tone={toneForStatus(row.key)}>{row.label}</StatusBadge>
                        <span className="text-sm font-semibold text-[var(--color-ink)]">{row.count}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </Panel>
          </section>

          <section className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
            <Panel className="space-y-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                    Re-entry risk
                  </p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Post-intervention return rate</h2>
                </div>
                <StatusBadge tone="info">{data.postIntervention.completedInterventions} completed</StatusBadge>
              </div>

              {data.postIntervention.completedInterventions === 0 ? (
                <EmptyState
                  title="No completed interventions"
                  description="Once interventions are completed inside the active window, return-rate tracking will appear here."
                />
              ) : (
                <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-1">
                  {data.postIntervention.rows.map((row) => (
                    <SoftPanel key={row.days} className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                        Re-entry {row.days}d
                      </p>
                      <p className="font-display text-3xl text-[var(--color-ink)]">{formatPercent(row.reentryRate)}</p>
                      <p className="text-sm text-[var(--color-muted)]">
                        {row.reentryCount} of {data.postIntervention.completedInterventions} completed interventions had a new incident inside {row.days} days.
                      </p>
                    </SoftPanel>
                  ))}
                </div>
              )}
            </Panel>

            <Panel className="space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                    Narrative themes
                  </p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Comment-level signals</h2>
                </div>
                <StatusBadge tone="warning">Heuristic theme tagging</StatusBadge>
              </div>

              {data.narrativeThemeRows.length === 0 ? (
                <EmptyState
                  title="No narrative themes"
                  description="Once the current window has narrative-rich incidents, qualitative theme signals will appear here."
                />
              ) : (
                <div className="space-y-3">
                  {data.narrativeThemeRows.map((row) => (
                    <SoftPanel key={row.theme} className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-[var(--color-ink)]">{row.theme}</p>
                          <p className="text-sm text-[var(--color-muted)]">
                            {row.incidentCount} incidents across {row.uniqueStudents} students
                          </p>
                        </div>
                        <StatusBadge tone="info">{formatPercent(row.share)}</StatusBadge>
                      </div>
                    </SoftPanel>
                  ))}
                </div>
              )}
            </Panel>
          </section>

          <details className="group">
            <summary className="list-none cursor-pointer">
              <Panel className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                    Student list
                  </p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Window drilldown</h2>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge tone="warning">{data.studentRows.length} rows</StatusBadge>
                  <ChevronDown className="h-5 w-5 text-[var(--color-muted)] transition group-open:rotate-180" />
                </div>
              </Panel>
            </summary>

            <Panel className="mt-4 space-y-5">
              {data.studentRows.length === 0 ? (
                <EmptyState
                  title="No students in window"
                  description="Adjust the deep analytics filters to bring matching students back into view."
                />
              ) : (
                <div className={tableShellClassName}>
                  <div className="overflow-x-auto">
                    <table className={tableClassName}>
                      <thead>
                        <tr>
                          <th className={tableHeadCellClassName}>Student</th>
                          <th className={tableHeadCellClassName}>Window incidents</th>
                          <th className={tableHeadCellClassName}>Window points</th>
                          <th className={tableHeadCellClassName}>Live total</th>
                          <th className={tableHeadCellClassName}>Live band</th>
                          <th className={tableHeadCellClassName}>Follow-through</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-line)]">
                        {data.studentRows.map((row) => {
                          const band = getDemeritEscalationBand(row.currentTotalPoints);
                          return (
                            <tr key={row.studentId}>
                              <td className={tableCellClassName}>
                                <div className="space-y-1">
                                  <p className="font-semibold text-[var(--color-ink)]">{row.fullName}</p>
                                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">
                                    Grade {row.grade} • {row.studentId}
                                  </p>
                                </div>
                              </td>
                              <td className={tableCellClassName}>{row.incidentCount}</td>
                              <td className={tableCellClassName}>{row.totalPoints}</td>
                              <td className={tableCellClassName}>{row.currentTotalPoints}</td>
                              <td className={tableCellClassName}>
                                <StatusBadge tone={band.tone}>{row.currentBandLabel}</StatusBadge>
                              </td>
                              <td className={tableCellClassName}>
                                <div className="space-y-1 text-sm text-[var(--color-muted)]">
                                  <p>{row.activeInterventions} active interventions</p>
                                  <p>{row.queuedNotifications} queued • {row.failedNotifications} failed notifications</p>
                                  <p>
                                    {row.latestIncidentAt
                                      ? `Latest incident ${new Date(row.latestIncidentAt).toLocaleDateString()}`
                                      : "No recent incident date"}
                                  </p>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Panel>
          </details>
        </>
      ) : null}
    </div>
  );
}
