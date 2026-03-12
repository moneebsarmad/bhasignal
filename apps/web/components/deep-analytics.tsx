"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, RefreshCcw, Users } from "lucide-react";

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
  gradeRows: Array<{
    grade: string;
    studentCount: number;
    incidentCount: number;
    totalPoints: number;
    escalatedCount: number;
    criticalCount: number;
  }>;
  violationRows: Array<{
    violation: string;
    incidentCount: number;
    totalPoints: number;
    uniqueStudents: number;
  }>;
  authorRows: Array<{
    author: string;
    incidentCount: number;
    totalPoints: number;
    uniqueStudents: number;
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
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
              Stored data filters
            </p>
            <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Deep analytics studio</h2>
          </div>
          <p className="max-w-2xl text-sm leading-7 text-[var(--color-muted)]">
            Use stored discipline data to compare grades, behaviors, staff patterns, and current escalation pressure.
            Student risk bands remain grounded in live cumulative points for the selected source mode.
          </p>
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
          <Field label="From">
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
          <Field label="Current escalation band">
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
            title="What the stored discipline data is saying"
            description={data.narrative}
          >
            <div className="flex flex-wrap gap-3">
              <StatusBadge tone="info">Generated {new Date(data.generatedAt).toLocaleString()}</StatusBadge>
              {data.filters.grade ? <StatusBadge tone="neutral">Grade {data.filters.grade}</StatusBadge> : null}
              {data.filters.from ? <StatusBadge tone="neutral">From {data.filters.from}</StatusBadge> : null}
              {data.filters.to ? <StatusBadge tone="neutral">To {data.filters.to}</StatusBadge> : null}
              {data.filters.thresholdBand ? (
                <StatusBadge tone="warning">
                  {data.availableFilters.thresholdBands.find((band) => band.id === data.filters.thresholdBand)?.label ??
                    data.filters.thresholdBand}
                </StatusBadge>
              ) : null}
            </div>
          </InsightPanel>

          <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
            {data.summary.map((metric) => (
              <StatCard
                key={metric.label}
                label={metric.label}
                value={metric.value}
                description={metric.description}
                icon={metric.label.includes("Students") ? Users : BarChart3}
              />
            ))}
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
            <Panel className="space-y-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                    Time trend
                  </p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Incident momentum over time</h2>
                </div>
                <StatusBadge tone="info">{data.trend.length} periods</StatusBadge>
              </div>

              {data.trend.length === 0 ? (
                <EmptyState
                  title="No trend data"
                  description="The active filters did not return any stored incidents to trend."
                />
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

            <Panel className="space-y-6">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                    Workflow posture
                  </p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Current follow-through status</h2>
                </div>
                <StatusBadge tone="info">Live counts</StatusBadge>
              </div>

              {[
                { title: "Interventions", rows: interventionRows },
                { title: "Notifications", rows: notificationRows }
              ].map((group) => (
                <div key={group.title} className="space-y-3">
                  <p className="font-semibold text-[var(--color-ink)]">{group.title}</p>
                  {group.rows.length === 0 ? (
                    <p className="text-sm text-[var(--color-muted)]">No current status counts for this slice.</p>
                  ) : (
                    group.rows.map((row) => (
                      <div key={`${group.title}-${row.key}`} className="flex items-center justify-between gap-3">
                        <StatusBadge tone={toneForStatus(row.key)}>{row.label}</StatusBadge>
                        <span className="text-sm font-semibold text-[var(--color-ink)]">{row.count}</span>
                      </div>
                    ))
                  )}
                </div>
              ))}
            </Panel>
          </section>

          <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
            <Panel className="space-y-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                    Cohorts
                  </p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Grade comparison</h2>
                </div>
                <StatusBadge tone="info">{data.gradeRows.length} grades</StatusBadge>
              </div>

              {data.gradeRows.length === 0 ? (
                <EmptyState
                  title="No grades returned"
                  description="Adjust the filters to restore stored discipline data for grade comparisons."
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
                          <th className={tableHeadCellClassName}>10+ students</th>
                          <th className={tableHeadCellClassName}>35+ students</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-line)]">
                        {data.gradeRows.map((row) => (
                          <tr key={row.grade}>
                            <td className={tableCellClassName}>Grade {row.grade}</td>
                            <td className={tableCellClassName}>{row.studentCount}</td>
                            <td className={tableCellClassName}>{row.incidentCount}</td>
                            <td className={tableCellClassName}>{row.totalPoints}</td>
                            <td className={tableCellClassName}>{row.escalatedCount}</td>
                            <td className={tableCellClassName}>{row.criticalCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Panel>

            <Panel className="space-y-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                    Behavior drivers
                  </p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Top violations</h2>
                </div>
                <StatusBadge tone="info">{data.violationRows.length} rows</StatusBadge>
              </div>

              {data.violationRows.length === 0 ? (
                <EmptyState
                  title="No violations returned"
                  description="Stored violations will appear once the active filters include matching records."
                />
              ) : (
                <div className="space-y-3">
                  {data.violationRows.map((row) => (
                    <SoftPanel key={row.violation} className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-[var(--color-ink)]">{row.violation}</p>
                          <p className="text-sm text-[var(--color-muted)]">
                            {row.incidentCount} incidents across {row.uniqueStudents} students
                          </p>
                        </div>
                        <StatusBadge tone="warning">{row.totalPoints} pts</StatusBadge>
                      </div>
                    </SoftPanel>
                  ))}
                </div>
              )}
            </Panel>
          </section>

          <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
            <Panel className="space-y-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                    Staff pattern
                  </p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Author concentration</h2>
                </div>
                <StatusBadge tone="info">{data.authorRows.length} staff</StatusBadge>
              </div>

              {data.authorRows.length === 0 ? (
                <EmptyState
                  title="No staff rows returned"
                  description="Stored authors will appear once the active filters include records with authors."
                />
              ) : (
                <div className="space-y-3">
                  {data.authorRows.map((row) => (
                    <div key={row.author} className="flex items-center justify-between gap-3 rounded-[1.25rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] px-4 py-3">
                      <div>
                        <p className="font-semibold text-[var(--color-ink)]">{row.author}</p>
                        <p className="text-sm text-[var(--color-muted)]">
                          {row.incidentCount} incidents • {row.uniqueStudents} students
                        </p>
                      </div>
                      <StatusBadge tone="info">{row.totalPoints} pts</StatusBadge>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel className="space-y-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                    Student drilldown
                  </p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Students in the current slice</h2>
                </div>
                <StatusBadge tone="warning">{data.studentRows.length} rows</StatusBadge>
              </div>

              {data.studentRows.length === 0 ? (
                <EmptyState
                  title="No students in this slice"
                  description="Adjust the deep analytics filters to bring matching students back into view."
                />
              ) : (
                <div className={tableShellClassName}>
                  <div className="overflow-x-auto">
                    <table className={tableClassName}>
                      <thead>
                        <tr>
                          <th className={tableHeadCellClassName}>Student</th>
                          <th className={tableHeadCellClassName}>Slice incidents</th>
                          <th className={tableHeadCellClassName}>Slice points</th>
                          <th className={tableHeadCellClassName}>Current total</th>
                          <th className={tableHeadCellClassName}>Current band</th>
                          <th className={tableHeadCellClassName}>Follow-through</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-line)]">
                        {data.studentRows.map((row) => {
                          const band = getDemeritEscalationBand(row.currentTotalPoints)
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
                          )
                        })}
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
  )
}
