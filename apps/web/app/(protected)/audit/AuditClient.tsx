"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
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

interface AuditEventRow {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  actor: string;
  payloadJson: string;
  createdAt: string;
}

export function AuditClient() {
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

  const loadEvents = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (eventType.trim()) {
      params.set("eventType", eventType.trim());
    }
    if (entityType.trim()) {
      params.set("entityType", entityType.trim());
    }
    if (entityId.trim()) {
      params.set("entityId", entityId.trim());
    }
    if (actor.trim()) {
      params.set("actor", actor.trim());
    }
    if (from) {
      params.set("from", from);
    }
    if (to) {
      params.set("to", to);
    }
    params.set("limit", limit);

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
  }, [actor, entityId, entityType, eventType, from, limit, to]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  function onApplyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadEvents();
  }

  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? null;

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
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Filters</p>
          <h2 className="font-display text-3xl text-[var(--color-ink)]">Narrow the audit view</h2>
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
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Event list</p>
              <h2 className="font-display text-3xl text-[var(--color-ink)]">{events.length} events in scope</h2>
            </div>
            <StatusBadge tone="info">{limit} max rows</StatusBadge>
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
                  <h2 className="font-display text-3xl text-[var(--color-ink)]">{selectedEvent.id}</h2>
                  <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                    {new Date(selectedEvent.createdAt).toLocaleString()} • actor {selectedEvent.actor}
                  </p>
                </div>
              </div>

              <SoftPanel className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Entity reference</p>
                <p className="font-semibold text-[var(--color-ink)]">
                  {selectedEvent.entityType}:{selectedEvent.entityId}
                </p>
              </SoftPanel>

              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Payload</p>
                <pre className="overflow-x-auto rounded-[1.5rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4 font-mono text-xs leading-6 text-[var(--color-muted)]">
                  {selectedEvent.payloadJson}
                </pre>
              </div>
            </>
          )}
        </Panel>
      </section>
    </div>
  );
}
