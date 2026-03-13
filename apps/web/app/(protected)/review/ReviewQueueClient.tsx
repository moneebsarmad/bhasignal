"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, PencilLine, RefreshCcw, ShieldAlert, X } from "lucide-react";

import {
  Button,
  Checkbox,
  EmptyState,
  Field,
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
  tableShellClassName,
  Textarea
} from "@/components/ui";
import { cn } from "@/lib/cn";

type ReviewStatusFilter = "all" | "open" | "approved" | "rejected" | "edited";
type ConfidenceFilter = "all" | "low" | "medium" | "high" | "unknown";
type SourceTypeFilter = "all" | "manual_pdf" | "sycamore_api";

interface ReviewQueueItem {
  task: {
    id: string;
    parseRunId: string;
    rawIncidentId: string;
    assignee: string | null;
    status: "open" | "approved" | "rejected" | "edited";
    resolution: string;
    createdAt: string;
    resolvedAt: string | null;
  };
  rawIncident: {
    id: string;
    parseRunId: string;
    sourceType: "manual_pdf" | "sycamore_api";
    studentReference: string;
    occurredAt: string;
    writeupDate: string | null;
    points: number;
    reason: string;
    violation: string | null;
    violationRaw: string | null;
    level: number | null;
    comment: string;
    description: string | null;
    resolution: string | null;
    teacherName: string;
    authorName: string | null;
    authorNameRaw: string | null;
    status: "pending_review" | "approved" | "rejected";
  };
  parseRun: {
    id: string;
    sourceType: "manual_pdf" | "sycamore_api";
    fileName: string;
    uploadedBy: string;
    status: string;
  } | null;
  recordConfidence: number | null;
  confidenceBand: ConfidenceFilter;
  parseWarnings: string[];
  sourceSnippet: string;
}

interface QueueResponse {
  items: ReviewQueueItem[];
}

interface BulkActionResult {
  processedCount: number;
  skippedCount: number;
  automation?: {
    warnings: string[];
  };
}

interface BulkActionResponse {
  result?: BulkActionResult;
  error?: string;
}

interface DraftState {
  studentReference: string;
  occurredAt: string;
  writeupDate: string;
  points: string;
  violation: string;
  violationRaw: string;
  level: string;
  description: string;
  resolution: string;
  authorName: string;
  authorNameRaw: string;
  rejectReason: string;
}

function createDraft(item: ReviewQueueItem): DraftState {
  return {
    studentReference: item.rawIncident.studentReference,
    occurredAt: item.rawIncident.occurredAt,
    writeupDate: item.rawIncident.writeupDate || normalizeIsoDateTime(item.rawIncident.occurredAt),
    points: String(item.rawIncident.points),
    violation: item.rawIncident.violation || item.rawIncident.reason,
    violationRaw: item.rawIncident.violationRaw || item.rawIncident.reason,
    level: item.rawIncident.level === null ? "" : String(item.rawIncident.level),
    description: item.rawIncident.description || item.rawIncident.comment,
    resolution: item.rawIncident.resolution || "",
    authorName: item.rawIncident.authorName || item.rawIncident.teacherName,
    authorNameRaw: item.rawIncident.authorNameRaw || item.rawIncident.teacherName,
    rejectReason: ""
  };
}

function statusTone(status: string): "neutral" | "info" | "success" | "warning" | "danger" {
  switch (status) {
    case "approved":
      return "success";
    case "edited":
      return "info";
    case "rejected":
      return "danger";
    case "open":
      return "warning";
    default:
      return "neutral";
  }
}

function confidenceTone(confidence: ConfidenceFilter): "neutral" | "info" | "success" | "warning" | "danger" {
  switch (confidence) {
    case "high":
      return "success";
    case "medium":
      return "info";
    case "low":
      return "warning";
    case "unknown":
      return "danger";
    default:
      return "neutral";
  }
}

