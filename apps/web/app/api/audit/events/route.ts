import { NextRequest, NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter, prepareStorage } from "@/lib/storage";

type AuditScope = "all" | "sycamore_async";

function startOfDayUtc(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function endOfDayUtc(date: string): number {
  return Date.parse(`${date}T23:59:59.999Z`);
}

function parseScope(value: string | null): AuditScope {
  return value === "sycamore_async" ? "sycamore_async" : "all";
}

function matchesScope(
  event: {
    eventType: string;
    entityType: string;
  },
  scope: AuditScope
): boolean {
  if (scope === "all") {
    return true;
  }

  return (
    event.eventType.startsWith("sycamore_sync_") ||
    event.entityType === "sycamore_sync_job" ||
    event.entityType === "sycamore_sync_batch"
  );
}

export async function GET(request: NextRequest) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const eventType = request.nextUrl.searchParams.get("eventType");
  const entityType = request.nextUrl.searchParams.get("entityType");
  const entityId = request.nextUrl.searchParams.get("entityId");
  const actor = request.nextUrl.searchParams.get("actor");
  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  const scope = parseScope(request.nextUrl.searchParams.get("scope"));
  const limitRaw = request.nextUrl.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 200;

  const storage = createStorageAdapter();
  await prepareStorage(storage);
  let events = await storage.auditEvents.list();

  events = events.filter((event) => matchesScope(event, scope));

  if (eventType) {
    events = events.filter((event) => event.eventType === eventType);
  }
  if (entityType) {
    events = events.filter((event) => event.entityType === entityType);
  }
  if (entityId) {
    events = events.filter((event) => event.entityId === entityId);
  }
  if (actor) {
    events = events.filter((event) => event.actor === actor);
  }

  const fromEpoch = from ? startOfDayUtc(from) : Number.NaN;
  const toEpoch = to ? endOfDayUtc(to) : Number.NaN;
  if (!Number.isNaN(fromEpoch)) {
    events = events.filter((event) => Date.parse(event.createdAt) >= fromEpoch);
  }
  if (!Number.isNaN(toEpoch)) {
    events = events.filter((event) => Date.parse(event.createdAt) <= toEpoch);
  }

  events.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const bounded = Number.isFinite(limit) ? events.slice(0, Math.max(1, Math.min(1000, Math.trunc(limit)))) : events.slice(0, 200);

  return NextResponse.json({ events: bounded, total: events.length });
}
