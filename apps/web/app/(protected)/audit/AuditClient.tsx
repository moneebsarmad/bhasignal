"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Eye, RefreshCcw } from "lucide-react";

import {
  Button,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  PageHeader,
  Panel,
  SoftPanel,
  StatusBadge,
  tableCellClassName,
  tableClassName,
  tableHeadCellClassName,
  tableShellClassName
} from "@/components/ui";
import { cn } from "@/lib/cn";

type AuditScope = "all" | "sycamore_async";

interface AuditEventRow {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  actor: string;
  payloadJson: string;
  createdAt: string;
}

interface AuditFiltersState {
  scope: AuditScope;
  eventType: string;
  entityType: string;
  entityId: string;
  actor: string;
  from: string;
  to: string;
  limit: string;
}

const AUDIT_SCOPE_OPTIONS: Array<{
  key: AuditScope;
  label: string;
  description: string;
}> = [
  {
    key: "all",
    label: "All activity",
    description: "Show the full audit trail."
  },
  {
    key: "sycamore_async",
    label: "Sycamore async jobs",
    description: "Queued batches plus background Sycamore job starts, finishes, and failures."
  }
];

const PAYLOAD_SUMMARY_LIMIT = 12;
const PAYLOAD_PRIORITY = [
  "status",
  "resultStatus",
  "triggeredBy",
  "syncMode",
  "eventType",
  "recipient",
  "studentId",
  "interventionId",
  "overallWindow.startDate",
  "overallWindow.endDate",
  "window.startDate",
  "window.endDate",
  "totalChunks",
  "completedChunks",
  "failedChunks",
  "warningsCount",
  "recordsDiscovered",
  "recordsUpserted",
  "error",
  "errorMessage"
] as const;

type PayloadSummaryEntry = {
  keyPath: string;
  label: string;
  value: string;
};