function sourceLabel(sourceType: SourceTypeFilter): string {
  return sourceType === "sycamore_api" ? "Sycamore API" : sourceType === "manual_pdf" ? "Manual PDF" : "All sources";
}

function normalizeIsoDateTime(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }
  return parsed.toISOString().slice(0, 10);
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function reviewReady(item: ReviewQueueItem): boolean {
  const hasCoreFields =
    Boolean(item.rawIncident.studentReference.trim()) &&
    Boolean((item.rawIncident.writeupDate || item.rawIncident.occurredAt).trim()) &&
    Number.isFinite(item.rawIncident.points) &&
    Boolean((item.rawIncident.violation || item.rawIncident.reason).trim());

  return (
    item.task.status === "open" &&
    item.parseWarnings.length === 0 &&
    (item.confidenceBand === "medium" || item.confidenceBand === "high") &&
    hasCoreFields
  );
}

function formatBatchMessage(input: {
  action: "approve" | "reject";
  processedCount: number;
  skippedCount: number;
  warnings: string[];
}): string {
  const verb = input.action === "approve" ? "Approved" : "Rejected";
  const parts = [`${verb} ${input.processedCount} row${input.processedCount === 1 ? "" : "s"}.`];

  if (input.skippedCount > 0) {
    parts.push(`${input.skippedCount} skipped.`);
  }
  if (input.warnings.length > 0) {
    parts.push(`Automation warnings: ${input.warnings.join(", ")}.`);
  }

  return parts.join(" ");
}

