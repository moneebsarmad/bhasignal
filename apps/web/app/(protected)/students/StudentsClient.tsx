"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BellDot, ClipboardList, RefreshCcw, Search, ShieldCheck } from "lucide-react";

import {
  Button,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  PageHeader,
  Panel,
  SoftPanel,
  StatusBadge
} from "@/components/ui";
import { cn } from "@/lib/cn";

interface StudentRow {
  id: string;
  fullName: string;
  grade: string;
  totalPoints: number;
  interventionCount: number;
  lastIncidentAt: string | null;
}

interface StudentDetail {
  student: {
    id: string;
    fullName: string;
    grade: string;
    externalId: string | null;
  };
  incidents: Array<{
    id: string;
    occurredAt: string;
    points: number;
    reason: string;
    comment: string;
    teacherName: string;
  }>;
  interventions: Array<{
    id: string;
    milestoneLabel: string;
    status: string;
    dueDate: string;
    notes: string;
    assignedTo: string | null;
  }>;
  notifications: Array<{
    id: string;
    status: string;
    recipient: string;
    sentAt: string | null;
  }>;
  auditEvents: Array<{
    id: string;
    eventType: string;
    createdAt: string;
    actor: string;
  }>;
}

type DetailTab = "incidents" | "interventions" | "notifications" | "audit";

function statusTone(status: string): "neutral" | "info" | "success" | "warning" | "danger" {
  if (status.includes("completed") || status.includes("sent")) {
    return "success";
  }
  if (status.includes("in_progress")) {
    return "info";
  }
  if (status.includes("queued") || status.includes("pending")) {
    return "warning";
  }
  if (status.includes("failed") || status.includes("overdue")) {
    return "danger";
  }
  return "neutral";
}

