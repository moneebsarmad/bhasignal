"use client";

import { DragEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FileUp, RefreshCcw, Sparkles } from "lucide-react";

import type { ParseRun } from "@syc/domain";
import {
  Button,
  Field,
  EmptyState,
  InlineAlert,
  Input,
  PageHeader,
  Panel,
  Select,
  SoftPanel,
  StatusBadge,
  tableCellClassName,
  tableClassName,
  tableHeadCellClassName,
  tableShellClassName
} from "@/components/ui";
import { cn } from "@/lib/cn";

interface JobsResponse {
  jobs: ParseRun[];
}

interface JobActionResponse {
  parseRun?: ParseRun;
  parseRuns?: ParseRun[];
  uploadResults?: Array<{
    fileName: string;
    parseRun?: ParseRun;
    parserVersion?: string;
    parserWarnings?: string[];
    error?: string;
    parseRunId?: string;
  }>;
  uploadErrors?: string[];
  parserWarnings?: string[];
  sourceWarnings?: string[];
  sycamoreSync?: {
    syncLogId: string;
    status: "running" | "success" | "partial" | "failed";
    syncMode: "initial_backfill" | "manual_range" | "incremental";
    window: {
      startDate: string;
      endDate: string;
    };
    recordsDiscovered: number;
    recordsUpserted: number;
    warnings: string[];
    startedAt: string;
    completedAt: string;
    triggeredBy: string;
  };
  deprecated?: boolean;
  replacementPath?: string;
  error?: string;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function sourceLabel(sourceType: ParseRun["sourceType"]): string {
  return sourceType === "sycamore_api" ? "Sycamore API" : "Fallback PDF";
}

function toneForJobStatus(status: string): "neutral" | "info" | "success" | "warning" | "danger" {
  switch (status) {
    case "completed":
      return "success";
    case "running":
    case "processing":
      return "info";
    case "failed":
      return "danger";
    case "queued":
    case "pending":
      return "warning";
    default:
      return "neutral";
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function pickPdfFiles(files: FileList | null | undefined): { files: File[]; error: string | null } {
  if (!files || files.length === 0) {
    return { files: [], error: null };
  }

  const nextFiles = Array.from(files);
  if (nextFiles.some((file) => !isPdfFile(file))) {
    return { files: [], error: "Only PDF files are supported." };
  }

  return { files: nextFiles, error: null };
}

function uploadHeading(selectedFiles: File[], isDragActive: boolean): string {
  if (selectedFiles.length === 0) {
    return isDragActive ? "Drop fallback PDFs here" : "Drop fallback PDFs or browse";
  }
  if (selectedFiles.length === 1) {
    return selectedFiles[0]?.name ?? "1 PDF ready";
  }
  return `${selectedFiles.length} PDFs ready`;
}

function selectionSummary(selectedFiles: File[]): string {
  if (selectedFiles.length === 0) {
    return "No fallback files added yet.";
  }
  if (selectedFiles.length === 1) {
    return `Ready to import ${selectedFiles[0]?.name} through the fallback parser flow.`;
  }
  const preview = selectedFiles
    .slice(0, 3)
    .map((file) => file.name)
    .join(", ");
  const overflow = selectedFiles.length > 3 ? ` +${selectedFiles.length - 3} more` : "";
  return `Ready to import ${selectedFiles.length} fallback PDFs: ${preview}${overflow}.`;
}

function parseStudentNamesInput(value: string): string[] {
  return [...new Set(value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean))];
}

export function IngestionClient() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [jobs, setJobs] = useState<ParseRun[]>([]);
  const [isLoadingJobs, setIsLoadingJobs] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStartDate, setSyncStartDate] = useState(todayIsoDate);
  const [syncEndDate, setSyncEndDate] = useState(todayIsoDate);
  const [syncStudentNamesText, setSyncStudentNamesText] = useState("");
  const [syncGrade, setSyncGrade] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<JobActionResponse | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function setCandidateFiles(nextFiles: File[]) {
    setSelectedFiles(nextFiles);
    if (nextFiles.length > 0) {
      setError(null);
    }
  }

