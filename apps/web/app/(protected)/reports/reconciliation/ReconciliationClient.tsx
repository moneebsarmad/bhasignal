"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCcw } from "lucide-react";

import {
  Button,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  PageHeader,
  Panel,
  StatusBadge,
  Textarea,
  buttonStyles,
  tableCellClassName,
  tableClassName,
  tableHeadCellClassName,
  tableShellClassName
} from "@/components/ui";
import { cn } from "@/lib/cn";

interface ReconciliationReport {
  generatedAt: string;
  window: {
    startDate: string;
    endDate: string;
  };
  requestedStudents: string[];
  summary: {
    studentsRequested: number;
    studentsWithAnyRecords: number;
    sycamoreRecords: number;
    pdfRecords: number;
    matched: number;
    fieldMismatch: number;
    sycamoreOnly: number;
    pdfOnly: number;
  };
  students: Array<{
    requestedName: string;
    notes: string[];
    pdfResolvedStudents: Array<{
      id: string;
      fullName: string;
      grade: string;
    }>;
    sycamoreResolvedStudents: Array<{
      studentId: string;
      studentName: string | null;
      grade: string | null;
    }>;
    counts: {
      sycamore: number;
      pdf: number;
      matched: number;
      fieldMismatch: number;
      sycamoreOnly: number;
      pdfOnly: number;
    };
    rows: Array<{
      status: "matched" | "field_mismatch" | "sycamore_only" | "pdf_only";
      matchKey: string;
      sycamore: {
        sourceRecordId: string;
        studentId: string;
        studentName: string | null;
        grade: string | null;
        incidentDate: string | null;
        points: number;
        level: number | null;
        violation: string | null;
        violationRaw: string | null;
        resolution: string | null;
        authorName: string | null;
      } | null;
      pdf: {
        sourceRecordId: string;
        studentId: string;
        studentName: string | null;
        grade: string | null;
        incidentDate: string | null;
        points: number;
        level: number | null;
        violation: string | null;
        violationRaw: string | null;
        resolution: string | null;
        authorName: string | null;
      } | null;
      diffs: Array<{
        field: string;
        label: string;
        sycamoreValue: string | number | null;
        pdfValue: string | number | null;
      }>;
    }>;
  }>;
}

function buildQuery(filters: {
  studentNamesText: string;
  startDate: string;
  endDate: string;
}): string {
  const params = new URLSearchParams();
  if (filters.studentNamesText.trim()) {
    params.set("studentNames", filters.studentNamesText.trim());
  }
  if (filters.startDate) {
    params.set("startDate", filters.startDate);
  }
  if (filters.endDate) {
    params.set("endDate", filters.endDate);
  }
  return params.toString();
}

function statusTone(status: ReconciliationReport["students"][number]["rows"][number]["status"]) {
  if (status === "matched") {
    return "success" as const;
  }
  if (status === "field_mismatch") {
    return "warning" as const;
  }
  return "info" as const;
}

function statusLabel(status: ReconciliationReport["students"][number]["rows"][number]["status"]) {
  if (status === "field_mismatch") {
    return "field mismatch";
  }
  if (status === "sycamore_only") {
    return "Sycamore only";
  }
  if (status === "pdf_only") {
    return "PDF only";
  }
  return "matched";
}

function formatStudentList(report: ReconciliationReport["students"][number]) {
  return report.sycamoreResolvedStudents
    .map((student) => student.studentName ?? student.studentId)
    .filter(Boolean)
    .join(", ");
}

function recordSummary(record: ReconciliationReport["students"][number]["rows"][number]["sycamore"] | ReconciliationReport["students"][number]["rows"][number]["pdf"]) {
  if (!record) {
    return null;
  }

  return [
    record.level !== null ? `Level ${record.level}` : null,
    record.violation ?? record.violationRaw,
    record.authorName ? `Author: ${record.authorName}` : null,
    record.resolution ? `Resolution: ${record.resolution}` : null
  ]
    .filter(Boolean)
    .join(" | ");
}

