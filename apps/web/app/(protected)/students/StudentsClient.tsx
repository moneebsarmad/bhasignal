"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BellDot,
  ClipboardList,
  FolderKanban,
  RefreshCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Users
} from "lucide-react";

import {
  Button,
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
  tableShellClassName
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { getDemeritEscalationBand } from "@/lib/demerit-escalation";

interface StudentRow {
  id: string;
  fullName: string;
  grade: string;
  totalPoints: number;
  incidentCount: number;
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
    incidentDate: string | null;
    points: number;
    reason: string;
    comment: string;
    teacherName: string;
    authorName: string | null;
    resolution: string | null;
    sourceType: "manual_pdf" | "sycamore_api";
    level: number | null;
    violation: string | null;
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

type PageMode = "risk" | "directory" | "interventions" | "case_file";
type DetailTab = "overview" | "incidents" | "interventions" | "notifications" | "audit";
type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

const DEFAULT_SOURCE_TYPE = "sycamore_api";
const DAY_MS = 1000 * 60 * 60 * 24;

const PAGE_MODES: Array<{
  key: PageMode;
  label: string;
  description: string;
}> = [
  {
    key: "risk",
    label: "Risk",
    description: "Prioritize students with the strongest discipline pressure."
  },
  {
    key: "directory",
    label: "Directory",
    description: "Scan the full filtered roster in a compact table."
  },
  {
    key: "interventions",
    label: "Interventions",
    description: "Focus on students already carrying intervention history."
  },
  {
    key: "case_file",
    label: "Case File",
    description: "Read one student deeply without the directory competing for space."
  }
];

function statusTone(status: string): StatusTone {
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

function formatDate(value: string | null, fallback = "No recent incident"): string {
  if (!value) {
    return fallback;
  }
  return new Date(value).toLocaleDateString();
}

function latestStudentEpoch(rows: StudentRow[]): number {
  return rows.reduce((latest, row) => {
    const epoch = Date.parse(row.lastIncidentAt ?? "");
    return Number.isFinite(epoch) && epoch > latest ? epoch : latest;
  }, Number.NEGATIVE_INFINITY);
}

function isRecentStudent(row: StudentRow, referenceEpoch: number): boolean {
  if (!Number.isFinite(referenceEpoch) || !row.lastIncidentAt) {
    return false;
  }
  const epoch = Date.parse(row.lastIncidentAt);
  if (!Number.isFinite(epoch)) {
    return false;
  }
  return referenceEpoch - epoch <= DAY_MS * 14;
}

function studentPriority(row: StudentRow): number {
  return row.totalPoints * 100 + row.interventionCount * 20 + row.incidentCount;
}

function sortStudentsByRisk(left: StudentRow, right: StudentRow): number {
  if (studentPriority(right) !== studentPriority(left)) {
    return studentPriority(right) - studentPriority(left);
  }
  const rightLastIncident = right.lastIncidentAt ? Date.parse(right.lastIncidentAt) : 0;
  const leftLastIncident = left.lastIncidentAt ? Date.parse(left.lastIncidentAt) : 0;
  if (rightLastIncident !== leftLastIncident) {
    return rightLastIncident - leftLastIncident;
  }
  return left.fullName.localeCompare(right.fullName);
}

function sortStudentsAlphabetically(left: StudentRow, right: StudentRow): number {
  const gradeCompare = left.grade.localeCompare(right.grade, undefined, { numeric: true });
  if (gradeCompare !== 0) {
    return gradeCompare;
  }
  return left.fullName.localeCompare(right.fullName);
}

function sortStudentsByInterventionHistory(left: StudentRow, right: StudentRow): number {
  if (right.interventionCount !== left.interventionCount) {
    return right.interventionCount - left.interventionCount;
  }
  return sortStudentsByRisk(left, right);
}

function riskGroupForStudent(row: StudentRow): {
  title: string;
  tone: StatusTone;
  description: string;
} {
  if (row.totalPoints >= 20 || row.interventionCount >= 2) {
    return {
      title: "Immediate attention",
      tone: "danger",
      description: "High point totals or repeated intervention history."
    };
  }
  if (row.totalPoints >= 10 || row.interventionCount >= 1) {
    return {
      title: "Watchlist",
      tone: "warning",
      description: "At or above the first discipline threshold or already in intervention flow."
    };
  }
  return {
    title: "Emerging pattern",
    tone: "info",
    description: "Lower totals, but enough activity to keep visible."
  };
}

function DirectoryTable({
  rows,
  emptyTitle,
  emptyDescription,
  onOpenCase,
  selectedStudentId
}: {
  rows: StudentRow[];
  emptyTitle: string;
  emptyDescription: string;
  onOpenCase: (studentId: string, nextTab?: DetailTab) => void;
  selectedStudentId: string | null;
}) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className={tableShellClassName}>
      <div className="overflow-x-auto">
        <table className={tableClassName}>
          <thead>
            <tr>
              <th className={tableHeadCellClassName}>Student</th>
              <th className={tableHeadCellClassName}>Grade</th>
              <th className={tableHeadCellClassName}>Points</th>
              <th className={tableHeadCellClassName}>Incidents</th>
              <th className={tableHeadCellClassName}>Interventions</th>
              <th className={tableHeadCellClassName}>Last incident</th>
              <th className={tableHeadCellClassName}>Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {rows.map((student) => {
              const band = getDemeritEscalationBand(student.totalPoints);
              const isSelected = student.id === selectedStudentId;
              return (
                <tr key={student.id} className={cn(isSelected ? "bg-[var(--color-primary-soft)]/60" : "")}>
                  <td className={tableCellClassName}>
                    <div className="space-y-1">
                      <p className="font-semibold text-[var(--color-ink)]">{student.fullName}</p>
                      <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">{band.shortLabel}</p>
                    </div>
                  </td>
                  <td className={tableCellClassName}>Grade {student.grade}</td>
                  <td className={tableCellClassName}>{student.totalPoints}</td>
                  <td className={tableCellClassName}>{student.incidentCount}</td>
                  <td className={tableCellClassName}>{student.interventionCount}</td>
                  <td className={tableCellClassName}>{formatDate(student.lastIncidentAt)}</td>
                  <td className={tableCellClassName}>
                    <Button type="button" size="sm" onClick={() => onOpenCase(student.id)}>
                      Open case
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RiskLane({
  title,
  tone,
  description,
  rows,
  onOpenCase
}: {
  title: string;
  tone: StatusTone;
  description: string;
  rows: StudentRow[];
  onOpenCase: (studentId: string, nextTab?: DetailTab) => void;
}) {
  return (
    <Panel className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">{title}</p>
          <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">{description}</p>
        </div>
        <StatusBadge tone={tone}>{rows.length} students</StatusBadge>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">No students currently land in this lane.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((student) => {
            const band = getDemeritEscalationBand(student.totalPoints);
            const group = riskGroupForStudent(student);
            return (
              <SoftPanel key={student.id} className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[var(--color-ink)]">{student.fullName}</p>
                    <p className="mt-1 text-sm text-[var(--color-muted)]">
                      Grade {student.grade} • {student.incidentCount} incidents • {student.interventionCount} interventions
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <StatusBadge tone={group.tone}>{group.title}</StatusBadge>
                    <StatusBadge tone={band.tone}>{student.totalPoints} pts</StatusBadge>
                  </div>
                </div>

                <p className="text-sm text-[var(--color-muted)]">
                  {student.lastIncidentAt
                    ? `Last incident ${new Date(student.lastIncidentAt).toLocaleDateString()}`
                    : "No recent incident date"}
                </p>

                <div className="flex flex-wrap gap-3">
                  <Button type="button" size="sm" onClick={() => onOpenCase(student.id)}>
                    Open case
                  </Button>
                  {student.interventionCount > 0 ? (
                    <Button type="button" size="sm" variant="secondary" onClick={() => onOpenCase(student.id, "interventions")}>
                      Go to interventions
                    </Button>
                  ) : null}
                </div>
              </SoftPanel>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

export function StudentsClient() {
  const [draftSearch, setDraftSearch] = useState("");
  const [draftGrade, setDraftGrade] = useState("");
  const [draftSourceType, setDraftSourceType] = useState<"manual_pdf" | "sycamore_api">(DEFAULT_SOURCE_TYPE);
  const [appliedFilters, setAppliedFilters] = useState({
    search: "",
    grade: "",
    sourceType: DEFAULT_SOURCE_TYPE as "manual_pdf" | "sycamore_api"
  });
  const [pageMode, setPageMode] = useState<PageMode>("risk");
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [isLoading, setIsLoading] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isUpdatingIntervention, setIsUpdatingIntervention] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStudents = useCallback(async (nextFilters: typeof appliedFilters) => {
    setIsLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (nextFilters.search.trim()) {
      params.set("search", nextFilters.search.trim());
    }
    if (nextFilters.grade.trim()) {
      params.set("grade", nextFilters.grade.trim());
    }
    if (nextFilters.sourceType) {
      params.set("sourceType", nextFilters.sourceType);
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
  }, []);

  useEffect(() => {
    void loadStudents(appliedFilters);
  }, [appliedFilters, loadStudents]);

  useEffect(() => {
    async function loadDetail() {
      if (pageMode !== "case_file") {
        return;
      }
      if (!selectedStudentId) {
        setDetail(null);
        return;
      }
      setIsDetailLoading(true);
      const params = new URLSearchParams({ sourceType: appliedFilters.sourceType });
      const response = await fetch(`/api/students/${encodeURIComponent(selectedStudentId)}?${params.toString()}`, {
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
  }, [appliedFilters.sourceType, pageMode, selectedStudentId]);

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

    const params = new URLSearchParams({ sourceType: appliedFilters.sourceType });
    if (selectedStudentId) {
      const detailResponse = await fetch(`/api/students/${encodeURIComponent(selectedStudentId)}?${params.toString()}`, {
        cache: "no-store"
      });
      if (detailResponse.ok) {
        const detailBody = (await detailResponse.json()) as StudentDetail;
        setDetail(detailBody);
      }
    }
    await loadStudents(appliedFilters);
    setIsUpdatingIntervention(null);
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedFilters({
      search: draftSearch.trim(),
      grade: draftGrade.trim(),
      sourceType: draftSourceType
    });
  }

  function clearFilters() {
    setDraftSearch("");
    setDraftGrade("");
    setDraftSourceType(DEFAULT_SOURCE_TYPE);
    setAppliedFilters({
      search: "",
      grade: "",
      sourceType: DEFAULT_SOURCE_TYPE
    });
  }

  function openCaseFile(studentId: string, nextTab: DetailTab = "overview") {
    setSelectedStudentId(studentId);
    setDetailTab(nextTab);
    setPageMode("case_file");
  }

  function choosePageMode(nextMode: PageMode) {
    if (nextMode === "case_file" && !selectedStudentId && students[0]?.id) {
      setSelectedStudentId(students[0].id);
    }
    setPageMode(nextMode);
  }

  const selectedSummary = useMemo(
    () => students.find((student) => student.id === selectedStudentId) ?? null,
    [selectedStudentId, students]
  );

  const referenceEpoch = useMemo(() => latestStudentEpoch(students), [students]);
  const pageMetrics = useMemo(
    () => ({
      totalStudents: students.length,
      tenPlusStudents: students.filter((student) => student.totalPoints >= 10).length,
      studentsWithInterventions: students.filter((student) => student.interventionCount > 0).length,
      recentStudents: students.filter((student) => isRecentStudent(student, referenceEpoch)).length
    }),
    [referenceEpoch, students]
  );

  const directoryRows = useMemo(() => [...students].sort(sortStudentsAlphabetically), [students]);
  const riskRows = useMemo(
    () =>
      [...students]
        .filter((student) => student.totalPoints > 0 || student.interventionCount > 0 || student.incidentCount > 0)
        .sort(sortStudentsByRisk),
    [students]
  );
  const interventionRows = useMemo(
    () => [...students].filter((student) => student.interventionCount > 0).sort(sortStudentsByInterventionHistory),
    [students]
  );

  const criticalRows = useMemo(
    () => riskRows.filter((student) => student.totalPoints >= 20 || student.interventionCount >= 2),
    [riskRows]
  );
  const watchlistRows = useMemo(
    () =>
      riskRows.filter(
        (student) =>
          !(student.totalPoints >= 20 || student.interventionCount >= 2) &&
          (student.totalPoints >= 10 || student.interventionCount >= 1)
      ),
    [riskRows]
  );
  const emergingRows = useMemo(
    () =>
      riskRows.filter(
        (student) =>
          !(student.totalPoints >= 20 || student.interventionCount >= 2) &&
          !(student.totalPoints >= 10 || student.interventionCount >= 1)
      ),
    [riskRows]
  );

  const currentMode: (typeof PAGE_MODES)[number] =
    PAGE_MODES.find((mode) => mode.key === pageMode) ??
    PAGE_MODES[0] ?? {
      key: "risk",
      label: "Risk",
      description: "Prioritize students with the strongest discipline pressure."
    };
  const selectedBand = selectedSummary ? getDemeritEscalationBand(selectedSummary.totalPoints) : null;

  const caseFileSummary = useMemo(() => {
    if (!detail) {
      return null;
    }
    const activeInterventions = detail.interventions.filter((intervention) =>
      ["open", "in_progress", "overdue"].includes(intervention.status)
    ).length;
    const completedInterventions = detail.interventions.filter((intervention) => intervention.status === "completed").length;
    const queuedNotifications = detail.notifications.filter((notification) => notification.status === "queued").length;
    const sentNotifications = detail.notifications.filter((notification) => notification.status === "sent").length;
    const latestIncident = detail.incidents[0] ?? null;
    const latestAudit = detail.auditEvents[0] ?? null;
    return {
      activeInterventions,
      completedInterventions,
      queuedNotifications,
      sentNotifications,
      latestIncident,
      latestAudit
    };
  }, [detail]);

  const gradeOptions = useMemo(() => {
    const grades = [...new Set(students.map((student) => student.grade))].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true })
    );
    if (draftGrade && !grades.includes(draftGrade)) {
      grades.push(draftGrade);
    }
    return grades;
  }, [draftGrade, students]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Student workspace"
        title="Read students by mode, not by clutter"
        description="Switch between risk triage, directory search, intervention tracking, and a focused case file so the page matches the question you are trying to answer."
        actions={
          <Button
            type="button"
            variant="secondary"
            onClick={() => void loadStudents(appliedFilters)}
            disabled={isLoading}
          >
            <RefreshCcw className={cn("h-4 w-4", isLoading ? "animate-spin" : "")} />
            {isLoading ? "Refreshing..." : "Refresh"}
          </Button>
        }
      />

      {error ? (
        <InlineAlert tone="danger" title="Student data could not be loaded.">
          {error}
        </InlineAlert>
      ) : null}

      <Panel className="space-y-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
              Reading mode
            </p>
            <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">{currentMode.label}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--color-muted)]">{currentMode.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone="neutral">{pageMetrics.totalStudents} students</StatusBadge>
            <StatusBadge tone="warning">{pageMetrics.tenPlusStudents} at 10+ points</StatusBadge>
            <StatusBadge tone="info">{pageMetrics.studentsWithInterventions} with interventions</StatusBadge>
            <StatusBadge tone="neutral">{pageMetrics.recentStudents} recent incidents</StatusBadge>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 rounded-[1.4rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-2">
          {PAGE_MODES.map((mode) => (
            <button
              key={mode.key}
              type="button"
              className={cn(
                "rounded-full px-4 py-2 text-sm font-semibold transition",
                pageMode === mode.key
                  ? "bg-white text-[var(--color-ink)] shadow-card"
                  : "text-[var(--color-muted)] hover:bg-white/80 hover:text-[var(--color-ink)]"
              )}
              onClick={() => choosePageMode(mode.key)}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <form onSubmit={applyFilters} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_11rem_13rem_auto_auto]">
          <Field label="Search">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-subtle)]" />
              <Input
                className="pl-11"
                value={draftSearch}
                onChange={(event) => setDraftSearch(event.currentTarget.value)}
                placeholder="Name"
              />
            </div>
          </Field>
          <Field label="Grade">
            <Select value={draftGrade} onChange={(event) => setDraftGrade(event.currentTarget.value)}>
              <option value="">All grades</option>
              {gradeOptions.map((grade) => (
                <option key={grade} value={grade}>
                  Grade {grade}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dataset">
            <Select
              value={draftSourceType}
              onChange={(event) => setDraftSourceType(event.currentTarget.value as "manual_pdf" | "sycamore_api")}
            >
              <option value="sycamore_api">Sycamore primary</option>
              <option value="manual_pdf">PDF exception mode</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <Button type="submit" variant="primary" className="w-full lg:w-auto">
              Apply
            </Button>
          </div>
          <div className="flex items-end">
            <Button type="button" variant="secondary" className="w-full lg:w-auto" onClick={clearFilters}>
              Clear
            </Button>
          </div>
        </form>
      </Panel>

      {pageMode === "risk" ? (
        <div className="space-y-5">
          <Panel className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Risk view</p>
              <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Who needs attention now</h2>
              <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                Use this view for quick triage before drilling into a full case file.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone="danger">{criticalRows.length} immediate</StatusBadge>
              <StatusBadge tone="warning">{watchlistRows.length} watchlist</StatusBadge>
              <StatusBadge tone="info">{emergingRows.length} emerging</StatusBadge>
            </div>
          </Panel>

          {riskRows.length === 0 ? (
            <EmptyState
              title="No active students in this risk view"
              description="Adjust the filters or switch to the directory if you need the full filtered roster."
            />
          ) : (
            <section className="grid gap-5 xl:grid-cols-3">
              <RiskLane
                title="Immediate attention"
                tone="danger"
                description="Students with stronger pressure, larger totals, or repeated intervention history."
                rows={criticalRows}
                onOpenCase={openCaseFile}
              />
              <RiskLane
                title="Watchlist"
                tone="warning"
                description="Students at the first threshold or already touching intervention workflow."
                rows={watchlistRows}
                onOpenCase={openCaseFile}
              />
              <RiskLane
                title="Emerging patterns"
                tone="info"
                description="Students showing enough activity to stay visible before they escalate."
                rows={emergingRows}
                onOpenCase={openCaseFile}
              />
            </section>
          )}
        </div>
      ) : null}

      {pageMode === "directory" ? (
        <Panel className="space-y-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                Directory
              </p>
              <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Compact roster view</h2>
            </div>
            <StatusBadge tone="info">{directoryRows.length} matching students</StatusBadge>
          </div>

          <DirectoryTable
            rows={directoryRows}
            emptyTitle="No students found"
            emptyDescription="Adjust the filters to bring students back into the directory."
            onOpenCase={openCaseFile}
            selectedStudentId={selectedStudentId}
          />
        </Panel>
      ) : null}

      {pageMode === "interventions" ? (
        <Panel className="space-y-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                Intervention view
              </p>
              <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Students with intervention history</h2>
              <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                This is the student-level entry point. Open the case file to update statuses or read intervention notes.
              </p>
            </div>
            <StatusBadge tone="warning">{interventionRows.length} students</StatusBadge>
          </div>

          <DirectoryTable
            rows={interventionRows}
            emptyTitle="No intervention history"
            emptyDescription="No students in this slice currently carry intervention records."
            onOpenCase={(studentId) => openCaseFile(studentId, "interventions")}
            selectedStudentId={selectedStudentId}
          />
        </Panel>
      ) : null}

      {pageMode === "case_file" ? (
        <Panel className="space-y-5">
          {isDetailLoading ? (
            <div className="grid gap-5 md:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="h-28 animate-pulse rounded-[1.5rem] border border-white/80 bg-white/80 shadow-card"
                />
              ))}
            </div>
          ) : null}

          {!isDetailLoading && !detail ? (
            <EmptyState
              title="No student selected"
              description="Open a student from Risk, Directory, or Interventions to move into a focused case file."
              action={
                <Button type="button" variant="primary" onClick={() => setPageMode("risk")}>
                  Go to risk view
                </Button>
              }
            />
          ) : null}

          {detail ? (
            <>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                    Case file
                  </p>
                  <div>
                    <h2 className="font-display text-4xl text-[var(--color-ink)]">{detail.student.fullName}</h2>
                    <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                      Grade {detail.student.grade}
                      {detail.student.externalId ? ` • External ID ${detail.student.externalId}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedBand ? <StatusBadge tone={selectedBand.tone}>{selectedBand.label}</StatusBadge> : null}
                  {selectedSummary ? (
                    <StatusBadge tone={selectedSummary.totalPoints > 0 ? "warning" : "neutral"}>
                      {selectedSummary.totalPoints} total points
                    </StatusBadge>
                  ) : null}
                  <Button type="button" variant="secondary" onClick={() => setPageMode("risk")}>
                    Back to risk
                  </Button>
                </div>
              </div>

              <section className="grid gap-4 md:grid-cols-4">
                <SoftPanel className="space-y-2">
                  <div className="flex items-center gap-2 text-[var(--color-primary)]">
                    <AlertTriangle className="h-4 w-4" />
                    <p className="text-sm font-semibold text-[var(--color-ink)]">Points</p>
                  </div>
                  <p className="font-display text-3xl text-[var(--color-ink)]">{selectedSummary?.totalPoints ?? 0}</p>
                  <p className="text-sm text-[var(--color-muted)]">
                    Current pressure level for the selected student.
                  </p>
                </SoftPanel>
                <SoftPanel className="space-y-2">
                  <div className="flex items-center gap-2 text-[var(--color-primary)]">
                    <ClipboardList className="h-4 w-4" />
                    <p className="text-sm font-semibold text-[var(--color-ink)]">Incidents</p>
                  </div>
                  <p className="font-display text-3xl text-[var(--color-ink)]">{detail.incidents.length}</p>
                  <p className="text-sm text-[var(--color-muted)]">Synced incident history in the active dataset.</p>
                </SoftPanel>
                <SoftPanel className="space-y-2">
                  <div className="flex items-center gap-2 text-[var(--color-primary)]">
                    <ShieldCheck className="h-4 w-4" />
                    <p className="text-sm font-semibold text-[var(--color-ink)]">Active interventions</p>
                  </div>
                  <p className="font-display text-3xl text-[var(--color-ink)]">{caseFileSummary?.activeInterventions ?? 0}</p>
                  <p className="text-sm text-[var(--color-muted)]">
                    Open, in-progress, or overdue intervention tasks.
                  </p>
                </SoftPanel>
                <SoftPanel className="space-y-2">
                  <div className="flex items-center gap-2 text-[var(--color-primary)]">
                    <BellDot className="h-4 w-4" />
                    <p className="text-sm font-semibold text-[var(--color-ink)]">Queued notifications</p>
                  </div>
                  <p className="font-display text-3xl text-[var(--color-ink)]">{caseFileSummary?.queuedNotifications ?? 0}</p>
                  <p className="text-sm text-[var(--color-muted)]">Messages still waiting to be sent.</p>
                </SoftPanel>
              </section>

              <div className="flex flex-wrap gap-2 rounded-[1.4rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-2">
                {[
                  { key: "overview" as const, label: "Overview" },
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

              {detailTab === "overview" ? (
                <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
                  <SoftPanel className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-primary)]">
                          Latest incident
                        </p>
                        <h3 className="mt-2 font-display text-2xl text-[var(--color-ink)]">
                          {caseFileSummary?.latestIncident?.reason ?? "No incidents"}
                        </h3>
                      </div>
                      {caseFileSummary?.latestIncident ? (
                        <StatusBadge
                          tone={caseFileSummary.latestIncident.points > 0 ? "warning" : "neutral"}
                        >
                          {caseFileSummary.latestIncident.points} pts
                        </StatusBadge>
                      ) : null}
                    </div>
                    {caseFileSummary?.latestIncident ? (
                      <>
                        <p className="text-sm text-[var(--color-muted)]">
                          {new Date(caseFileSummary.latestIncident.occurredAt).toLocaleString()} •{" "}
                          {caseFileSummary.latestIncident.authorName ||
                            caseFileSummary.latestIncident.teacherName ||
                            "Unknown staff"}
                        </p>
                        {caseFileSummary.latestIncident.comment ? (
                          <p className="text-sm leading-7 text-[var(--color-muted)]">
                            {caseFileSummary.latestIncident.comment}
                          </p>
                        ) : null}
                        <Button type="button" size="sm" onClick={() => setDetailTab("incidents")}>
                          Open incidents
                        </Button>
                      </>
                    ) : (
                      <p className="text-sm text-[var(--color-muted)]">
                        No incident history is available for this student in the active dataset.
                      </p>
                    )}
                  </SoftPanel>

                  <div className="grid gap-5">
                    <SoftPanel className="space-y-3">
                      <div className="flex items-center gap-2 text-[var(--color-primary)]">
                        <FolderKanban className="h-4 w-4" />
                        <p className="text-sm font-semibold text-[var(--color-ink)]">Follow-through posture</p>
                      </div>
                      <p className="text-sm text-[var(--color-muted)]">
                        {caseFileSummary?.activeInterventions ?? 0} active • {caseFileSummary?.completedInterventions ?? 0} completed
                      </p>
                      <Button type="button" size="sm" variant="secondary" onClick={() => setDetailTab("interventions")}>
                        Open interventions
                      </Button>
                    </SoftPanel>

                    <SoftPanel className="space-y-3">
                      <div className="flex items-center gap-2 text-[var(--color-primary)]">
                        <Sparkles className="h-4 w-4" />
                        <p className="text-sm font-semibold text-[var(--color-ink)]">Notification posture</p>
                      </div>
                      <p className="text-sm text-[var(--color-muted)]">
                        {caseFileSummary?.sentNotifications ?? 0} sent • {caseFileSummary?.queuedNotifications ?? 0} queued
                      </p>
                      <Button type="button" size="sm" variant="secondary" onClick={() => setDetailTab("notifications")}>
                        Open notifications
                      </Button>
                    </SoftPanel>

                    <SoftPanel className="space-y-3">
                      <div className="flex items-center gap-2 text-[var(--color-primary)]">
                        <Users className="h-4 w-4" />
                        <p className="text-sm font-semibold text-[var(--color-ink)]">Latest audit event</p>
                      </div>
                      <p className="text-sm text-[var(--color-muted)]">
                        {caseFileSummary?.latestAudit
                          ? `${caseFileSummary.latestAudit.eventType} • ${new Date(caseFileSummary.latestAudit.createdAt).toLocaleString()}`
                          : "No audit event is attached to this student yet."}
                      </p>
                      <Button type="button" size="sm" variant="secondary" onClick={() => setDetailTab("audit")}>
                        Open audit
                      </Button>
                    </SoftPanel>
                  </div>
                </div>
              ) : null}

              {detailTab === "incidents" ? (
                <div className="grid gap-4">
                  {detail.incidents.length === 0 ? (
                    <EmptyState
                      title="No incidents recorded"
                      description="This student does not currently have any synced incidents in the active dataset."
                    />
                  ) : (
                    detail.incidents.slice(0, 10).map((incident) => (
                      <SoftPanel key={incident.id} className="space-y-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="font-semibold text-[var(--color-ink)]">{incident.reason}</p>
                            <p className="mt-1 text-sm text-[var(--color-muted)]">
                              {new Date(incident.occurredAt).toLocaleString()} •{" "}
                              {incident.authorName || incident.teacherName || "Unknown staff"}
                              {incident.level !== null ? ` • Level ${incident.level}` : ""}
                            </p>
                          </div>
                          <StatusBadge tone={incident.points > 0 ? "warning" : "neutral"}>
                            {incident.points} pts
                          </StatusBadge>
                        </div>
                        {incident.violation && incident.violation !== incident.reason ? (
                          <p className="text-sm leading-7 text-[var(--color-muted)]">{incident.violation}</p>
                        ) : null}
                        {incident.comment ? (
                          <p className="text-sm leading-7 text-[var(--color-muted)]">{incident.comment}</p>
                        ) : null}
                        {incident.resolution ? (
                          <p className="text-sm leading-7 text-[var(--color-muted)]">
                            Resolution: {incident.resolution}
                          </p>
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
                      description="Once policy evaluation creates intervention tasks, they will appear here."
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
                      description="Queued and sent notifications for this student will appear here once actions are dispatched."
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
                      description="System activity for this student will appear here as events accumulate."
                    />
                  ) : (
                    detail.auditEvents.slice(0, 10).map((event) => (
                      <SoftPanel key={event.id} className="space-y-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="font-semibold text-[var(--color-ink)]">{event.eventType}</p>
                            <p className="mt-1 text-sm text-[var(--color-muted)]">
                              {new Date(event.createdAt).toLocaleString()}
                            </p>
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
      ) : null}
    </div>
  );
}