export function StudentsClient() {
  const [search, setSearch] = useState("");
  const [grade, setGrade] = useState("");
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("incidents");
  const [isLoading, setIsLoading] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isUpdatingIntervention, setIsUpdatingIntervention] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStudents = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (search.trim()) {
      params.set("search", search.trim());
    }
    if (grade.trim()) {
      params.set("grade", grade.trim());
    }

    const response = await fetch(`/api/students?${params.toString()}`, { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as
      | { students?: StudentRow[]; error?: string }
      | null;
    if (!response.ok) {
      setError(body?.error || "Failed to load students.");
      setIsLoading(false);
      return;
    }

    const rows = body?.students ?? [];
    setStudents(rows);
    setIsLoading(false);
    if (rows.length > 0) {
      const firstStudentId = rows[0]?.id ?? null;
      setSelectedStudentId((current) => (current && rows.some((row) => row.id === current) ? current : firstStudentId));
    } else {
      setSelectedStudentId(null);
    }
  }, [grade, search]);

  useEffect(() => {
    void loadStudents();
  }, [loadStudents]);

  useEffect(() => {
    async function loadDetail() {
      if (!selectedStudentId) {
        setDetail(null);
        return;
      }
      setIsDetailLoading(true);
      const response = await fetch(`/api/students/${encodeURIComponent(selectedStudentId)}`, {
        cache: "no-store"
      });
      const body = (await response.json().catch(() => null)) as StudentDetail | { error?: string } | null;
      if (!response.ok) {
        setError((body as { error?: string } | null)?.error || "Failed to load student detail.");
        setIsDetailLoading(false);
        return;
      }
      setDetail(body as StudentDetail);
      setIsDetailLoading(false);
    }

    void loadDetail();
  }, [selectedStudentId]);

  async function updateInterventionStatus(interventionId: string, status: string) {
    setIsUpdatingIntervention(interventionId);
    const response = await fetch(`/api/interventions/${encodeURIComponent(interventionId)}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setError(body?.error || "Failed to update intervention status.");
      setIsUpdatingIntervention(null);
      return;
    }

    if (selectedStudentId) {
      const detailResponse = await fetch(`/api/students/${encodeURIComponent(selectedStudentId)}`, {
        cache: "no-store"
      });
      if (detailResponse.ok) {
        const detailBody = (await detailResponse.json()) as StudentDetail;
        setDetail(detailBody);
      }
    }
    setIsUpdatingIntervention(null);
  }

  const selectedSummary = useMemo(
    () => students.find((student) => student.id === selectedStudentId) ?? null,
    [selectedStudentId, students]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Student tracking"
        title="Search students and inspect intervention history"
        description="Use the list on the left to jump between students, then work through incidents, interventions, notifications, and audit context without losing place."
        actions={
          <Button type="button" variant="secondary" onClick={() => void loadStudents()} disabled={isLoading}>
            <RefreshCcw className={cn("h-4 w-4", isLoading ? "animate-spin" : "")} />
            {isLoading ? "Refreshing..." : "Refresh list"}
          </Button>
        }
      />

      {error ? (
        <InlineAlert tone="danger" title="Student data could not be loaded.">
          {error}
        </InlineAlert>
      ) : null}

      <Panel className="space-y-5">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Directory filter</p>
            <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Find the right student fast</h2>
          </div>
          <p className="max-w-xl text-sm leading-7 text-[var(--color-muted)]">
            Filter by name or grade, then use the profile workspace to understand history and act on intervention state.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_16rem_auto]">
          <Field label="Search">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-subtle)]" />
              <Input className="pl-11" value={search} onChange={(event) => setSearch(event.currentTarget.value)} />
            </div>
          </Field>
          <Field label="Grade">
            <Input value={grade} onChange={(event) => setGrade(event.currentTarget.value)} />
          </Field>
          <div className="flex items-end">
            <Button type="button" variant="primary" className="w-full xl:w-auto" onClick={() => void loadStudents()}>
              Apply
            </Button>
          </div>
        </div>
      </Panel>

      <section className="grid gap-5 xl:grid-cols-[24rem_minmax(0,1fr)]">
        <Panel className="overflow-hidden p-0">
          <div className="border-b border-[var(--color-line)] px-5 py-5">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Student list</p>
            <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">{students.length} students in view</h2>
          </div>

          {students.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No students found"
                description="Adjust the search or grade filters to bring students back into the active list."
              />
            </div>
          ) : (
            <div className="max-h-[68vh] divide-y divide-[var(--color-line)] overflow-y-auto">
              {students.map((student) => {
                const isSelected = student.id === selectedStudentId;
                return (
                  <button
                    key={student.id}
                    type="button"
                    className={cn(
                      "flex w-full flex-col gap-3 px-5 py-4 text-left transition",
                      isSelected ? "bg-[var(--color-primary-soft)]" : "hover:bg-[var(--color-soft-surface)]"
                    )}
                    onClick={() => setSelectedStudentId(student.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-[var(--color-ink)]">{student.fullName}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">
                          Grade {student.grade}
                        </p>
                      </div>
                      <StatusBadge tone={student.totalPoints > 0 ? "warning" : "neutral"}>
                        {student.totalPoints} pts
                      </StatusBadge>
                    </div>
                    <p className="text-sm leading-6 text-[var(--color-muted)]">
                      {student.interventionCount} interventions
                      {student.lastIncidentAt ? ` • last incident ${new Date(student.lastIncidentAt).toLocaleDateString()}` : ""}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel className="space-y-5">
          {isDetailLoading ? (
            <div className="grid gap-5 md:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="h-36 animate-pulse rounded-[1.5rem] border border-white/80 bg-white/80 shadow-card"
                />
              ))}
            </div>
          ) : null}

          {!isDetailLoading && !detail ? (
            <EmptyState
              title="Select a student"
              description="Choose a student from the directory to inspect recent incidents, active interventions, notifications, and audit history."
            />
          ) : null}

          {detail ? (
            <>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Profile</p>
                  <div>
                    <h2 className="font-display text-4xl text-[var(--color-ink)]">{detail.student.fullName}</h2>
                    <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                      Grade {detail.student.grade}
                      {detail.student.externalId ? ` • External ID ${detail.student.externalId}` : ""}
                    </p>
                  </div>
                </div>
                {selectedSummary ? (
                  <StatusBadge tone={selectedSummary.totalPoints > 0 ? "warning" : "neutral"}>
                    {selectedSummary.totalPoints} total points
                  </StatusBadge>
                ) : null}
              </div>

              <section className="grid gap-5 md:grid-cols-3">
                <SoftPanel className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-[var(--color-primary-soft)] p-2 text-[var(--color-primary)]">
                      <ClipboardList className="h-4 w-4" />
                    </div>
                    <p className="text-sm font-semibold text-[var(--color-ink)]">Incidents</p>
                  </div>
                  <p className="font-display text-3xl text-[var(--color-ink)]">{detail.incidents.length}</p>
                  <p className="text-sm leading-7 text-[var(--color-muted)]">Recent merits and demerits attached to this student timeline.</p>
                </SoftPanel>
                <SoftPanel className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-[var(--color-primary-soft)] p-2 text-[var(--color-primary)]">
                      <ShieldCheck className="h-4 w-4" />
                    </div>
                    <p className="text-sm font-semibold text-[var(--color-ink)]">Interventions</p>
                  </div>
                  <p className="font-display text-3xl text-[var(--color-ink)]">{detail.interventions.length}</p>
                  <p className="text-sm leading-7 text-[var(--color-muted)]">Open, in-progress, and completed policy-driven interventions.</p>
                </SoftPanel>
                <SoftPanel className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-[var(--color-primary-soft)] p-2 text-[var(--color-primary)]">
                      <BellDot className="h-4 w-4" />
                    </div>
                    <p className="text-sm font-semibold text-[var(--color-ink)]">Notifications</p>
                  </div>
                  <p className="font-display text-3xl text-[var(--color-ink)]">{detail.notifications.length}</p>
                  <p className="text-sm leading-7 text-[var(--color-muted)]">Delivery history associated with this student’s intervention path.</p>
                </SoftPanel>
              </section>

              <div className="flex flex-wrap gap-2 rounded-[1.4rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-2">
                {[
                  { key: "incidents" as const, label: "Incidents" },
                  { key: "interventions" as const, label: "Interventions" },
                  { key: "notifications" as const, label: "Notifications" },
                  { key: "audit" as const, label: "Audit" }
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    className={cn(
                      "rounded-full px-4 py-2 text-sm font-semibold transition",
                      detailTab === tab.key
                        ? "bg-white text-[var(--color-ink)] shadow-card"
                        : "text-[var(--color-muted)] hover:bg-white/80 hover:text-[var(--color-ink)]"
                    )}
                    onClick={() => setDetailTab(tab.key)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {detailTab === "incidents" ? (
                <div className="grid gap-4">
                  {detail.incidents.length === 0 ? (
                    <EmptyState
                      title="No incidents recorded"
                      description="This student does not currently have any incidents in the selected data set."
                    />
                  ) : (
                    detail.incidents.slice(0, 10).map((incident) => (
                      <SoftPanel key={incident.id} className="space-y-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="font-semibold text-[var(--color-ink)]">{incident.reason}</p>
                            <p className="mt-1 text-sm text-[var(--color-muted)]">
                              {new Date(incident.occurredAt).toLocaleString()} • {incident.teacherName || "Unknown teacher"}
                            </p>
                          </div>
                          <StatusBadge tone={incident.points > 0 ? "warning" : "neutral"}>{incident.points} pts</StatusBadge>
                        </div>
                        {incident.comment ? (
                          <p className="text-sm leading-7 text-[var(--color-muted)]">{incident.comment}</p>
                        ) : null}
                      </SoftPanel>
                    ))
                  )}
                </div>
              ) : null}

              {detailTab === "interventions" ? (
                <div className="grid gap-4">
                  {detail.interventions.length === 0 ? (
                    <EmptyState
                      title="No interventions yet"
                      description="Once policy evaluation creates intervention tasks, they will appear here with status controls."
                    />
                  ) : (
                    detail.interventions.slice(0, 10).map((intervention) => (
                      <SoftPanel key={intervention.id} className="space-y-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <p className="font-semibold text-[var(--color-ink)]">{intervention.milestoneLabel}</p>
                            <p className="mt-1 text-sm text-[var(--color-muted)]">
                              Due {new Date(intervention.dueDate).toLocaleDateString()}
                              {intervention.assignedTo ? ` • Assigned to ${intervention.assignedTo}` : ""}
                            </p>
                          </div>
                          <StatusBadge tone={statusTone(intervention.status)}>{intervention.status}</StatusBadge>
                        </div>
                        {intervention.notes ? (
                          <p className="text-sm leading-7 text-[var(--color-muted)]">{intervention.notes}</p>
                        ) : null}
                        <div className="flex flex-wrap gap-3">
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={isUpdatingIntervention === intervention.id}
                            onClick={() => void updateInterventionStatus(intervention.id, "in_progress")}
                          >
                            In progress
                          </Button>
                          <Button
                            type="button"
                            variant="primary"
                            disabled={isUpdatingIntervention === intervention.id}
                            onClick={() => void updateInterventionStatus(intervention.id, "completed")}
                          >
                            Complete
                          </Button>
                        </div>
                      </SoftPanel>
                    ))
                  )}
                </div>
              ) : null}

              {detailTab === "notifications" ? (
                <div className="grid gap-4">
                  {detail.notifications.length === 0 ? (
                    <EmptyState
                      title="No notifications yet"
                      description="Queued and sent notifications for this student will appear here once policy actions are dispatched."
                    />
                  ) : (
                    detail.notifications.slice(0, 10).map((notification) => (
                      <SoftPanel key={notification.id} className="space-y-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="font-semibold text-[var(--color-ink)]">{notification.recipient}</p>
                            <p className="mt-1 text-sm text-[var(--color-muted)]">
                              {notification.sentAt ? new Date(notification.sentAt).toLocaleString() : "Not sent yet"}
                            </p>
                          </div>
                          <StatusBadge tone={statusTone(notification.status)}>{notification.status}</StatusBadge>
                        </div>
                      </SoftPanel>
                    ))
                  )}
                </div>
              ) : null}

              {detailTab === "audit" ? (
                <div className="grid gap-4">
                  {detail.auditEvents.length === 0 ? (
                    <EmptyState
                      title="No audit events"
                      description="System activity for this student will appear here as ingestion, review, policy, and notification events accumulate."
                    />
                  ) : (
                    detail.auditEvents.slice(0, 10).map((event) => (
                      <SoftPanel key={event.id} className="space-y-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="font-semibold text-[var(--color-ink)]">{event.eventType}</p>
                            <p className="mt-1 text-sm text-[var(--color-muted)]">{new Date(event.createdAt).toLocaleString()}</p>
                          </div>
                          <StatusBadge tone="neutral">{event.actor}</StatusBadge>
                        </div>
                      </SoftPanel>
                    ))
                  )}
                </div>
              ) : null}
            </>
          ) : null}
        </Panel>
      </section>
    </div>
  );
}