function humanizeKey(keyPath: string): string {
  return keyPath
    .split(".")
    .flatMap((segment) => segment.split(/(?=[A-Z])/))
    .map((segment) => segment.replace(/[_-]+/g, " ").trim())
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatPayloadValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return value.length > 120 ? `${value.slice(0, 117)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  }
  if (value && typeof value === "object") {
    return `${Object.keys(value as Record<string, unknown>).length} fields`;
  }
  return String(value);
}

function collectPayloadSummaryEntries(
  value: unknown,
  parentKey = "",
  depth = 0
): PayloadSummaryEntry[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const entries: PayloadSummaryEntry[] = [];
  for (const [key, child] of Object.entries(value)) {
    const keyPath = parentKey ? `${parentKey}.${key}` : key;
    if (child === null || ["string", "number", "boolean"].includes(typeof child)) {
      entries.push({
        keyPath,
        label: humanizeKey(keyPath),
        value: formatPayloadValue(child)
      });
      continue;
    }

    if (Array.isArray(child)) {
      entries.push({
        keyPath,
        label: humanizeKey(keyPath),
        value: formatPayloadValue(child)
      });
      continue;
    }

    if (depth < 1) {
      entries.push(...collectPayloadSummaryEntries(child, keyPath, depth + 1));
      continue;
    }

    entries.push({
      keyPath,
      label: humanizeKey(keyPath),
      value: formatPayloadValue(child)
    });
  }

  return entries;
}

function buildPayloadPresentation(payloadJson: string): {
  summaryEntries: PayloadSummaryEntry[];
  formattedJson: string;
} {
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    const summaryEntries = collectPayloadSummaryEntries(parsed)
      .sort((left, right) => {
        const leftPriority = PAYLOAD_PRIORITY.indexOf(left.keyPath as (typeof PAYLOAD_PRIORITY)[number]);
        const rightPriority = PAYLOAD_PRIORITY.indexOf(right.keyPath as (typeof PAYLOAD_PRIORITY)[number]);
        const normalizedLeft = leftPriority === -1 ? Number.MAX_SAFE_INTEGER : leftPriority;
        const normalizedRight = rightPriority === -1 ? Number.MAX_SAFE_INTEGER : rightPriority;
        if (normalizedLeft !== normalizedRight) {
          return normalizedLeft - normalizedRight;
        }
        return left.label.localeCompare(right.label);
      })
      .slice(0, PAYLOAD_SUMMARY_LIMIT);

    return {
      summaryEntries,
      formattedJson: JSON.stringify(parsed, null, 2)
    };
  } catch {
    return {
      summaryEntries: [],
      formattedJson: payloadJson
    };
  }
}

export function AuditClient() {
  const [scope, setScope] = useState<AuditScope>("all");
  const [eventType, setEventType] = useState("");
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [actor, setActor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState("200");
  const [events, setEvents] = useState<AuditEventRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEvents = useCallback(async (nextFilters?: Partial<AuditFiltersState>) => {
    const filters: AuditFiltersState = {
      scope: nextFilters?.scope ?? scope,
      eventType: nextFilters?.eventType ?? eventType,
      entityType: nextFilters?.entityType ?? entityType,
      entityId: nextFilters?.entityId ?? entityId,
      actor: nextFilters?.actor ?? actor,
      from: nextFilters?.from ?? from,
      to: nextFilters?.to ?? to,
      limit: nextFilters?.limit ?? limit
    };

    setIsLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (filters.scope !== "all") {
      params.set("scope", filters.scope);
    }
    if (filters.eventType.trim()) {
      params.set("eventType", filters.eventType.trim());
    }
    if (filters.entityType.trim()) {
      params.set("entityType", filters.entityType.trim());
    }
    if (filters.entityId.trim()) {
      params.set("entityId", filters.entityId.trim());
    }
    if (filters.actor.trim()) {
      params.set("actor", filters.actor.trim());
    }
    if (filters.from) {
      params.set("from", filters.from);
    }
    if (filters.to) {
      params.set("to", filters.to);
    }
    params.set("limit", filters.limit);

    const response = await fetch(`/api/audit/events?${params.toString()}`, { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as
      | { events?: AuditEventRow[]; error?: string }
      | null;
    if (!response.ok) {
      setError(body?.error || "Failed to load audit events.");
      setIsLoading(false);
      return;
    }

    const nextEvents = body?.events ?? [];
    setEvents(nextEvents);
    setSelectedEventId((current) =>
      current && nextEvents.some((event) => event.id === current) ? current : nextEvents[0]?.id ?? null
    );
    setIsLoading(false);
  }, [actor, entityId, entityType, eventType, from, limit, scope, to]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  function onApplyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadEvents();
  }

  function onApplyScope(nextScope: AuditScope) {
    setScope(nextScope);
    setEventType("");
    setEntityType("");
    setEntityId("");
    setActor("");
    void loadEvents({
      scope: nextScope,
      eventType: "",
      entityType: "",
      entityId: "",
      actor: ""
    });
  }

  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? null;
  const selectedPayload = useMemo(
    () => buildPayloadPresentation(selectedEvent?.payloadJson ?? ""),
    [selectedEvent?.payloadJson]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Traceability"
        title="Follow the system’s decision trail"
        description="Filter audit activity, inspect event payloads, and verify exactly when ingestion, review, policy, and notification actions occurred."
        actions={
          <Button type="button" variant="secondary" onClick={() => void loadEvents()} disabled={isLoading}>
            <RefreshCcw className={cn("h-4 w-4", isLoading ? "animate-spin" : "")} />
            {isLoading ? "Refreshing..." : "Refresh events"}
          </Button>
        }
      />

      <Panel className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="font-display text-2xl text-[var(--color-ink)]">Filters</h2>
            <p className="text-sm text-[var(--color-muted)]">Use a quick scope when you want one slice of system history fast.</p>
          </div>
          <StatusBadge tone="neutral">{limit} max rows</StatusBadge>
        </div>
        <div className="flex flex-wrap gap-2">
          {AUDIT_SCOPE_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => onApplyScope(option.key)}
              className={cn(
                "rounded-full border px-3.5 py-2 text-sm font-semibold transition",
                scope === option.key
                  ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white shadow-card"
                  : "border-[var(--color-line)] bg-[var(--color-soft-surface)] text-[var(--color-muted)] hover:border-[var(--color-primary)] hover:bg-white hover:text-[var(--color-ink)]"
              )}
              title={option.description}
            >
              {option.label}
            </button>
          ))}
        </div>
        <form onSubmit={onApplyFilters} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Event type">
            <Input value={eventType} onChange={(event) => setEventType(event.currentTarget.value)} />
          </Field>
          <Field label="Entity type">
            <Input value={entityType} onChange={(event) => setEntityType(event.currentTarget.value)} />
          </Field>
          <Field label="Entity ID">
            <Input value={entityId} onChange={(event) => setEntityId(event.currentTarget.value)} />
          </Field>
          <Field label="Actor">
            <Input value={actor} onChange={(event) => setActor(event.currentTarget.value)} />
          </Field>
          <Field label="From">
            <Input type="date" value={from} onChange={(event) => setFrom(event.currentTarget.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(event) => setTo(event.currentTarget.value)} />
          </Field>
          <Field label="Limit">
            <Input value={limit} onChange={(event) => setLimit(event.currentTarget.value)} />
          </Field>
          <div className="flex items-end">
            <Button type="submit" variant="primary" className="w-full xl:w-auto" disabled={isLoading}>
              Apply filters
            </Button>
          </div>
        </form>
      </Panel>

      {error ? (
        <InlineAlert tone="danger" title="Audit events could not be loaded.">
          {error}
        </InlineAlert>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-2xl text-[var(--color-ink)]">Events</h2>
            <StatusBadge tone="info">{events.length} loaded</StatusBadge>
          </div>

          {events.length === 0 ? (
            <EmptyState
              title="No audit events"
              description="The current filters did not return any events. Broaden the query or wait for more workflow activity."
            />
          ) : (
            <div className={tableShellClassName}>
              <div className="overflow-x-auto">
                <table className={tableClassName}>
                  <thead>
                    <tr>
                      <th className={tableHeadCellClassName}>Time</th>
                      <th className={tableHeadCellClassName}>Event</th>
                      <th className={tableHeadCellClassName}>Entity</th>
                      <th className={tableHeadCellClassName}>Actor</th>
                      <th className={tableHeadCellClassName}>Inspect</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-line)]">
                    {events.map((event) => (
                      <tr
                        key={event.id}
                        className={cn(
                          "cursor-pointer transition hover:bg-[var(--color-soft-surface)]",
                          event.id === selectedEventId ? "bg-[var(--color-primary-soft)]" : ""
                        )}
                        onClick={() => setSelectedEventId(event.id)}
                      >
                        <td className={tableCellClassName}>{new Date(event.createdAt).toLocaleString()}</td>
                        <td className={tableCellClassName}>
                          <div className="space-y-1">
                            <p className="font-semibold text-[var(--color-ink)]">{event.eventType}</p>
                            <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">{event.id}</p>
                          </div>
                        </td>
                        <td className={tableCellClassName}>
                          {event.entityType}:{event.entityId}
                        </td>
                        <td className={tableCellClassName}>{event.actor}</td>
                        <td className={tableCellClassName}>
                          <Eye className="h-4 w-4 text-[var(--color-primary)]" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Panel>

        <Panel className="space-y-5">
          {!selectedEvent ? (
            <EmptyState
              title="Select an event"
              description="Choose an event from the audit list to inspect its entity, actor, and payload contents."
            />
          ) : (
            <>
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone="info">{selectedEvent.eventType}</StatusBadge>
                  <StatusBadge tone="neutral">{selectedEvent.entityType}</StatusBadge>
                </div>
                <div>
                  <h2 className="break-all font-display text-2xl text-[var(--color-ink)]">{selectedEvent.id}</h2>
                  <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                    {new Date(selectedEvent.createdAt).toLocaleString()} • actor {selectedEvent.actor}
                  </p>
                </div>
              </div>

              <SoftPanel className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Entity reference</p>
                <p className="break-all font-semibold text-[var(--color-ink)]">
                  {selectedEvent.entityType}:{selectedEvent.entityId}
                </p>
              </SoftPanel>

              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Payload summary</p>
                {selectedPayload.summaryEntries.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {selectedPayload.summaryEntries.map((entry) => (
                      <SoftPanel key={entry.keyPath} className="space-y-1.5">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                          {entry.label}
                        </p>
                        <p className="break-words text-sm font-semibold text-[var(--color-ink)]">{entry.value}</p>
                      </SoftPanel>
                    ))}
                  </div>
                ) : (
                  <SoftPanel>
                    <p className="text-sm text-[var(--color-muted)]">
                      This event does not expose a compact structured summary, so the full payload is shown below.
                    </p>
                  </SoftPanel>
                )}

                <details className="rounded-[1.5rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-[var(--color-ink)]">
                    Show full payload JSON
                  </summary>
                  <pre className="mt-4 max-h-[26rem] overflow-auto whitespace-pre-wrap break-words rounded-[1rem] bg-white/80 p-4 font-mono text-xs leading-6 text-[var(--color-muted)]">
                    {selectedPayload.formattedJson}
                  </pre>
                </details>
              </div>
            </>
          )}
        </Panel>
      </section>
    </div>
  );
}
