"use client";

import { DragEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FileUp, RefreshCcw, Sparkles } from "lucide-react";

import type { ParseRun } from "@syc/domain";
import {
  Button,
  Checkbox,
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

interface SycamoreSyncProgressSnapshot {
  syncLogId: string;
  syncMode: "initial_backfill" | "manual_range" | "incremental";
  window: {
    startDate: string;
    endDate: string;
  };
  startedAt: string;
  updatedAt: string;
  stage: "roster" | "discovery" | "detail_fetch" | "upsert" | "complete" | "failed";
  stageIndex: number;
  stageCount: number;
  stageLabel: string;
  stageDescription: string;
  stageProgress: number | null;
  overallProgress: number;
  rosterStudentsFetched: number;
  rosterStudentsUpserted: number;
  rosterStudentsLinked: number;
  discoveryStudentsProcessed: number;
  discoveryStudentsTotal: number;
  discoveredRecords: number;
  detailRecordsProcessed: number;
  detailRecordsTotal: number;
  recordsUpserted: number;
  warningsCount: number;
  message: string;
}

type SycamoreSyncStreamLine =
  | {
      type: "progress";
      progress: SycamoreSyncProgressSnapshot;
    }
  | {
      type: "result";
      sycamoreSync: NonNullable<JobActionResponse["sycamoreSync"]>;
    }
  | {
      type: "error";
      error: string;
      status?: number;
    };

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

const syncStageKeys = ["roster", "discovery", "detail_fetch", "upsert"] as const;

function formatDuration(startedAt: string, nowValue: number): string {
  const elapsedMs = Math.max(0, nowValue - Date.parse(startedAt));
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function syncStageSubtitle(progress: SycamoreSyncProgressSnapshot, stage: (typeof syncStageKeys)[number]): string {
  switch (stage) {
    case "roster":
      return progress.rosterStudentsUpserted > 0
        ? `${progress.rosterStudentsUpserted} students refreshed`
        : "Preparing student links";
    case "discovery":
      return progress.discoveryStudentsTotal > 0
        ? `${progress.discoveryStudentsProcessed} of ${progress.discoveryStudentsTotal} students scanned`
        : progress.discoveredRecords > 0
          ? `${progress.discoveredRecords} records found`
          : "Finding matching incidents";
    case "detail_fetch":
      return progress.detailRecordsTotal > 0
        ? `${progress.detailRecordsProcessed} of ${progress.detailRecordsTotal} detailed`
        : "Waiting for discovered records";
    case "upsert":
      return progress.recordsUpserted > 0 ? `${progress.recordsUpserted} rows written` : "Waiting to write normalized rows";
  }
}

function parseNdjsonLines(input: string): { events: SycamoreSyncStreamLine[]; remainder: string } {
  const lines = input.split("\n");
  const remainder = lines.pop() ?? "";
  const events: SycamoreSyncStreamLine[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const parsed = JSON.parse(trimmed) as SycamoreSyncStreamLine;
    events.push(parsed);
  }
  return { events, remainder };
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
  const [syncProgress, setSyncProgress] = useState<SycamoreSyncProgressSnapshot | null>(null);
  const [syncNow, setSyncNow] = useState(() => Date.now());
  const [showFallbackTools, setShowFallbackTools] = useState(false);
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

  useEffect(() => {
    if (!isSyncing || !syncProgress) {
      return;
    }

    const interval = window.setInterval(() => {
      setSyncNow(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, [isSyncing, syncProgress]);

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
    setSyncProgress(null);
    setSyncNow(Date.now());

    try {
      const response = await fetch("/api/sycamore/sync/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as JobActionResponse | null;
        setError(body?.error || "Sycamore sync failed.");
        return;
      }

      if (!response.body) {
        setError("Sycamore sync started but no progress stream was returned.");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          const trailing = buffer.trim();
          if (trailing) {
            const parsed = JSON.parse(trailing) as SycamoreSyncStreamLine;
            if (parsed.type === "progress") {
              setSyncProgress(parsed.progress);
            } else if (parsed.type === "result") {
              setLastResult({ sycamoreSync: parsed.sycamoreSync });
            } else if (parsed.type === "error") {
              setError(parsed.error || "Sycamore sync failed.");
            }
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const parsed = parseNdjsonLines(buffer);
        buffer = parsed.remainder;

        for (const event of parsed.events) {
          if (event.type === "progress") {
            setSyncProgress(event.progress);
            continue;
          }
          if (event.type === "result") {
            setLastResult({ sycamoreSync: event.sycamoreSync });
            continue;
          }
          setError(event.error || "Sycamore sync failed.");
        }
      }
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
  const syncElapsed = syncProgress ? formatDuration(syncProgress.startedAt, syncNow) : null;

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

      <section className="space-y-5">
        <Panel className="space-y-5 border-white/80 bg-[linear-gradient(135deg,rgba(17,94,89,0.10),rgba(255,255,255,0.98)_48%,rgba(173,124,44,0.06))]">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge tone="success">Primary path</StatusBadge>
              <StatusBadge tone="info">Sycamore sync</StatusBadge>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Primary source</p>
              <h2 className="font-display text-3xl text-[var(--color-ink)]">Sycamore discipline import</h2>
              <p className="max-w-3xl text-sm leading-7 text-[var(--color-muted)]">
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

          {syncProgress ? (
            <SoftPanel className="space-y-5 border-white/70 bg-white/88">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">
                    Sync progress
                  </p>
                  <div className="space-y-1">
                    <h3 className="font-display text-2xl text-[var(--color-ink)]">{syncProgress.stageLabel}</h3>
                    <p className="max-w-2xl text-sm leading-7 text-[var(--color-muted)]">
                      {syncProgress.stageDescription}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge
                    tone={
                      syncProgress.stage === "failed"
                        ? "danger"
                        : syncProgress.stage === "complete"
                          ? "success"
                          : "info"
                    }
                  >
                    {syncProgress.stage === "complete"
                      ? "Completed"
                      : syncProgress.stage === "failed"
                        ? "Failed"
                        : "Running"}
                  </StatusBadge>
                  {syncElapsed ? <StatusBadge tone="neutral">{syncElapsed} elapsed</StatusBadge> : null}
                </div>
              </div>

              <div className="space-y-3">
                <div className="h-2 overflow-hidden rounded-full bg-[var(--color-soft-surface)]">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      syncProgress.stage === "failed" ? "bg-[var(--color-danger)]" : "bg-[var(--color-primary)]"
                    )}
                    style={{ width: `${Math.max(8, Math.round(syncProgress.overallProgress * 100))}%` }}
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  {syncStageKeys.map((stageKey, index) => {
                    const isComplete =
                      syncProgress.stage === "complete" ||
                      (syncProgress.stage !== "failed" && index < syncProgress.stageIndex);
                    const isCurrent = syncProgress.stage === stageKey;
                    const fill = isComplete ? 1 : isCurrent ? (syncProgress.stageProgress ?? 0.42) : 0;

                    return (
                      <div key={stageKey} className="space-y-2">
                        <div className="h-2 overflow-hidden rounded-full bg-[var(--color-soft-surface)]">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-500",
                              isComplete || isCurrent
                                ? syncProgress.stage === "failed" && isCurrent
                                  ? "bg-[var(--color-danger)]"
                                  : "bg-[var(--color-primary)]"
                                : "bg-transparent",
                              isCurrent && syncProgress.stageProgress === null ? "animate-pulse" : ""
                            )}
                            style={{ width: `${Math.round(fill * 100)}%` }}
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-[var(--color-ink)]">
                            {stageKey === "roster"
                              ? "Roster"
                              : stageKey === "discovery"
                                ? "Discovery"
                                : stageKey === "detail_fetch"
                                  ? "Detail fetch"
                                  : "Upsert"}
                          </p>
                          <p className="text-xs leading-6 text-[var(--color-muted)]">
                            {syncStageSubtitle(syncProgress, stageKey)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-4">
                <div className="rounded-[1.25rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                    Roster
                  </p>
                  <p className="mt-2 font-display text-2xl text-[var(--color-ink)]">
                    {syncProgress.rosterStudentsUpserted}
                  </p>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">
                    {syncProgress.rosterStudentsFetched > 0
                      ? `${syncProgress.rosterStudentsFetched} students fetched`
                      : "Waiting for roster scan"}
                  </p>
                </div>
                <div className="rounded-[1.25rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                    Discovery
                  </p>
                  <p className="mt-2 font-display text-2xl text-[var(--color-ink)]">
                    {syncProgress.discoveredRecords}
                  </p>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">
                    {syncProgress.discoveryStudentsTotal > 0
                      ? `${syncProgress.discoveryStudentsProcessed} of ${syncProgress.discoveryStudentsTotal} students scanned`
                      : "Incidents found in the selected window"}
                  </p>
                </div>
                <div className="rounded-[1.25rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                    Detail fetch
                  </p>
                  <p className="mt-2 font-display text-2xl text-[var(--color-ink)]">
                    {syncProgress.detailRecordsProcessed}
                    {syncProgress.detailRecordsTotal > 0 ? ` / ${syncProgress.detailRecordsTotal}` : ""}
                  </p>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">
                    {syncProgress.detailRecordsTotal > 0
                      ? `${Math.max(syncProgress.detailRecordsTotal - syncProgress.detailRecordsProcessed, 0)} left`
                      : "Waiting for detail stage"}
                  </p>
                </div>
                <div className="rounded-[1.25rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                    Upsert
                  </p>
                  <p className="mt-2 font-display text-2xl text-[var(--color-ink)]">{syncProgress.recordsUpserted}</p>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">
                    {syncProgress.warningsCount > 0
                      ? `${syncProgress.warningsCount} warning${syncProgress.warningsCount === 1 ? "" : "s"}`
                      : "No warnings so far"}
                  </p>
                </div>
              </div>

              <div className="rounded-[1.3rem] border border-dashed border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3 text-sm leading-7 text-[var(--color-muted)]">
                {syncProgress.message}
              </div>
            </SoftPanel>
          ) : null}
        </Panel>

        <div className="grid gap-5 lg:grid-cols-3">
          <SoftPanel className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Primary source</p>
            <p className="font-display text-4xl text-[var(--color-ink)]">Sycamore</p>
            <p className="text-sm leading-7 text-[var(--color-muted)]">Normal daily intake should start with the SIS sync.</p>
          </SoftPanel>
          <SoftPanel className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Default sync mode</p>
            <p className="font-display text-4xl text-[var(--color-ink)]">Incremental</p>
            <p className="text-sm leading-7 text-[var(--color-muted)]">
              Use targeted date ranges only for backfill, validation windows, or one-off investigations.
            </p>
          </SoftPanel>
          <SoftPanel className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Fallback tools</p>
                <p className="mt-2 font-display text-3xl text-[var(--color-ink)]">
                  {showFallbackTools ? "Visible" : "Hidden"}
                </p>
              </div>
              <StatusBadge tone={showFallbackTools ? "warning" : "neutral"}>
                {jobs.length} job{jobs.length === 1 ? "" : "s"} tracked
              </StatusBadge>
            </div>

            <label
              htmlFor="show-fallback-tools"
              className="flex items-start gap-3 rounded-[1.25rem] border border-[var(--color-line)] bg-white/80 px-4 py-3"
            >
              <Checkbox
                id="show-fallback-tools"
                checked={showFallbackTools}
                onChange={(event) => setShowFallbackTools(event.currentTarget.checked)}
                className="mt-1"
              />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-[var(--color-ink)]">Enable fallback PDF intake</p>
                <p className="text-sm leading-6 text-[var(--color-muted)]">
                  Show manual PDF upload, parser activity, and review counts only when Sycamore is missing records.
                </p>
              </div>
            </label>

            <p className="text-sm leading-7 text-[var(--color-muted)]">
              {flaggedRows} row{flaggedRows === 1 ? "" : "s"} currently need review from fallback imports.
            </p>
          </SoftPanel>
        </div>

        {showFallbackTools ? (
          <Panel className="space-y-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge tone="warning">Fallback path</StatusBadge>
                  <StatusBadge tone="neutral">PDF parser workflow</StatusBadge>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Fallback import</p>
                  <h2 className="font-display text-3xl text-[var(--color-ink)]">PDF backfill intake</h2>
                  <p className="max-w-2xl text-sm leading-7 text-[var(--color-muted)]">
                    Use PDF upload only when a record is missing from Sycamore or you need historical backfill. Each
                    file becomes a parse run and may still require review before anything becomes canonical.
                  </p>
                </div>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowFallbackTools(false)}>
                Hide fallback tools
              </Button>
            </div>

            <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-5">
                <SoftPanel className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Exception workflow</p>
                  <p className="text-sm leading-7 text-[var(--color-muted)]">
                    This path remains available for edge cases, but it is not the normal daily intake route for the
                    app.
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
                      Drag and drop one or more PDFs here, or click to browse. Each file will create its own parse
                      run. Keep reports under the configured upload and page limits to avoid parser rejection.
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
              </div>

              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-1">
                <SoftPanel className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Fallback PDF jobs</p>
                  <p className="font-display text-4xl text-[var(--color-ink)]">{jobs.length}</p>
                  <p className="text-sm leading-7 text-[var(--color-muted)]">
                    Parser jobs tracked for backfill and exception imports.
                  </p>
                </SoftPanel>
                <SoftPanel className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Rows needing review</p>
                  <p className="font-display text-4xl text-[var(--color-ink)]">{flaggedRows}</p>
                  <p className="text-sm leading-7 text-[var(--color-muted)]">
                    Fallback-import rows that still require human review before promotion.
                  </p>
                </SoftPanel>
              </div>
            </div>
          </Panel>
        ) : null}
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

      {showFallbackTools ? (
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
      ) : null}
    </div>
  );
}