export function ReconciliationClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [studentNamesText, setStudentNamesText] = useState(() => searchParams.get("studentNames") || "");
  const [startDate, setStartDate] = useState(() => searchParams.get("startDate") || "");
  const [endDate, setEndDate] = useState(() => searchParams.get("endDate") || "");
  const [data, setData] = useState<ReconciliationReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStudentNamesText(searchParams.get("studentNames") || "");
    setStartDate(searchParams.get("startDate") || "");
    setEndDate(searchParams.get("endDate") || "");
  }, [searchParams]);

  const currentQuery = useMemo(
    () => buildQuery({ studentNamesText, startDate, endDate }),
    [endDate, startDate, studentNamesText]
  );

  const canLoad = Boolean(studentNamesText.trim() && startDate && endDate);

  const loadReport = useCallback(async () => {
    if (!canLoad) {
      setData(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    const response = await fetch(`/api/reports/sycamore-reconciliation?${currentQuery}`, { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as ReconciliationReport | { error?: string } | null;
    if (!response.ok) {
      setError((body as { error?: string } | null)?.error || "Failed to load reconciliation report.");
      setIsLoading(false);
      return;
    }

    setData(body as ReconciliationReport);
    setIsLoading(false);
  }, [canLoad, currentQuery]);

  useEffect(() => {
    if (!canLoad) {
      setData(null);
      return;
    }
    void loadReport();
  }, [canLoad, loadReport]);

  function onApplyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.replace(currentQuery ? `/reports/reconciliation?${currentQuery}` : "/reports/reconciliation", {
      scroll: false
    });
    void loadReport();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analysis"
        title="Student reconciliation between Sycamore and approved PDF data"
        description="Compare specific students across a fixed date window, then inspect exact matches, source-only records, and field-level mismatches before trusting Sycamore as the primary discipline source."
        actions={
          <div className="flex flex-wrap gap-3">
            <Link href="/reports" className={buttonStyles({ variant: "secondary" })}>
              Back to reports
            </Link>
            <Button type="button" variant="secondary" onClick={() => void loadReport()} disabled={isLoading || !canLoad}>
              <RefreshCcw className={cn("h-4 w-4", isLoading ? "animate-spin" : "")} />
              {isLoading ? "Refreshing..." : "Refresh comparison"}
            </Button>
          </div>
        }
      />

      <Panel className="space-y-5">
        <h2 className="font-display text-2xl text-[var(--color-ink)]">Inputs</h2>

        <form onSubmit={onApplyFilters} className="grid gap-4 xl:grid-cols-[1.3fr_0.8fr_0.8fr_auto]">
          <Field label="Student names" hint="Enter one student name per line or separate names with commas.">
            <Textarea
              rows={6}
              value={studentNamesText}
              onChange={(event) => setStudentNamesText(event.currentTarget.value)}
              placeholder={"Abdulahad Lalani\nDanah Ginawi"}
            />
          </Field>
          <Field label="Start date">
            <Input type="date" value={startDate} onChange={(event) => setStartDate(event.currentTarget.value)} />
          </Field>
          <Field label="End date">
            <Input type="date" value={endDate} onChange={(event) => setEndDate(event.currentTarget.value)} />
          </Field>
          <div className="flex items-end">
            <Button type="submit" variant="primary" className="w-full xl:w-auto" disabled={isLoading || !canLoad}>
              Run comparison
            </Button>
          </div>
        </form>
      </Panel>

      {error ? (
        <InlineAlert tone="danger" title="Reconciliation report could not be loaded.">
          {error}
        </InlineAlert>
      ) : null}

      {data ? (
        <>
          <Panel className="space-y-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <h2 className="font-display text-2xl text-[var(--color-ink)]">Summary</h2>
                <p className="text-sm text-[var(--color-muted)]">
                  {data.summary.studentsRequested} students, {data.summary.sycamoreRecords} Sycamore rows, {data.summary.pdfRecords} PDF rows.
                </p>
              </div>
              <StatusBadge tone="neutral">Generated {new Date(data.generatedAt).toLocaleString()}</StatusBadge>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone="neutral">{data.summary.studentsWithAnyRecords} with records</StatusBadge>
              <StatusBadge tone="success">{data.summary.matched} matched</StatusBadge>
              <StatusBadge tone="warning">{data.summary.fieldMismatch} mismatched</StatusBadge>
              <StatusBadge tone="info">{data.summary.sycamoreOnly} Sycamore only</StatusBadge>
              <StatusBadge tone="info">{data.summary.pdfOnly} PDF only</StatusBadge>
            </div>
          </Panel>

          <section className="space-y-5">
            {data.students.map((student) => (
              <Panel key={student.requestedName} className="space-y-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h2 className="font-display text-2xl text-[var(--color-ink)]">{student.requestedName}</h2>
                    <p className="mt-2 text-sm text-[var(--color-muted)]">
                      Sycamore matches: {formatStudentList(student) || "none"}.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <StatusBadge tone="info">{student.counts.sycamore} Sycamore</StatusBadge>
                    <StatusBadge tone="info">{student.counts.pdf} PDF</StatusBadge>
                    <StatusBadge tone="success">{student.counts.matched} matched</StatusBadge>
                    <StatusBadge tone="warning">{student.counts.fieldMismatch} mismatched</StatusBadge>
                    <StatusBadge tone="info">{student.counts.sycamoreOnly} Sycamore only</StatusBadge>
                    <StatusBadge tone="info">{student.counts.pdfOnly} PDF only</StatusBadge>
                  </div>
                </div>

                {student.notes.length > 0 ? (
                  <InlineAlert tone="warning" title="Comparison notes">
                    {student.notes.join(" ")}
                  </InlineAlert>
                ) : null}

                <div className="grid gap-4 md:grid-cols-2">
                  <Panel className="border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4 shadow-none">
                    <p className="font-semibold text-[var(--color-ink)]">PDF student matches</p>
                    <p className="mt-2 text-sm text-[var(--color-muted)]">
                      {student.pdfResolvedStudents.length > 0
                        ? student.pdfResolvedStudents.map((row) => `${row.fullName} (Grade ${row.grade})`).join(", ")
                        : "No local student matches were found."}
                    </p>
                  </Panel>
                  <Panel className="border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4 shadow-none">
                    <p className="font-semibold text-[var(--color-ink)]">Sycamore student matches</p>
                    <p className="mt-2 text-sm text-[var(--color-muted)]">
                      {student.sycamoreResolvedStudents.length > 0
                        ? student.sycamoreResolvedStudents
                            .map((row) => `${row.studentName ?? row.studentId}${row.grade ? ` (Grade ${row.grade})` : ""}`)
                            .join(", ")
                        : "No Sycamore student matches were found."}
                    </p>
                  </Panel>
                </div>

                {student.rows.length === 0 ? (
                  <EmptyState
                    title="No comparison rows"
                    description="Neither source produced records for this student in the selected time window."
                  />
                ) : (
                  <div className={tableShellClassName}>
                    <div className="overflow-x-auto">
                      <table className={tableClassName}>
                        <thead>
                          <tr>
                            <th className={tableHeadCellClassName}>Status</th>
                            <th className={tableHeadCellClassName}>Incident</th>
                            <th className={tableHeadCellClassName}>Sycamore</th>
                            <th className={tableHeadCellClassName}>PDF-approved</th>
                            <th className={tableHeadCellClassName}>Differences</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--color-line)]">
                          {student.rows.map((row) => (
                            <tr key={`${student.requestedName}-${row.status}-${row.matchKey}-${row.sycamore?.sourceRecordId ?? row.pdf?.sourceRecordId ?? "missing"}`}>
                              <td className={tableCellClassName}>
                                <StatusBadge tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusBadge>
                              </td>
                              <td className={tableCellClassName}>
                                <div className="space-y-1">
                                  <p className="font-semibold text-[var(--color-ink)]">
                                    {row.sycamore?.incidentDate ?? row.pdf?.incidentDate ?? "Unknown date"}
                                  </p>
                                  <p className="text-sm text-[var(--color-muted)]">
                                    {row.sycamore?.points ?? row.pdf?.points ?? 0} points
                                  </p>
                                </div>
                              </td>
                              <td className={tableCellClassName}>
                                {row.sycamore ? (
                                  <div className="space-y-1">
                                    <p className="font-semibold text-[var(--color-ink)]">{row.sycamore.sourceRecordId}</p>
                                    <p className="text-sm text-[var(--color-muted)]">{recordSummary(row.sycamore) ?? "No detail"}</p>
                                  </div>
                                ) : (
                                  <span className="text-sm text-[var(--color-subtle)]">Not present</span>
                                )}
                              </td>
                              <td className={tableCellClassName}>
                                {row.pdf ? (
                                  <div className="space-y-1">
                                    <p className="font-semibold text-[var(--color-ink)]">{row.pdf.sourceRecordId}</p>
                                    <p className="text-sm text-[var(--color-muted)]">{recordSummary(row.pdf) ?? "No detail"}</p>
                                  </div>
                                ) : (
                                  <span className="text-sm text-[var(--color-subtle)]">Not present</span>
                                )}
                              </td>
                              <td className={tableCellClassName}>
                                {row.diffs.length > 0 ? (
                                  <div className="space-y-1">
                                    {row.diffs.map((diff) => (
                                      <p key={`${row.matchKey}-${diff.field}`} className="text-sm text-[var(--color-muted)]">
                                        <span className="font-semibold text-[var(--color-ink)]">{diff.label}:</span>{" "}
                                        Sycamore {diff.sycamoreValue ?? "blank"} vs PDF {diff.pdfValue ?? "blank"}
                                      </p>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-sm text-[var(--color-subtle)]">
                                    {row.status === "matched" ? "No compared field differences." : "Only one source has this row."}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </Panel>
            ))}
          </section>
        </>
      ) : (
        <EmptyState
          title="No reconciliation loaded"
          description="Enter one or more student names plus a date range to compare Sycamore rows against approved PDF incidents."
        />
      )}
    </div>
  );
}