  function handleIncomingFiles(files: FileList | null | undefined) {
    const { files: nextFiles, error: nextError } = pickPdfFiles(files);
    if (nextError) {
      setError(nextError);
      return;
    }
    setCandidateFiles(nextFiles);
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function onDropZoneDragEnter(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragActive(true);
  }

  function onDropZoneDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function onDropZoneDragLeave(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragActive(false);
    }
  }

  function onDropZoneDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragActive(false);
    handleIncomingFiles(event.dataTransfer.files);
  }

  function onDropZoneKeyDown(event: KeyboardEvent<HTMLLabelElement>) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    openFilePicker();
  }

  async function loadJobs() {
    setIsLoadingJobs(true);
    try {
      const response = await fetch("/api/ingestion/jobs", { cache: "no-store" });
      if (!response.ok) {
        setError("Could not load ingestion jobs.");
        return;
      }

      const body = (await response.json()) as JobsResponse;
      setJobs(body.jobs || []);
    } catch (error) {
      setError(getErrorMessage(error, "Could not load ingestion jobs."));
    } finally {
      setIsLoadingJobs(false);
    }
  }

  useEffect(() => {
    void loadJobs();
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedFiles.length === 0) {
      setError("Add at least one PDF before uploading.");
      return;
    }

    setIsUploading(true);
    setError(null);
    setLastResult(null);

    try {
      const formData = new FormData();
      for (const file of selectedFiles) {
        formData.append("files", file);
      }

      const response = await fetch("/api/ingestion/upload", {
        method: "POST",
        body: formData
      });

      const body = (await response.json().catch(() => null)) as JobActionResponse | null;
      if (!response.ok) {
        setError(body?.error || "Upload failed.");
        return;
      }

      setLastResult(body);
      setSelectedFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await loadJobs();
    } catch (error) {
      setError(getErrorMessage(error, "Upload failed."));
    } finally {
      setIsUploading(false);
    }
  }

  async function runSync(payload: Record<string, unknown>) {
    setIsSyncing(true);
    setError(null);
    setLastResult(null);

    try {
      const response = await fetch("/api/sycamore/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const body = (await response.json().catch(() => null)) as JobActionResponse | null;
      if (!response.ok) {
        setError(body?.error || "Sycamore sync failed.");
        return;
      }

      setLastResult(body);
    } catch (error) {
      setError(getErrorMessage(error, "Sycamore sync failed."));
    } finally {
      setIsSyncing(false);
    }
  }

  async function onSyncSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!syncStartDate || !syncEndDate) {
      setError("Choose both a start date and end date for the Sycamore sync.");
      return;
    }
    if (syncStartDate > syncEndDate) {
      setError("Sycamore sync start date must be on or before the end date.");
      return;
    }

    const payload: Record<string, unknown> = {
      startDate: syncStartDate,
      endDate: syncEndDate
    };
    if (parsedSyncStudentNames.length > 0) {
      payload.studentNames = parsedSyncStudentNames;
    }
    if (syncGrade) {
      payload.grade = syncGrade;
    }

    await runSync(payload);
  }

  async function onIncrementalSync() {
    await runSync({
      incremental: true
    });
  }

  const summary = useMemo(() => {
    const uploadResults = lastResult?.uploadResults ?? [];
    const successfulManualUploads = uploadResults.filter((result) => result.parseRun);
    const failedManualUploads = uploadResults.filter((result) => result.error);

      if (successfulManualUploads.length > 0) {
        if (successfulManualUploads.length === 1 && failedManualUploads.length === 0) {
          const run = successfulManualUploads[0]?.parseRun;
        return run ? `Fallback PDF job ${run.id} finished with status ${run.status}.` : null;
      }

      return `Processed ${uploadResults.length} fallback PDF${uploadResults.length === 1 ? "" : "s"}: ${successfulManualUploads.length} job${successfulManualUploads.length === 1 ? "" : "s"} created${failedManualUploads.length > 0 ? `, ${failedManualUploads.length} failed` : ""}.`;
    }

    if (lastResult?.sycamoreSync) {
      const result = lastResult.sycamoreSync;
      return `${result.syncMode === "initial_backfill" ? "Initial backfill" : result.syncMode === "incremental" ? "Incremental" : "Manual range"} Sycamore sync ${result.window.startDate} to ${result.window.endDate} stored ${result.recordsUpserted} record${result.recordsUpserted === 1 ? "" : "s"}${result.status === "partial" ? " with warnings" : ""}.`;
    }

    if (!lastResult?.parseRun) {
      return null;
    }
  }, [lastResult]);

  const actionWarnings = useMemo(() => {
    const parserWarnings = lastResult?.uploadResults?.flatMap((result) => result.parserWarnings ?? []) ?? [];
    const uploadErrors = lastResult?.uploadErrors ?? [];
    return [
      ...parserWarnings,
      ...(lastResult?.parserWarnings ?? []),
      ...(lastResult?.sourceWarnings ?? []),
      ...(lastResult?.sycamoreSync?.warnings ?? []),
      ...uploadErrors
    ];
  }, [lastResult]);

  const parsedSyncStudentNames = useMemo(() => parseStudentNamesInput(syncStudentNamesText), [syncStudentNamesText]);
  const hasTargetedSyncFilters = parsedSyncStudentNames.length > 0 || Boolean(syncGrade);
  const flaggedRows = jobs.reduce((total, job) => total + job.rowsFlagged, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sources"
        title="Manage synced records and fallback imports"
        description="Run the primary Sycamore sync for normal intake, then use PDF import only when data is missing from Sycamore or you need historical backfill."
        actions={
          <Button type="button" variant="secondary" onClick={() => void loadJobs()} disabled={isLoadingJobs}>
            <RefreshCcw className={cn("h-4 w-4", isLoadingJobs ? "animate-spin" : "")} />
            {isLoadingJobs ? "Refreshing..." : "Refresh activity"}
          </Button>
        }
      />

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-5">
          <Panel className="space-y-5 border-white/80 bg-[linear-gradient(135deg,rgba(17,94,89,0.10),rgba(255,255,255,0.98)_48%,rgba(173,124,44,0.06))]">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge tone="success">Primary path</StatusBadge>
                <StatusBadge tone="info">Sycamore sync</StatusBadge>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Primary source</p>
                <h2 className="font-display text-3xl text-[var(--color-ink)]">Sycamore discipline import</h2>
                <p className="max-w-2xl text-sm leading-7 text-[var(--color-muted)]">
                  Use this for normal daily intake. Sycamore rows land directly in the read-only SIS dataset used by
                  dashboard and reporting, without creating parse runs or review tasks.
                </p>
              </div>
            </div>

            <SoftPanel className="space-y-3 border-white/70 bg-white/80">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">How to use it</p>
              <p className="text-sm leading-7 text-[var(--color-muted)]">
                Run the default sync for routine refreshes. Use a date range only for targeted backfill, validation
                windows, or one-off investigations.
              </p>
            </SoftPanel>

            <form onSubmit={onSyncSubmit} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-[1.45fr_0.55fr]">
                <Field
                  label="Student name"
                  hint="Optional. Enter one name or use commas/new lines for multiple students."
                >
                  <Input
                    value={syncStudentNamesText}
                    onChange={(event) => setSyncStudentNamesText(event.currentTarget.value)}
                    placeholder="e.g. Aybach Charkas"
                  />
                </Field>
                <Field label="Grade" hint="Optional grade filter for targeted syncs.">
                  <Select value={syncGrade} onChange={(event) => setSyncGrade(event.currentTarget.value)}>
                    <option value="">All grades</option>
                    {["6", "7", "8", "9", "10", "11", "12"].map((grade) => (
                      <option key={grade} value={grade}>
                        Grade {grade}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Start date">
                  <Input type="date" value={syncStartDate} onChange={(event) => setSyncStartDate(event.currentTarget.value)} />
                </Field>
                <Field label="End date">
                  <Input type="date" value={syncEndDate} onChange={(event) => setSyncEndDate(event.currentTarget.value)} />
                </Field>
              </div>

              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-[var(--color-muted)]">
                  {hasTargetedSyncFilters
                    ? "Student-name and grade filters require a selected date range. Default sync is reserved for full-source refreshes."
                    : "Default sync continues from the last successful window with a small overlap. Date-range sync is for explicit backfill or comparison work."}
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    type="button"
                    variant="primary"
                    disabled={isSyncing || hasTargetedSyncFilters}
                    onClick={() => void onIncrementalSync()}
                  >
                    {isSyncing ? "Syncing Sycamore..." : "Default sync"}
                  </Button>
                  <Button type="submit" variant="secondary" disabled={isSyncing}>
                    {isSyncing ? "Syncing Sycamore..." : hasTargetedSyncFilters ? "Sync filtered range" : "Sync selected range"}
                  </Button>
                </div>
              </div>
            </form>
          </Panel>

          <Panel className="space-y-5">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge tone="warning">Fallback path</StatusBadge>
                <StatusBadge tone="neutral">PDF parser workflow</StatusBadge>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Fallback import</p>
                <h2 className="font-display text-3xl text-[var(--color-ink)]">PDF backfill intake</h2>
                <p className="max-w-2xl text-sm leading-7 text-[var(--color-muted)]">
                  Use PDF upload only when a record is missing from Sycamore or you need historical backfill. Each file
                  becomes a parse run and may still require review before anything becomes canonical.
                </p>
              </div>
            </div>

            <SoftPanel className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Exception workflow</p>
              <p className="text-sm leading-7 text-[var(--color-muted)]">
                This path remains available for edge cases, but it is not the normal daily intake route for the app.
              </p>
            </SoftPanel>

            <form onSubmit={onSubmit} className="space-y-5">
              <label
                htmlFor="discipline-pdf"
                tabIndex={0}
                onKeyDown={onDropZoneKeyDown}
                onDragEnter={onDropZoneDragEnter}
                onDragOver={onDropZoneDragOver}
                onDragLeave={onDropZoneDragLeave}
                onDrop={onDropZoneDrop}
                className={cn(
                  "group flex cursor-pointer flex-col items-center justify-center rounded-[1.75rem] border border-dashed px-6 py-12 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-panel)]",
                  isDragActive
                    ? "border-[var(--color-primary)] bg-white shadow-card"
                    : "border-[var(--color-line-strong)] bg-[var(--color-soft-surface)] hover:border-[var(--color-primary)] hover:bg-white"
                )}
              >
                <div
                  className={cn(
                    "rounded-full p-4 text-[var(--color-primary)] shadow-card transition",
                    isDragActive ? "bg-[var(--color-soft-surface)]" : "bg-white"
                  )}
                >
                  <FileUp className="h-6 w-6" />
                </div>
                <p className="mt-5 font-display text-2xl text-[var(--color-ink)]">
                  {uploadHeading(selectedFiles, isDragActive)}
                </p>
                <p className="mt-3 max-w-md text-sm leading-7 text-[var(--color-muted)]">
                  Drag and drop one or more PDFs here, or click to browse. Each file will create its own parse run.
                  Keep reports under the configured upload and page limits to avoid parser rejection.
                </p>
                <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                  {isDragActive ? "Release to add these files" : "PDFs only"}
                </p>
                <input
                  id="discipline-pdf"
                  ref={fileInputRef}
                  name="files"
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  className="sr-only"
                  onChange={(event) => {
                    handleIncomingFiles(event.currentTarget.files);
                  }}
                  required
                />
              </label>

              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-[var(--color-muted)]">{selectionSummary(selectedFiles)}</div>
                <Button type="submit" variant="secondary" disabled={isUploading}>
                  {isUploading
                    ? `Uploading ${selectedFiles.length || 1} PDF${selectedFiles.length === 1 ? "" : "s"}...`
                    : `Upload ${selectedFiles.length > 1 ? "PDFs" : "PDF"}`}
                </Button>
              </div>
            </form>
          </Panel>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
          <SoftPanel className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Primary source</p>
            <p className="font-display text-4xl text-[var(--color-ink)]">Sycamore</p>
            <p className="text-sm leading-7 text-[var(--color-muted)]">Normal daily intake should start with the SIS sync.</p>
          </SoftPanel>
          <SoftPanel className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Fallback PDF jobs</p>
            <p className="font-display text-4xl text-[var(--color-ink)]">{jobs.length}</p>
            <p className="text-sm leading-7 text-[var(--color-muted)]">Parser jobs tracked for backfill and exception imports.</p>
          </SoftPanel>
          <SoftPanel className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Rows needing review</p>
            <p className="font-display text-4xl text-[var(--color-ink)]">{flaggedRows}</p>
            <p className="text-sm leading-7 text-[var(--color-muted)]">Fallback-import rows that still require human review before promotion.</p>
          </SoftPanel>
        </div>
      </section>

      {error ? (
        <InlineAlert tone="danger" title="Data intake action failed.">
          {error}
        </InlineAlert>
      ) : null}

      {summary ? (
        <InlineAlert tone="success" title="Latest intake completed.">
          {summary}
        </InlineAlert>
      ) : null}

      {actionWarnings.length > 0 ? (
        <Panel className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-[#fff7e8] p-3 text-[var(--color-warning)]">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-2xl text-[var(--color-ink)]">Intake warnings</h2>
              <p className="text-sm text-[var(--color-muted)]">Use these to understand what still needs follow-up or manual confirmation.</p>
            </div>
          </div>
          <div className="grid gap-3">
            {actionWarnings.map((warning) => (
              <div
                key={warning}
                className="rounded-[1.25rem] border border-[#ead7aa] bg-[#fdf7e6] px-4 py-3 text-sm leading-6 text-[var(--color-warning)]"
              >
                {warning}
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel className="space-y-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Fallback activity</p>
            <h2 className="mt-2 font-display text-3xl text-[var(--color-ink)]">Recent PDF import jobs</h2>
          </div>
          <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
            <Sparkles className="h-4 w-4 text-[var(--color-primary)]" />
            This table lists parser jobs only; Sycamore sync status is tracked separately.
          </div>
        </div>

        {jobs.length === 0 ? (
          <EmptyState
            title="No fallback PDF jobs yet"
            description="Use PDF import only for exceptions or backfill when Sycamore is missing needed records."
          />
        ) : (
          <div className={tableShellClassName}>
            <div className="overflow-x-auto">
              <table className={tableClassName}>
                <thead>
                  <tr>
                    <th className={tableHeadCellClassName}>Started</th>
                    <th className={tableHeadCellClassName}>Source</th>
                    <th className={tableHeadCellClassName}>File</th>
                    <th className={tableHeadCellClassName}>Status</th>
                    <th className={tableHeadCellClassName}>Rows extracted</th>
                    <th className={tableHeadCellClassName}>Flagged</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-line)]">
                  {jobs.map((job) => (
                    <tr key={job.id}>
                      <td className={tableCellClassName}>{new Date(job.startedAt).toLocaleString()}</td>
                      <td className={tableCellClassName}>
                        <StatusBadge tone="neutral">{sourceLabel(job.sourceType)}</StatusBadge>
                      </td>
                      <td className={tableCellClassName}>
                        <div className="space-y-1">
                          <p className="font-semibold text-[var(--color-ink)]">{job.fileName}</p>
                          <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">{job.id}</p>
                        </div>
                      </td>
                      <td className={tableCellClassName}>
                        <StatusBadge tone={toneForJobStatus(job.status)}>{job.status}</StatusBadge>
                      </td>
                      <td className={tableCellClassName}>{job.rowsExtracted}</td>
                      <td className={tableCellClassName}>{job.rowsFlagged}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