export function ReviewQueueClient() {
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [status, setStatus] = useState<ReviewStatusFilter>("open");
  const [confidence, setConfidence] = useState<ConfidenceFilter>("all");
  const [sourceType, setSourceType] = useState<SourceTypeFilter>("all");
  const [parseRunId, setParseRunId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [processingTaskId, setProcessingTaskId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);

  function updateDraft(taskId: string, patch: Partial<DraftState>) {
    setDrafts((previous) => {
      const existing = previous[taskId];
      const item = items.find((queueItem) => queueItem.task.id === taskId);
      if (!existing && !item) {
        return previous;
      }

      return {
        ...previous,
        [taskId]: { ...(existing ?? createDraft(item!)), ...patch }
      };
    });
  }

  const loadQueue = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set("status", status);
      params.set("confidence", confidence);
      params.set("sourceType", sourceType);
      if (parseRunId.trim()) {
        params.set("parseRunId", parseRunId.trim());
      }

      const response = await fetch(`/api/review/queue?${params.toString()}`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as QueueResponse | { error?: string } | null;

      if (!response.ok) {
        setError((body as { error?: string } | null)?.error || "Failed to load review queue.");
        return;
      }

      const queueItems = (body as QueueResponse).items || [];
      setItems(queueItems);
      setDrafts((previous) => {
        const nextDrafts = { ...previous };
        for (const item of queueItems) {
          if (!nextDrafts[item.task.id]) {
            nextDrafts[item.task.id] = createDraft(item);
          }
        }
        return nextDrafts;
      });
      setSelectedTaskIds((previous) =>
        previous.filter((taskId) =>
          queueItems.some((item) => item.task.id === taskId && item.task.status === "open")
        )
      );
    } catch (nextError) {
      setError(getErrorMessage(nextError, "Failed to load review queue."));
    } finally {
      setIsLoading(false);
    }
  }, [confidence, parseRunId, sourceType, status]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (items.length === 0) {
      setSelectedTaskId(null);
      return;
    }
    const firstTaskId = items[0]?.task.id ?? null;
    setSelectedTaskId((current) => (current && items.some((item) => item.task.id === current) ? current : firstTaskId));
  }, [items]);

  async function submitAction(taskId: string, action: "approve" | "edit_approve" | "reject") {
    const draft = drafts[taskId];
    if (!draft) {
      return;
    }

    setProcessingTaskId(taskId);
    setError(null);
    setMessage(null);

    try {
      const payload: Record<string, unknown> = {
        action
      };

      if (action === "edit_approve") {
        const parsedPoints = Number(draft.points);
        const parsedLevel = Number(draft.level);
        payload.edits = {
          studentReference: draft.studentReference.trim(),
          occurredAt: draft.occurredAt.trim(),
          writeupDate: draft.writeupDate.trim(),
          points: Number.isFinite(parsedPoints) ? parsedPoints : 0,
          reason: draft.violation.trim(),
          violation: draft.violation.trim(),
          violationRaw: draft.violationRaw.trim(),
          level: Number.isFinite(parsedLevel) ? parsedLevel : undefined,
          comment: draft.description,
          description: draft.description,
          resolution: draft.resolution,
          teacherName: draft.authorName,
          authorName: draft.authorName,
          authorNameRaw: draft.authorNameRaw
        };
        payload.reason = "edited_before_approval";
      }

      if (action === "reject") {
        payload.reason = draft.rejectReason.trim() || "rejected_by_reviewer";
      }

      const response = await fetch(`/api/review/tasks/${encodeURIComponent(taskId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error || "Review action failed.");
        return;
      }

      setSelectedTaskIds((previous) => previous.filter((currentTaskId) => currentTaskId !== taskId));
      setMessage(
        action === "approve"
          ? `Approved task ${taskId}.`
          : action === "edit_approve"
            ? `Edited and approved task ${taskId}.`
            : `Rejected task ${taskId}.`
      );
      await loadQueue();
    } catch (nextError) {
      setError(getErrorMessage(nextError, "Review action failed."));
    } finally {
      setProcessingTaskId(null);
    }
  }

  async function submitBulkAction(taskIds: string[], action: "approve" | "reject") {
    if (taskIds.length === 0) {
      return;
    }

    setIsBulkProcessing(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/review/tasks/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          taskIds
        })
      });

      const body = (await response.json().catch(() => null)) as BulkActionResponse | null;
      if (!response.ok) {
        setError(body?.error || "Bulk review action failed.");
        return;
      }

      const result = body?.result;
      const processedCount = result?.processedCount ?? 0;
      const skippedCount = result?.skippedCount ?? 0;
      const warnings = result?.automation?.warnings ?? [];

      setSelectedTaskIds((previous) => previous.filter((taskId) => !taskIds.includes(taskId)));
      setMessage(formatBatchMessage({ action, processedCount, skippedCount, warnings }));
      await loadQueue();
    } catch (nextError) {
      setError(getErrorMessage(nextError, "Bulk review action failed."));
    } finally {
      setIsBulkProcessing(false);
    }
  }

  function toggleTaskSelection(taskId: string) {
    setSelectedTaskIds((previous) =>
      previous.includes(taskId) ? previous.filter((currentTaskId) => currentTaskId !== taskId) : [...previous, taskId]
    );
  }

  const openItems = useMemo(
    () => items.filter((item) => item.task.status === "open"),
    [items]
  );
  const openTaskIds = useMemo(() => openItems.map((item) => item.task.id), [openItems]);
  const readyItems = useMemo(() => openItems.filter(reviewReady), [openItems]);
  const readyTaskIds = useMemo(() => readyItems.map((item) => item.task.id), [readyItems]);
  const selectedOpenTaskIds = useMemo(
    () => selectedTaskIds.filter((taskId) => openTaskIds.includes(taskId)),
    [openTaskIds, selectedTaskIds]
  );
  const allVisibleSelected = openTaskIds.length > 0 && selectedOpenTaskIds.length === openTaskIds.length;
  const someVisibleSelected = selectedOpenTaskIds.length > 0 && !allVisibleSelected;
  const openCount = openItems.length;
  const selectedCount = selectedOpenTaskIds.length;
  const readyCount = readyTaskIds.length;
  const selectedItem = items.find((item) => item.task.id === selectedTaskId) ?? null;
  const selectedDraft = selectedItem ? drafts[selectedItem.task.id] ?? createDraft(selectedItem) : null;
  const selectedDisabled = selectedItem ? processingTaskId === selectedItem.task.id || isBulkProcessing : false;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Exception workflow"
        title="Review fallback rows without making it the main intake path"
        description="Use this queue for fallback PDF parsing and other low-confidence records that need manual correction before promotion."
        actions={
          <Button type="button" variant="secondary" onClick={() => void loadQueue()} disabled={isLoading || isBulkProcessing}>
            <RefreshCcw className={cn("h-4 w-4", isLoading ? "animate-spin" : "")} />
            {isLoading ? "Refreshing..." : "Refresh queue"}
          </Button>
        }
      />

      <Panel className="space-y-5">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Queue filters</p>
            <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Focus the review session</h2>
          </div>
          <StatusBadge tone="warning">{openCount} open items in view</StatusBadge>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Status">
            <Select value={status} onChange={(event) => setStatus(event.currentTarget.value as ReviewStatusFilter)}>
              <option value="open">Open</option>
              <option value="all">All</option>
              <option value="approved">Approved</option>
              <option value="edited">Edited</option>
              <option value="rejected">Rejected</option>
            </Select>
          </Field>

          <Field label="Confidence">
            <Select
              value={confidence}
              onChange={(event) => setConfidence(event.currentTarget.value as ConfidenceFilter)}
            >
              <option value="all">All</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="unknown">Unknown</option>
            </Select>
          </Field>

          <Field label="Source">
            <Select
              value={sourceType}
              onChange={(event) => setSourceType(event.currentTarget.value as SourceTypeFilter)}
            >
              <option value="all">All sources</option>
              <option value="manual_pdf">Manual PDF</option>
              <option value="sycamore_api">Sycamore API</option>
            </Select>
          </Field>

          <Field label="Parse Run ID" hint="Optional">
            <Input value={parseRunId} onChange={(event) => setParseRunId(event.currentTarget.value)} />
          </Field>
        </div>
      </Panel>

      {error ? (
        <InlineAlert tone="danger" title="The queue could not be updated.">
          {error}
        </InlineAlert>
      ) : null}
      {message ? (
        <InlineAlert tone="success" title="Review queue updated.">
          {message}
        </InlineAlert>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.95fr)]">
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <SoftPanel className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Visible open</p>
              <p className="font-display text-4xl text-[var(--color-ink)]">{openCount}</p>
              <p className="text-sm text-[var(--color-muted)]">Rows that can still be resolved in this filtered view.</p>
            </SoftPanel>
            <SoftPanel className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Ready now</p>
              <p className="font-display text-4xl text-[var(--color-ink)]">{readyCount}</p>
              <p className="text-sm text-[var(--color-muted)]">Open rows with no warnings and medium/high confidence.</p>
            </SoftPanel>
            <SoftPanel className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Selected</p>
              <p className="font-display text-4xl text-[var(--color-ink)]">{selectedCount}</p>
              <p className="text-sm text-[var(--color-muted)]">Current bulk action scope in the table below.</p>
            </SoftPanel>
          </div>

          <Panel className="space-y-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Queue</p>
                <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Compact review board</h2>
                <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                  Scan, select, and approve from the table. Open the editor only when a row needs corrections.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={openCount === 0 || isBulkProcessing || processingTaskId !== null}
                  onClick={() => {
                    setSelectedTaskIds((previous) =>
                      allVisibleSelected
                        ? previous.filter((taskId) => !openTaskIds.includes(taskId))
                        : [...new Set([...previous, ...openTaskIds])]
                    );
                  }}
                >
                  {allVisibleSelected ? "Clear visible selection" : "Select all visible"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={readyCount === 0 || isBulkProcessing || processingTaskId !== null}
                  onClick={() => void submitBulkAction(readyTaskIds, "approve")}
                >
                  <Check className="h-4 w-4" />
                  Approve all ready
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={selectedCount === 0 || isBulkProcessing || processingTaskId !== null}
                  onClick={() => void submitBulkAction(selectedOpenTaskIds, "approve")}
                >
                  <Check className="h-4 w-4" />
                  Approve selected
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={selectedCount === 0 || isBulkProcessing || processingTaskId !== null}
                  onClick={() => void submitBulkAction(selectedOpenTaskIds, "reject")}
                >
                  <X className="h-4 w-4" />
                  Reject selected
                </Button>
              </div>
            </div>

            {items.length === 0 ? (
              <EmptyState
                title="No tasks match these filters"
                description="Adjust the status or confidence filters, or wait for a new parse run to create review work."
              />
            ) : (
              <div className={tableShellClassName}>
                <div className="overflow-x-auto">
                  <table className={tableClassName}>
                    <thead>
                      <tr>
                        <th className={tableHeadCellClassName}>
                          <Checkbox
                            checked={allVisibleSelected}
                            ref={(node) => {
                              if (node) {
                                node.indeterminate = someVisibleSelected;
                              }
                            }}
                            disabled={openCount === 0 || isBulkProcessing || processingTaskId !== null}
                            onChange={() => {
                              setSelectedTaskIds((previous) =>
                                allVisibleSelected
                                  ? previous.filter((taskId) => !openTaskIds.includes(taskId))
                                  : [...new Set([...previous, ...openTaskIds])]
                              );
                            }}
                          />
                        </th>
                        <th className={tableHeadCellClassName}>Student</th>
                        <th className={tableHeadCellClassName}>Date</th>
                        <th className={tableHeadCellClassName}>Violation</th>
                        <th className={tableHeadCellClassName}>Pts</th>
                        <th className={tableHeadCellClassName}>Author</th>
                        <th className={tableHeadCellClassName}>Confidence</th>
                        <th className={tableHeadCellClassName}>Alerts</th>
                        <th className={tableHeadCellClassName}>Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-line)]">
                      {items.map((item) => {
                        const isSelectedRow = item.task.id === selectedTaskId;
                        const isChecked = selectedOpenTaskIds.includes(item.task.id);
                        const canSelect = item.task.status === "open";
                        const ready = reviewReady(item);
                        const rowBusy = processingTaskId === item.task.id || isBulkProcessing;

                        return (
                          <tr
                            key={item.task.id}
                            className={cn(
                              "cursor-pointer transition hover:bg-[var(--color-soft-surface)]",
                              isSelectedRow ? "bg-[var(--color-primary-soft)]/70" : ""
                            )}
                            onClick={() => setSelectedTaskId(item.task.id)}
                          >
                            <td className={tableCellClassName}>
                              <Checkbox
                                checked={isChecked}
                                disabled={!canSelect || rowBusy}
                                onClick={(event) => event.stopPropagation()}
                                onChange={() => toggleTaskSelection(item.task.id)}
                              />
                            </td>
                            <td className={tableCellClassName}>
                              <div className="space-y-1">
                                <p className="font-semibold text-[var(--color-ink)]">
                                  {item.rawIncident.studentReference || "Unresolved student"}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  <StatusBadge tone="neutral">{sourceLabel(item.rawIncident.sourceType)}</StatusBadge>
                                  <StatusBadge tone={statusTone(item.task.status)}>{item.task.status}</StatusBadge>
                                  {ready ? <StatusBadge tone="success">ready</StatusBadge> : null}
                                </div>
                              </div>
                            </td>
                            <td className={tableCellClassName}>
                              {normalizeIsoDateTime(item.rawIncident.writeupDate || item.rawIncident.occurredAt) || "No date"}
                            </td>
                            <td className={tableCellClassName}>
                              <div className="space-y-1">
                                <p className="font-medium text-[var(--color-ink)]">
                                  {item.rawIncident.violation || item.rawIncident.reason || "No violation"}
                                </p>
                                <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">
                                  {item.rawIncident.level !== null ? `Level ${item.rawIncident.level}` : "No level"}
                                </p>
                              </div>
                            </td>
                            <td className={tableCellClassName}>{item.rawIncident.points}</td>
                            <td className={tableCellClassName}>
                              {item.rawIncident.authorName || item.rawIncident.teacherName || "No author"}
                            </td>
                            <td className={tableCellClassName}>
                              <StatusBadge tone={confidenceTone(item.confidenceBand)}>{item.confidenceBand}</StatusBadge>
                            </td>
                            <td className={tableCellClassName}>
                              {item.parseWarnings.length > 0 ? (
                                <StatusBadge tone="warning">{item.parseWarnings.length} warning{item.parseWarnings.length === 1 ? "" : "s"}</StatusBadge>
                              ) : (
                                <StatusBadge tone="success">clean</StatusBadge>
                              )}
                            </td>
                            <td className={tableCellClassName}>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  variant="primary"
                                  size="sm"
                                  disabled={!canSelect || rowBusy}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void submitAction(item.task.id, "approve");
                                  }}
                                >
                                  <Check className="h-4 w-4" />
                                  Approve
                                </Button>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setSelectedTaskId(item.task.id);
                                  }}
                                >
                                  <PencilLine className="h-4 w-4" />
                                  Review
                                </Button>
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
        </div>

        <Panel className="space-y-5">
          {!selectedItem || !selectedDraft ? (
            <EmptyState
              title="Select a row"
              description="Open a row from the table to verify the source snippet, correct fields, and resolve the task."
            />
          ) : (
            <>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={statusTone(selectedItem.task.status)}>{selectedItem.task.status}</StatusBadge>
                    <StatusBadge tone={confidenceTone(selectedItem.confidenceBand)}>
                      {selectedItem.confidenceBand} confidence
                    </StatusBadge>
                    <StatusBadge tone="neutral">{sourceLabel(selectedItem.rawIncident.sourceType)}</StatusBadge>
                    {reviewReady(selectedItem) ? <StatusBadge tone="success">ready</StatusBadge> : null}
                  </div>
                  <div>
                    <h2 className="font-display text-3xl text-[var(--color-ink)]">
                      {selectedDraft.studentReference || "Unnamed incident"}
                    </h2>
                    <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                      Parse run {selectedItem.task.parseRunId}
                      {selectedItem.parseRun ? ` • ${selectedItem.parseRun.fileName}` : ""}
                    </p>
                  </div>
                </div>
                <div className="text-sm text-[var(--color-muted)]">
                  Created {new Date(selectedItem.task.createdAt).toLocaleString()}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <SoftPanel className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Date + points</p>
                  <p className="font-semibold text-[var(--color-ink)]">
                    {normalizeIsoDateTime(selectedDraft.writeupDate || selectedDraft.occurredAt) || "No date"} • {selectedDraft.points} pts
                  </p>
                </SoftPanel>
                <SoftPanel className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Violation + author</p>
                  <p className="font-semibold text-[var(--color-ink)]">
                    {selectedDraft.violation || "No violation"} • {selectedDraft.authorName || "No author"}
                  </p>
                </SoftPanel>
              </div>

              <SoftPanel className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-[var(--color-primary-soft)] p-3 text-[var(--color-primary)]">
                    <ShieldAlert className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-[var(--color-ink)]">Source snippet</p>
                    <p className="text-sm text-[var(--color-muted)]">Use the extracted source to verify field edits before approving.</p>
                  </div>
                </div>
                <div className="rounded-[1.25rem] border border-[var(--color-line)] bg-white px-4 py-4 text-sm leading-7 text-[var(--color-muted)]">
                  {selectedItem.sourceSnippet || "No snippet captured for this record."}
                </div>
                {selectedItem.parseWarnings.length > 0 ? (
                  <div className="grid gap-2">
                    {selectedItem.parseWarnings.map((warning) => (
                      <div
                        key={warning}
                        className="rounded-[1rem] border border-[#ead7aa] bg-[#fdf7e6] px-3 py-2 text-sm text-[var(--color-warning)]"
                      >
                        {warning}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[1rem] border border-[#b8e3cc] bg-[#eef9f1] px-3 py-2 text-sm text-[var(--color-success)]">
                    No parser warnings for this row.
                  </div>
                )}
              </SoftPanel>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Student reference">
                  <Input
                    value={selectedDraft.studentReference}
                    onChange={(event) => updateDraft(selectedItem.task.id, { studentReference: event.currentTarget.value })}
                  />
                </Field>
                <Field label="Write-up date">
                  <Input
                    value={selectedDraft.writeupDate}
                    onChange={(event) => updateDraft(selectedItem.task.id, { writeupDate: event.currentTarget.value })}
                  />
                </Field>
                <Field label="Occurred at" hint="Compatibility field">
                  <Input
                    value={selectedDraft.occurredAt}
                    onChange={(event) => updateDraft(selectedItem.task.id, { occurredAt: event.currentTarget.value })}
                  />
                </Field>
                <Field label="Points">
                  <Input
                    value={selectedDraft.points}
                    onChange={(event) => updateDraft(selectedItem.task.id, { points: event.currentTarget.value })}
                  />
                </Field>
                <Field label="Level">
                  <Input
                    value={selectedDraft.level}
                    onChange={(event) => updateDraft(selectedItem.task.id, { level: event.currentTarget.value })}
                  />
                </Field>
                <Field label="Violation">
                  <Input
                    value={selectedDraft.violation}
                    onChange={(event) => updateDraft(selectedItem.task.id, { violation: event.currentTarget.value })}
                  />
                </Field>
                <Field label="Violation raw">
                  <Input
                    value={selectedDraft.violationRaw}
                    onChange={(event) => updateDraft(selectedItem.task.id, { violationRaw: event.currentTarget.value })}
                  />
                </Field>
                <Field label="Author">
                  <Input
                    value={selectedDraft.authorName}
                    onChange={(event) => updateDraft(selectedItem.task.id, { authorName: event.currentTarget.value })}
                  />
                </Field>
                <Field label="Author raw">
                  <Input
                    value={selectedDraft.authorNameRaw}
                    onChange={(event) => updateDraft(selectedItem.task.id, { authorNameRaw: event.currentTarget.value })}
                  />
                </Field>
                <Field label="Description" className="md:col-span-2">
                  <Textarea
                    rows={5}
                    value={selectedDraft.description}
                    onChange={(event) => updateDraft(selectedItem.task.id, { description: event.currentTarget.value })}
                  />
                </Field>
                <Field label="Resolution" className="md:col-span-2">
                  <Textarea
                    rows={4}
                    value={selectedDraft.resolution}
                    onChange={(event) => updateDraft(selectedItem.task.id, { resolution: event.currentTarget.value })}
                  />
                </Field>
                <Field label="Reject reason" className="md:col-span-2">
                  <Input
                    value={selectedDraft.rejectReason}
                    onChange={(event) => updateDraft(selectedItem.task.id, { rejectReason: event.currentTarget.value })}
                  />
                </Field>
              </div>

              <div className="flex flex-wrap gap-3 rounded-[1.4rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4">
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => void submitAction(selectedItem.task.id, "approve")}
                  disabled={selectedDisabled || selectedItem.task.status !== "open"}
                >
                  <Check className="h-4 w-4" />
                  Approve
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void submitAction(selectedItem.task.id, "edit_approve")}
                  disabled={selectedDisabled || selectedItem.task.status !== "open"}
                >
                  <PencilLine className="h-4 w-4" />
                  Edit + approve
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => void submitAction(selectedItem.task.id, "reject")}
                  disabled={selectedDisabled || selectedItem.task.status !== "open"}
                >
                  <X className="h-4 w-4" />
                  Reject
                </Button>
              </div>
            </>
          )}
        </Panel>
      </section>
    </div>
  );
}
