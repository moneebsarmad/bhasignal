import type { IngestionSourceType } from "@syc/domain";
import type { StorageRepositories } from "@syc/storage";

import { listDisciplineEvents, type DisciplineEventRecord } from "@/lib/discipline-events";
import {
  demeritEscalationBands,
  escalationBandOptions,
  getDemeritEscalationBand,
  type DemeritEscalationBandId
} from "@/lib/demerit-escalation";

export interface AnalyticsFilters {
  grade?: string;
  from?: string;
  to?: string;
  sourceType?: IngestionSourceType;
  student?: string;
  violation?: string;
  author?: string;
  thresholdBand?: DemeritEscalationBandId;
}

export interface AnalyticsSummaryMetric {
  label: string;
  value: number;
  description: string;
}

export interface AnalyticsTrendRow {
  period: string;
  incidentCount: number;
  totalPoints: number;
}

export interface AnalyticsStudentRow {
  studentId: string;
  fullName: string;
  grade: string;
  incidentCount: number;
  totalPoints: number;
  currentTotalPoints: number;
  currentBandId: DemeritEscalationBandId;
  currentBandLabel: string;
  latestIncidentAt: string | null;
  activeInterventions: number;
  queuedNotifications: number;
  failedNotifications: number;
}

export interface AnalyticsThresholdPressureRow {
  bandId: string;
  label: string;
  shortLabel: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
  studentCount: number;
  share: number;
  enteredCount: number;
}

export interface AnalyticsGradePressureRow {
  grade: string;
  activeStudents: number;
  studentsInvolved: number;
  incidentCount: number;
  totalPoints: number;
  incidentsPer100: number;
  pointsPer100: number;
  escalatedStudents: number;
  criticalStudents: number;
}

export interface AnalyticsSeverityMixRow {
  key: "low" | "medium" | "high";
  label: string;
  tone: "neutral" | "info" | "warning" | "danger";
  incidentCount: number;
  totalPoints: number;
  incidentShare: number;
  pointShare: number;
}

export interface AnalyticsRepeatIncidentMetric {
  studentsWithIncidents: number;
  repeat14Count: number;
  repeat14Rate: number;
  repeat30Count: number;
  repeat30Rate: number;
  sameBehavior30Count: number;
  sameBehavior30Rate: number;
}

export interface AnalyticsConcentrationMetric {
  studentsWithPoints: number;
  topDecileStudents: number;
  topDecileShare: number;
  topThreeShare: number;
  medianPoints: number | null;
  profile: string;
}

export interface AnalyticsBehaviorShiftRow {
  behavior: string;
  currentIncidents: number;
  previousIncidents: number;
  deltaIncidents: number;
  deltaPercent: number | null;
  currentStudents: number;
  currentPoints: number;
  trend: "up" | "down" | "flat";
}

export interface AnalyticsHotspotRow {
  label: string;
  weekday: string;
  timeBlock: string;
  incidentCount: number;
  totalPoints: number;
}

export interface AnalyticsInterventionHealthMetric {
  activeCount: number;
  overdueCount: number;
  completedCount: number;
  completedOnTimeCount: number;
  completedOnTimeRate: number;
  medianCompletedLateDays: number | null;
  medianActiveOverdueDays: number | null;
}

export interface AnalyticsReentryRow {
  days: 14 | 30 | 45;
  reentryCount: number;
  reentryRate: number;
}

export interface AnalyticsPostInterventionMetric {
  completedInterventions: number;
  rows: AnalyticsReentryRow[];
}

export interface AnalyticsNarrativeThemeRow {
  theme: string;
  incidentCount: number;
  uniqueStudents: number;
  share: number;
}

export interface AnalyticsComparisonWindow {
  current: {
    from: string;
    to: string;
    label: string;
  };
  previous: {
    from: string;
    to: string;
    label: string;
  };
  spanDays: number;
  usedDefaultWindow: boolean;
}

export interface AnalyticsSnapshot {
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
  comparisonWindow: AnalyticsComparisonWindow;
  availableFilters: {
    grades: string[];
    violations: string[];
    authors: string[];
    thresholdBands: Array<{ id: string; label: string }>;
  };
  summary: AnalyticsSummaryMetric[];
  trend: AnalyticsTrendRow[];
  thresholdPressure: {
    escalatedStudents: number;
    criticalStudents: number;
    crossedIntoHigherBand: number;
    rows: AnalyticsThresholdPressureRow[];
  };
  gradePressureRows: AnalyticsGradePressureRow[];
  severityMix: {
    averagePointsPerIncident: number;
    highSeverityShare: number;
    rows: AnalyticsSeverityMixRow[];
  };
  repeatIncident: AnalyticsRepeatIncidentMetric;
  concentration: AnalyticsConcentrationMetric;
  behaviorShiftRows: AnalyticsBehaviorShiftRow[];
  hotspotTiming: {
    timedIncidentCount: number;
    timeCoverageRate: number;
    rows: AnalyticsHotspotRow[];
  };
  interventionHealth: AnalyticsInterventionHealthMetric;
  postIntervention: AnalyticsPostInterventionMetric;
  narrativeThemeRows: AnalyticsNarrativeThemeRow[];
  studentRows: AnalyticsStudentRow[];
  interventionStatus: Record<string, number>;
  notificationStatus: Record<string, number>;
  narrative: string;
}

interface DateWindow {
  fromEpoch: number;
  toEpoch: number;
  from: string;
  to: string;
  label: string;
}

interface ComputedComparisonWindow {
  current: DateWindow;
  previous: DateWindow;
  spanDays: number;
  usedDefaultWindow: boolean;
}

interface StudentAggregate {
  studentId: string;
  localStudentId: string | null;
  fullName: string;
  grade: string;
  incidentCount: number;
  totalPoints: number;
  latestIncidentAt: string | null;
}

interface ThemeDefinition {
  label: string;
  keywords: string[];
}

type TrendBucketMode = "day" | "week" | "month";

const DEFAULT_SOURCE_TYPE: IngestionSourceType = "sycamore_api";
const DAY_MS = 1000 * 60 * 60 * 24;
const DEFAULT_WINDOW_DAYS = 30;

const BEHAVIOR_THEME_DEFINITIONS: ThemeDefinition[] = [
  {
    label: "Disrespect / defiance",
    keywords: ["disrespect", "defiance", "insubordination", "noncompliance", "refused", "talking back", "rude"]
  },
  {
    label: "Class disruption",
    keywords: ["disruption", "disruptive", "horseplay", "yelling", "shouting", "out of seat", "class disruption"]
  },
  {
    label: "Peer conflict / aggression",
    keywords: ["fight", "fighting", "altercation", "aggression", "bullying", "harassment", "threat", "hit", "push"]
  },
  {
    label: "Attendance / punctuality",
    keywords: ["tardy", "late", "truancy", "absence", "absent", "skip", "attendance"]
  },
  {
    label: "Device misuse",
    keywords: ["phone", "cell phone", "device", "technology", "headphones", "chromebook", "computer"]
  },
  {
    label: "Work avoidance",
    keywords: ["off task", "missing work", "refused work", "sleeping", "work refusal", "academic dishonesty"]
  },
  {
    label: "Dishonesty",
    keywords: ["cheating", "dishonesty", "lying", "plagiarism", "forgery", "copying"]
  },
  {
    label: "Dress code / uniform",
    keywords: ["dress code", "uniform", "hoodie", "attire", "out of uniform"]
  },
  {
    label: "Safety / contraband",
    keywords: ["vape", "contraband", "weapon", "drugs", "smoking", "unsafe", "security"]
  },
  {
    label: "Property misuse",
    keywords: ["theft", "stealing", "vandalism", "property", "damage"]
  },
  {
    label: "Emotional escalation",
    keywords: ["escalated", "meltdown", "angry", "crying", "emotional", "panic"]
  }
];

const NARRATIVE_THEME_DEFINITIONS: ThemeDefinition[] = [
  {
    label: "Boundary testing",
    keywords: ["disrespect", "defiance", "insubordination", "noncompliance", "refused", "argued"]
  },
  {
    label: "Peer conflict",
    keywords: ["fight", "peer", "bullying", "harassment", "threat", "altercation", "aggression"]
  },
  {
    label: "Attention seeking / disruption",
    keywords: ["disruption", "horseplay", "shouting", "out of seat", "talking", "class disruption"]
  },
  {
    label: "Attendance / punctuality",
    keywords: ["tardy", "late", "truancy", "absent", "skip", "attendance"]
  },
  {
    label: "Device misuse",
    keywords: ["phone", "device", "technology", "headphones", "chromebook", "computer"]
  },
  {
    label: "Academic avoidance",
    keywords: ["off task", "missing work", "refused work", "sleeping", "avoidance", "not working"]
  },
  {
    label: "Dishonesty",
    keywords: ["cheating", "dishonesty", "lying", "plagiarism", "forgery", "copying"]
  },
  {
    label: "Safety / risk",
    keywords: ["vape", "contraband", "weapon", "drugs", "unsafe", "security"]
  },
  {
    label: "Property misuse",
    keywords: ["theft", "stealing", "vandalism", "property", "damage"]
  },
  {
    label: "Emotional regulation",
    keywords: ["escalated", "meltdown", "angry", "crying", "emotional", "panic"]
  }
];

function normalizeFilterValue(value: string | undefined): string {
  return value?.trim() || "";
}

function normalizeSourceType(value: string | undefined): IngestionSourceType {
  return value === "manual_pdf" ? value : DEFAULT_SOURCE_TYPE;
}

function parseBoundary(value: string | undefined, boundary: "start" | "end"): number {
  if (!value) {
    return Number.NaN;
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return Date.parse(`${trimmed}T${boundary === "start" ? "00:00:00.000" : "23:59:59.999"}Z`);
  }
  return Date.parse(trimmed);
}

function eventTimestamp(event: DisciplineEventRecord): string | null {
  return event.occurredAt ?? event.incidentDate;
}

function normalizeCompareValue(value: string | null): string {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") || "";
}

function prettifyKey(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function incrementCounter(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function sortCounts(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort((left, right) => right[1] - left[1]));
}

function toDateOnly(value: string | null): string | null {
  if (!value) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString().slice(0, 10);
}

function normalizeBucketLabel(input: Date, mode: TrendBucketMode): string {
  if (mode === "month") {
    return input.toISOString().slice(0, 7);
  }
  return input.toISOString().slice(0, 10);
}

function bucketModeForEvents(events: DisciplineEventRecord[], filters: { from?: string; to?: string }): TrendBucketMode {
  if (filters.from && filters.to) {
    const spanDays = Math.max(
      1,
      Math.ceil((parseBoundary(filters.to, "end") - parseBoundary(filters.from, "start")) / DAY_MS)
    );
    if (spanDays <= 21) {
      return "day";
    }
    if (spanDays <= 120) {
      return "week";
    }
    return "month";
  }

  const datedEvents = events
    .map((event) => Date.parse(eventTimestamp(event) ?? ""))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (datedEvents.length <= 1) {
    return "week";
  }

  const spanDays = Math.ceil(((datedEvents[datedEvents.length - 1] ?? 0) - (datedEvents[0] ?? 0)) / DAY_MS);
  if (spanDays <= 21) {
    return "day";
  }
  if (spanDays <= 120) {
    return "week";
  }
  return "month";
}

function bucketDateLabel(dateOnly: string | null, mode: TrendBucketMode): string {
  if (!dateOnly) {
    return "Unknown";
  }
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  if (mode === "day") {
    return normalizeBucketLabel(date, "day");
  }

  if (mode === "week") {
    const weekdayOffset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - weekdayOffset);
    return normalizeBucketLabel(date, "week");
  }

  date.setUTCDate(1);
  return normalizeBucketLabel(date, "month");
}

function matchesStudentSearch(
  search: string,
  event: DisciplineEventRecord,
  fallbackName: string,
  fallbackGrade: string
): boolean {
  if (!search) {
    return true;
  }

  const normalizedSearch = normalizeCompareValue(search);
  return [
    event.studentId,
    event.localStudentId,
    event.studentExternalId,
    event.studentName,
    fallbackName,
    fallbackGrade
  ]
    .filter(Boolean)
    .some((candidate) => normalizeCompareValue(candidate as string).includes(normalizedSearch));
}

function isWithinWindow(value: string | null, window: DateWindow): boolean {
  const epoch = Date.parse(value ?? "");
  if (Number.isNaN(epoch)) {
    return false;
  }
  if (epoch < window.fromEpoch) {
    return false;
  }
  if (epoch > window.toEpoch) {
    return false;
  }
  return true;
}

function startOfUtcDay(value: Date): Date {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function endOfUtcDay(value: Date): Date {
  const date = new Date(value);
  date.setUTCHours(23, 59, 59, 999);
  return date;
}

function addUtcDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MS);
}

function dateWindowLabel(from: string, to: string): string {
  return from === to ? from : `${from} to ${to}`;
}

function safeDateOrFallback(value: number, fallback: Date): Date {
  return Number.isFinite(value) ? new Date(value) : fallback;
}

function latestEventDate(events: DisciplineEventRecord[]): Date {
  const latestEpoch = events.reduce((max, event) => {
    const epoch = Date.parse(eventTimestamp(event) ?? "");
    return Number.isFinite(epoch) && epoch > max ? epoch : max;
  }, Number.NEGATIVE_INFINITY);

  return latestEpoch > Number.NEGATIVE_INFINITY ? new Date(latestEpoch) : new Date();
}

function inclusiveSpanDays(from: Date, to: Date): number {
  return Math.max(1, Math.round((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / DAY_MS) + 1);
}

function buildComparisonWindow(events: DisciplineEventRecord[], filters: AnalyticsFilters): ComputedComparisonWindow {
  const latest = latestEventDate(events);
  const latestEnd = endOfUtcDay(latest);
  const parsedFrom = parseBoundary(filters.from, "start");
  const parsedTo = parseBoundary(filters.to, "end");

  let currentFrom: Date;
  let currentTo: Date;
  let usedDefaultWindow = false;

  if (Number.isFinite(parsedFrom) && Number.isFinite(parsedTo) && parsedFrom <= parsedTo) {
    currentFrom = safeDateOrFallback(parsedFrom, startOfUtcDay(latestEnd));
    currentTo = safeDateOrFallback(parsedTo, latestEnd);
  } else if (Number.isFinite(parsedFrom)) {
    currentFrom = safeDateOrFallback(parsedFrom, startOfUtcDay(latestEnd));
    currentTo = latestEnd.getTime() >= currentFrom.getTime() ? latestEnd : endOfUtcDay(currentFrom);
  } else if (Number.isFinite(parsedTo)) {
    currentTo = safeDateOrFallback(parsedTo, latestEnd);
    currentFrom = startOfUtcDay(addUtcDays(currentTo, -(DEFAULT_WINDOW_DAYS - 1)));
    usedDefaultWindow = true;
  } else {
    currentTo = latestEnd;
    currentFrom = startOfUtcDay(addUtcDays(currentTo, -(DEFAULT_WINDOW_DAYS - 1)));
    usedDefaultWindow = true;
  }

  if (currentTo.getTime() < currentFrom.getTime()) {
    currentTo = endOfUtcDay(currentFrom);
  }

  const spanDays = inclusiveSpanDays(currentFrom, currentTo);
  const previousTo = endOfUtcDay(addUtcDays(currentFrom, -1));
  const previousFrom = startOfUtcDay(addUtcDays(previousTo, -(spanDays - 1)));

  return {
    current: {
      fromEpoch: currentFrom.getTime(),
      toEpoch: currentTo.getTime(),
      from: currentFrom.toISOString().slice(0, 10),
      to: currentTo.toISOString().slice(0, 10),
      label: dateWindowLabel(currentFrom.toISOString().slice(0, 10), currentTo.toISOString().slice(0, 10))
    },
    previous: {
      fromEpoch: previousFrom.getTime(),
      toEpoch: previousTo.getTime(),
      from: previousFrom.toISOString().slice(0, 10),
      to: previousTo.toISOString().slice(0, 10),
      label: dateWindowLabel(previousFrom.toISOString().slice(0, 10), previousTo.toISOString().slice(0, 10))
    },
    spanDays,
    usedDefaultWindow
  };
}

function round(value: number, digits = 1): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function share(part: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return round((part / total) * 100);
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return round(sorted[middle] ?? 0);
  }
  return round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

function eventText(event: DisciplineEventRecord, includeStructuredOnly = false): string {
  const pieces = includeStructuredOnly
    ? [event.violation, event.violationRaw, event.reason]
    : [event.violation, event.violationRaw, event.reason, event.description, event.resolution];
  return normalizeCompareValue(pieces.filter(Boolean).join(" "));
}

function detectTheme(text: string, definitions: ThemeDefinition[], fallback: string): string {
  if (!text) {
    return fallback;
  }
  const match = definitions.find((definition) => definition.keywords.some((keyword) => text.includes(keyword)));
  return match?.label ?? fallback;
}

function behaviorThemeForEvent(event: DisciplineEventRecord): string {
  return detectTheme(eventText(event, true), BEHAVIOR_THEME_DEFINITIONS, "General conduct");
}

function narrativeThemeForEvent(event: DisciplineEventRecord): string {
  return detectTheme(eventText(event, false), NARRATIVE_THEME_DEFINITIONS, "General conduct");
}

function severityKeyForEvent(
  event: DisciplineEventRecord
): Pick<AnalyticsSeverityMixRow, "key" | "label" | "tone"> {
  const level = event.level ?? null;
  if ((level !== null && level >= 3) || event.points >= 5) {
    return { key: "high", label: "High severity", tone: "danger" };
  }
  if ((level !== null && level >= 2) || event.points >= 3) {
    return { key: "medium", label: "Moderate severity", tone: "warning" };
  }
  return { key: "low", label: "Lower severity", tone: "info" };
}

function timingLabelForEvent(event: DisciplineEventRecord): { weekday: string; timeBlock: string; label: string } | null {
  const source = event.occurredAt;
  if (!source || /^\d{4}-\d{2}-\d{2}$/.test(source)) {
    return null;
  }
  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][parsed.getUTCDay()] ?? "Unknown";
  const hour = parsed.getUTCHours();
  let timeBlock = "After school";
  if (hour < 7) {
    timeBlock = "Early arrival";
  } else if (hour < 9) {
    timeBlock = "Arrival";
  } else if (hour < 11) {
    timeBlock = "Morning";
  } else if (hour < 13) {
    timeBlock = "Late morning";
  } else if (hour < 15) {
    timeBlock = "Lunch / midday";
  } else if (hour < 17) {
    timeBlock = "Afternoon";
  }

  return {
    weekday,
    timeBlock,
    label: `${weekday} - ${timeBlock}`
  };
}

function buildThresholdPressureRows(
  currentTotalsByStudent: Map<string, number>,
  crossingCountsByBand: Map<string, number>
): AnalyticsSnapshot["thresholdPressure"] {
  const totalStudents = currentTotalsByStudent.size;
  const rows = demeritEscalationBands.map((band) => {
    const studentCount = [...currentTotalsByStudent.values()].filter(
      (points) => getDemeritEscalationBand(points).id === band.id
    ).length;
    return {
      bandId: band.id,
      label: band.label,
      shortLabel: band.shortLabel,
      tone: band.tone,
      studentCount,
      share: share(studentCount, totalStudents),
      enteredCount: crossingCountsByBand.get(band.id) ?? 0
    };
  });

  return {
    escalatedStudents: rows
      .filter((row) => row.bandId !== "below_10")
      .reduce((sum, row) => sum + row.studentCount, 0),
    criticalStudents: rows
      .filter((row) => row.bandId === "points_35_39" || row.bandId === "points_40_plus")
      .reduce((sum, row) => sum + row.studentCount, 0),
    crossedIntoHigherBand: [...crossingCountsByBand.values()].reduce((sum, value) => sum + value, 0),
    rows
  };
}

function buildGradePressureRows(
  grades: string[],
  filteredEvents: DisciplineEventRecord[],
  studentsById: Map<string, { grade: string; active: boolean }>,
  currentTotalsByStudent: Map<string, number>
): AnalyticsGradePressureRow[] {
  const activeStudentsByGrade = new Map<string, number>();
  for (const student of studentsById.values()) {
    if (!student.active) {
      continue;
    }
    activeStudentsByGrade.set(student.grade, (activeStudentsByGrade.get(student.grade) ?? 0) + 1);
  }

  const studentIdsByGrade = new Map<string, Set<string>>();
  const incidentsByGrade = new Map<string, number>();
  const pointsByGrade = new Map<string, number>();
  for (const event of filteredEvents) {
    const grade = event.grade ?? studentsById.get(event.localStudentId ?? "")?.grade ?? "unknown";
    incidentsByGrade.set(grade, (incidentsByGrade.get(grade) ?? 0) + 1);
    pointsByGrade.set(grade, (pointsByGrade.get(grade) ?? 0) + event.points);
    const ids = studentIdsByGrade.get(grade) ?? new Set<string>();
    ids.add(event.studentId);
    studentIdsByGrade.set(grade, ids);
  }

  const liveStudentsByGrade = new Map<
    string,
    {
      escalatedStudents: number;
      criticalStudents: number;
    }
  >();
  for (const [studentId, totalPoints] of currentTotalsByStudent.entries()) {
    const grade = studentsById.get(studentId)?.grade ?? "unknown";
    const row = liveStudentsByGrade.get(grade) ?? { escalatedStudents: 0, criticalStudents: 0 };
    if (totalPoints >= 10) {
      row.escalatedStudents += 1;
    }
    if (totalPoints >= 35) {
      row.criticalStudents += 1;
    }
    liveStudentsByGrade.set(grade, row);
  }

  return grades
    .map((grade) => {
      const activeStudents = activeStudentsByGrade.get(grade) ?? 0;
      const incidentCount = incidentsByGrade.get(grade) ?? 0;
      const totalPoints = pointsByGrade.get(grade) ?? 0;
      const live = liveStudentsByGrade.get(grade) ?? { escalatedStudents: 0, criticalStudents: 0 };
      return {
        grade,
        activeStudents,
        studentsInvolved: studentIdsByGrade.get(grade)?.size ?? 0,
        incidentCount,
        totalPoints,
        incidentsPer100: activeStudents > 0 ? round((incidentCount / activeStudents) * 100) : 0,
        pointsPer100: activeStudents > 0 ? round((totalPoints / activeStudents) * 100) : 0,
        escalatedStudents: live.escalatedStudents,
        criticalStudents: live.criticalStudents
      };
    })
    .sort((left, right) => {
      if (right.pointsPer100 !== left.pointsPer100) {
        return right.pointsPer100 - left.pointsPer100;
      }
      if (right.totalPoints !== left.totalPoints) {
        return right.totalPoints - left.totalPoints;
      }
      return left.grade.localeCompare(right.grade);
    });
}

function buildSeverityMix(filteredEvents: DisciplineEventRecord[]): AnalyticsSnapshot["severityMix"] {
  const totalPoints = filteredEvents.reduce((sum, event) => sum + event.points, 0);
  const severityMap = new Map<AnalyticsSeverityMixRow["key"], AnalyticsSeverityMixRow>();
  for (const event of filteredEvents) {
    const severity = severityKeyForEvent(event);
    const current =
      severityMap.get(severity.key) ??
      {
        key: severity.key,
        label: severity.label,
        tone: severity.tone,
        incidentCount: 0,
        totalPoints: 0,
        incidentShare: 0,
        pointShare: 0
      };
    current.incidentCount += 1;
    current.totalPoints += event.points;
    severityMap.set(severity.key, current);
  }

  const orderedKeys: AnalyticsSeverityMixRow["key"][] = ["low", "medium", "high"];
  const rows: AnalyticsSeverityMixRow[] = orderedKeys.map((key) => {
    const row = severityMap.get(key) ?? {
      key,
      label: key === "low" ? "Lower severity" : key === "medium" ? "Moderate severity" : "High severity",
      tone: key === "low" ? "info" : key === "medium" ? "warning" : "danger",
      incidentCount: 0,
      totalPoints: 0,
      incidentShare: 0,
      pointShare: 0
    };
    return {
      ...row,
      incidentShare: share(row.incidentCount, filteredEvents.length),
      pointShare: share(row.totalPoints, totalPoints)
    };
  });

  const highSeverityCount = rows.find((row) => row.key === "high")?.incidentCount ?? 0;

  return {
    averagePointsPerIncident: filteredEvents.length > 0 ? round(totalPoints / filteredEvents.length) : 0,
    highSeverityShare: share(highSeverityCount, filteredEvents.length),
    rows
  };
}

function buildRepeatIncidentMetric(
  filteredEvents: DisciplineEventRecord[],
  comparableEvents: DisciplineEventRecord[]
): AnalyticsRepeatIncidentMetric {
  const studentsWithIncidents = new Set(filteredEvents.map((event) => event.studentId));
  const eventsByStudent = new Map<string, DisciplineEventRecord[]>();
  for (const event of comparableEvents) {
    const rows = eventsByStudent.get(event.studentId) ?? [];
    rows.push(event);
    eventsByStudent.set(event.studentId, rows);
  }

  for (const rows of eventsByStudent.values()) {
    rows.sort((left, right) => Date.parse(eventTimestamp(left) ?? "") - Date.parse(eventTimestamp(right) ?? ""));
  }

  const repeat14Students = new Set<string>();
  const repeat30Students = new Set<string>();
  const sameBehavior30Students = new Set<string>();

  for (const event of filteredEvents) {
    const rows = eventsByStudent.get(event.studentId) ?? [];
    const currentEpoch = Date.parse(eventTimestamp(event) ?? "");
    if (!Number.isFinite(currentEpoch)) {
      continue;
    }

    const sameBehavior = behaviorThemeForEvent(event);
    for (const candidate of rows) {
      const candidateEpoch = Date.parse(eventTimestamp(candidate) ?? "");
      if (!Number.isFinite(candidateEpoch) || candidateEpoch >= currentEpoch) {
        continue;
      }
      const diffDays = (currentEpoch - candidateEpoch) / DAY_MS;
      if (diffDays <= 14) {
        repeat14Students.add(event.studentId);
      }
      if (diffDays <= 30) {
        repeat30Students.add(event.studentId);
        if (behaviorThemeForEvent(candidate) === sameBehavior) {
          sameBehavior30Students.add(event.studentId);
        }
      }
    }
  }

  return {
    studentsWithIncidents: studentsWithIncidents.size,
    repeat14Count: repeat14Students.size,
    repeat14Rate: share(repeat14Students.size, studentsWithIncidents.size),
    repeat30Count: repeat30Students.size,
    repeat30Rate: share(repeat30Students.size, studentsWithIncidents.size),
    sameBehavior30Count: sameBehavior30Students.size,
    sameBehavior30Rate: share(sameBehavior30Students.size, studentsWithIncidents.size)
  };
}

function buildConcentrationMetric(filteredEvents: DisciplineEventRecord[]): AnalyticsConcentrationMetric {
  const pointsByStudent = new Map<string, number>();
  for (const event of filteredEvents) {
    pointsByStudent.set(event.studentId, (pointsByStudent.get(event.studentId) ?? 0) + event.points);
  }

  const pointValues = [...pointsByStudent.values()].sort((left, right) => right - left);
  const totalPoints = pointValues.reduce((sum, value) => sum + value, 0);
  const studentsWithPoints = pointValues.length;
  const topDecileStudents = studentsWithPoints > 0 ? Math.max(1, Math.ceil(studentsWithPoints * 0.1)) : 0;
  const topDecileShare = share(
    pointValues.slice(0, topDecileStudents).reduce((sum, value) => sum + value, 0),
    totalPoints
  );
  const topThreeShare = share(pointValues.slice(0, 3).reduce((sum, value) => sum + value, 0), totalPoints);
  const profile =
    topDecileShare >= 60 ? "Highly concentrated" : topDecileShare >= 40 ? "Moderately concentrated" : "Broadly distributed";

  return {
    studentsWithPoints,
    topDecileStudents,
    topDecileShare,
    topThreeShare,
    medianPoints: median(pointValues),
    profile
  };
}

function buildBehaviorShiftRows(
  currentWindowEvents: DisciplineEventRecord[],
  previousWindowEvents: DisciplineEventRecord[]
): AnalyticsBehaviorShiftRow[] {
  const currentMap = new Map<
    string,
    {
      incidents: number;
      points: number;
      studentIds: Set<string>;
    }
  >();
  const previousMap = new Map<string, number>();

  for (const event of currentWindowEvents) {
    const key = behaviorThemeForEvent(event);
    const row = currentMap.get(key) ?? { incidents: 0, points: 0, studentIds: new Set<string>() };
    row.incidents += 1;
    row.points += event.points;
    row.studentIds.add(event.studentId);
    currentMap.set(key, row);
  }

  for (const event of previousWindowEvents) {
    const key = behaviorThemeForEvent(event);
    previousMap.set(key, (previousMap.get(key) ?? 0) + 1);
  }

  const keys = new Set([...currentMap.keys(), ...previousMap.keys()]);
  return [...keys]
    .map((key) => {
      const current = currentMap.get(key) ?? { incidents: 0, points: 0, studentIds: new Set<string>() };
      const previousIncidents = previousMap.get(key) ?? 0;
      const deltaIncidents = current.incidents - previousIncidents;
      const deltaPercent =
        previousIncidents > 0 ? round((deltaIncidents / previousIncidents) * 100) : current.incidents > 0 ? 100 : 0;
      const trend: AnalyticsBehaviorShiftRow["trend"] =
        deltaIncidents > 0 ? "up" : deltaIncidents < 0 ? "down" : "flat";
      return {
        behavior: key,
        currentIncidents: current.incidents,
        previousIncidents,
        deltaIncidents,
        deltaPercent: current.incidents === 0 && previousIncidents === 0 ? null : deltaPercent,
        currentStudents: current.studentIds.size,
        currentPoints: current.points,
        trend
      };
    })
    .sort((left, right) => {
      if (right.currentIncidents !== left.currentIncidents) {
        return right.currentIncidents - left.currentIncidents;
      }
      if (right.deltaIncidents !== left.deltaIncidents) {
        return right.deltaIncidents - left.deltaIncidents;
      }
      return right.currentPoints - left.currentPoints;
    })
    .slice(0, 8);
}

function buildHotspotTiming(filteredEvents: DisciplineEventRecord[]): AnalyticsSnapshot["hotspotTiming"] {
  const hotspotMap = new Map<string, AnalyticsHotspotRow>();
  let timedIncidentCount = 0;

  for (const event of filteredEvents) {
    const label = timingLabelForEvent(event);
    if (!label) {
      continue;
    }
    timedIncidentCount += 1;
    const row =
      hotspotMap.get(label.label) ??
      {
        label: label.label,
        weekday: label.weekday,
        timeBlock: label.timeBlock,
        incidentCount: 0,
        totalPoints: 0
      };
    row.incidentCount += 1;
    row.totalPoints += event.points;
    hotspotMap.set(label.label, row);
  }

  return {
    timedIncidentCount,
    timeCoverageRate: share(timedIncidentCount, filteredEvents.length),
    rows: [...hotspotMap.values()]
      .sort((left, right) => {
        if (right.incidentCount !== left.incidentCount) {
          return right.incidentCount - left.incidentCount;
        }
        return right.totalPoints - left.totalPoints;
      })
      .slice(0, 6)
  };
}

function buildInterventionHealthMetric(
  interventions: Array<{
    status: string;
    dueDate: string;
    completedAt: string | null;
  }>,
  window: DateWindow
): AnalyticsInterventionHealthMetric {
  const relevant = interventions.filter((intervention) => {
    if (["open", "in_progress", "overdue"].includes(intervention.status)) {
      return Date.parse(intervention.dueDate) <= window.toEpoch;
    }
    if (intervention.completedAt) {
      return isWithinWindow(intervention.completedAt, window);
    }
    return isWithinWindow(intervention.dueDate, window);
  });

  const completed = relevant.filter((intervention) => intervention.status === "completed" && intervention.completedAt);
  const completedOnTimeCount = completed.filter(
    (intervention) => Date.parse(intervention.completedAt ?? "") <= Date.parse(intervention.dueDate)
  ).length;
  const active = relevant.filter((intervention) => ["open", "in_progress", "overdue"].includes(intervention.status));
  const overdue = active.filter((intervention) => Date.parse(intervention.dueDate) <= window.toEpoch);
  const completedLateDays = completed
    .map((intervention) => {
      const completedEpoch = Date.parse(intervention.completedAt ?? "");
      const dueEpoch = Date.parse(intervention.dueDate);
      return completedEpoch > dueEpoch ? (completedEpoch - dueEpoch) / DAY_MS : 0;
    })
    .filter((value) => value > 0);
  const activeOverdueDays = overdue
    .map((intervention) => (window.toEpoch - Date.parse(intervention.dueDate)) / DAY_MS)
    .filter((value) => value > 0);

  return {
    activeCount: active.length,
    overdueCount: overdue.length,
    completedCount: completed.length,
    completedOnTimeCount,
    completedOnTimeRate: share(completedOnTimeCount, completed.length),
    medianCompletedLateDays: median(completedLateDays),
    medianActiveOverdueDays: median(activeOverdueDays)
  };
}

function buildPostInterventionMetric(
  interventions: Array<{
    studentId: string;
    completedAt: string | null;
  }>,
  followupEvents: DisciplineEventRecord[],
  window: DateWindow
): AnalyticsPostInterventionMetric {
  const completed = interventions.filter(
    (intervention) => intervention.completedAt && isWithinWindow(intervention.completedAt, window)
  );

  const rows: AnalyticsReentryRow[] = [14, 30, 45].map((days) => {
    const reentryCount = completed.filter((intervention) => {
      const completedEpoch = Date.parse(intervention.completedAt ?? "");
      return followupEvents.some((event) => {
        if (event.studentId !== intervention.studentId) {
          return false;
        }
        const eventEpoch = Date.parse(eventTimestamp(event) ?? "");
        if (!Number.isFinite(eventEpoch) || eventEpoch <= completedEpoch) {
          return false;
        }
        return eventEpoch - completedEpoch <= days * DAY_MS;
      });
    }).length;
    return {
      days: days as 14 | 30 | 45,
      reentryCount,
      reentryRate: share(reentryCount, completed.length)
    };
  });

  return {
    completedInterventions: completed.length,
    rows
  };
}

function buildNarrativeThemeRows(filteredEvents: DisciplineEventRecord[]): AnalyticsNarrativeThemeRow[] {
  const themeMap = new Map<
    string,
    {
      incidentCount: number;
      studentIds: Set<string>;
    }
  >();

  for (const event of filteredEvents) {
    const key = narrativeThemeForEvent(event);
    const row = themeMap.get(key) ?? { incidentCount: 0, studentIds: new Set<string>() };
    row.incidentCount += 1;
    row.studentIds.add(event.studentId);
    themeMap.set(key, row);
  }

  return [...themeMap.entries()]
    .map(([theme, row]) => ({
      theme,
      incidentCount: row.incidentCount,
      uniqueStudents: row.studentIds.size,
      share: share(row.incidentCount, filteredEvents.length)
    }))
    .sort((left, right) => {
      if (right.incidentCount !== left.incidentCount) {
        return right.incidentCount - left.incidentCount;
      }
      return right.uniqueStudents - left.uniqueStudents;
    })
    .slice(0, 8);
}

function buildStudentRows(
  filteredEvents: DisciplineEventRecord[],
  studentsById: Map<string, { fullName: string; grade: string }>,
  currentTotalsByStudent: Map<string, number>,
  activeInterventionCountByStudent: Map<string, number>,
  queuedNotificationsByStudent: Map<string, number>,
  failedNotificationsByStudent: Map<string, number>
): AnalyticsStudentRow[] {
  const scopedStudents = new Map<string, StudentAggregate>();
  for (const event of filteredEvents) {
    const fallbackStudent = event.localStudentId ? studentsById.get(event.localStudentId) : undefined;
    const fullName = event.studentName ?? fallbackStudent?.fullName ?? event.studentId;
    const grade = event.grade ?? fallbackStudent?.grade ?? "unknown";
    const aggregate =
      scopedStudents.get(event.studentId) ??
      {
        studentId: event.studentId,
        localStudentId: event.localStudentId,
        fullName,
        grade,
        incidentCount: 0,
        totalPoints: 0,
        latestIncidentAt: null
      };
    aggregate.incidentCount += 1;
    aggregate.totalPoints += event.points;
    const timestamp = eventTimestamp(event);
    if (timestamp && (!aggregate.latestIncidentAt || Date.parse(timestamp) > Date.parse(aggregate.latestIncidentAt))) {
      aggregate.latestIncidentAt = timestamp;
    }
    scopedStudents.set(event.studentId, aggregate);
  }

  return [...scopedStudents.values()]
    .map((student) => {
      const currentTotalPoints = currentTotalsByStudent.get(student.studentId) ?? student.totalPoints;
      const currentBand = getDemeritEscalationBand(currentTotalPoints);
      return {
        studentId: student.studentId,
        fullName: student.fullName,
        grade: student.grade,
        incidentCount: student.incidentCount,
        totalPoints: student.totalPoints,
        currentTotalPoints,
        currentBandId: currentBand.id,
        currentBandLabel: currentBand.label,
        latestIncidentAt: student.latestIncidentAt,
        activeInterventions: student.localStudentId
          ? activeInterventionCountByStudent.get(student.localStudentId) ?? 0
          : 0,
        queuedNotifications: student.localStudentId
          ? queuedNotificationsByStudent.get(student.localStudentId) ?? 0
          : 0,
        failedNotifications: student.localStudentId
          ? failedNotificationsByStudent.get(student.localStudentId) ?? 0
          : 0
      };
    })
    .sort((left, right) => {
      if (right.currentTotalPoints !== left.currentTotalPoints) {
        return right.currentTotalPoints - left.currentTotalPoints;
      }
      if (right.totalPoints !== left.totalPoints) {
        return right.totalPoints - left.totalPoints;
      }
      return right.incidentCount - left.incidentCount;
    });
}

function buildTrend(filteredEvents: DisciplineEventRecord[], filters: { from: string; to: string }): AnalyticsTrendRow[] {
  const trendMode = bucketModeForEvents(filteredEvents, filters);
  const trendMap = new Map<string, AnalyticsTrendRow>();

  for (const event of filteredEvents) {
    const dateOnly = toDateOnly(eventTimestamp(event));
    const bucket = bucketDateLabel(dateOnly, trendMode);
    const row = trendMap.get(bucket) ?? { period: bucket, incidentCount: 0, totalPoints: 0 };
    row.incidentCount += 1;
    row.totalPoints += event.points;
    trendMap.set(bucket, row);
  }

  return [...trendMap.values()].sort((left, right) => left.period.localeCompare(right.period));
}

export function readAnalyticsFilters(searchParams: URLSearchParams): AnalyticsFilters {
  return {
    grade: normalizeFilterValue(searchParams.get("grade") || undefined) || undefined,
    from: normalizeFilterValue(searchParams.get("from") || undefined) || undefined,
    to: normalizeFilterValue(searchParams.get("to") || undefined) || undefined,
    sourceType: normalizeSourceType(searchParams.get("sourceType") || undefined),
    student: normalizeFilterValue(searchParams.get("student") || undefined) || undefined,
    violation: normalizeFilterValue(searchParams.get("violation") || undefined) || undefined,
    author: normalizeFilterValue(searchParams.get("author") || undefined) || undefined,
    thresholdBand: (normalizeFilterValue(searchParams.get("thresholdBand") || undefined) || undefined) as
      | DemeritEscalationBandId
      | undefined
  };
}

export async function buildAnalyticsSnapshot(
  storage: StorageRepositories,
  filters: AnalyticsFilters
): Promise<AnalyticsSnapshot> {
  const [students, interventions, notifications, disciplineEvents] = await Promise.all([
    storage.students.list(),
    storage.interventions.list(),
    storage.notifications.list(),
    listDisciplineEvents(storage)
  ]);

  const normalizedFilters = {
    grade: normalizeFilterValue(filters.grade),
    sourceType: filters.sourceType ?? DEFAULT_SOURCE_TYPE,
    student: normalizeFilterValue(filters.student),
    violation: normalizeFilterValue(filters.violation),
    author: normalizeFilterValue(filters.author),
    thresholdBand: normalizeFilterValue(filters.thresholdBand)
  };

  const studentsById = new Map(
    students.map((student) => [
      student.id,
      {
        fullName: student.fullName,
        grade: student.grade,
        active: student.active
      }
    ] as const)
  );

  const sourceScopedEvents = disciplineEvents.filter((event) => event.sourceType === normalizedFilters.sourceType);

  const liveScopedEvents = sourceScopedEvents.filter((event) => {
    const fallbackStudent = event.localStudentId ? studentsById.get(event.localStudentId) : undefined;
    const fallbackGrade = event.grade ?? fallbackStudent?.grade ?? "unknown";
    const fallbackName = event.studentName ?? fallbackStudent?.fullName ?? event.studentId;
    if (normalizedFilters.grade && fallbackGrade !== normalizedFilters.grade) {
      return false;
    }
    return matchesStudentSearch(normalizedFilters.student, event, fallbackName, fallbackGrade);
  });

  const currentTotalsByStudent = new Map<string, number>();
  for (const event of liveScopedEvents) {
    currentTotalsByStudent.set(event.studentId, (currentTotalsByStudent.get(event.studentId) ?? 0) + event.points);
  }

  const comparisonWindow = buildComparisonWindow(
    sourceScopedEvents.filter((event) => {
      const fallbackStudent = event.localStudentId ? studentsById.get(event.localStudentId) : undefined;
      const fallbackGrade = event.grade ?? fallbackStudent?.grade ?? "unknown";
      const fallbackName = event.studentName ?? fallbackStudent?.fullName ?? event.studentId;
      if (normalizedFilters.grade && fallbackGrade !== normalizedFilters.grade) {
        return false;
      }
      if (!matchesStudentSearch(normalizedFilters.student, event, fallbackName, fallbackGrade)) {
        return false;
      }
      return true;
    }),
    filters
  );

  const comparableEvents = sourceScopedEvents.filter((event) => {
    const fallbackStudent = event.localStudentId ? studentsById.get(event.localStudentId) : undefined;
    const fallbackGrade = event.grade ?? fallbackStudent?.grade ?? "unknown";
    const fallbackName = event.studentName ?? fallbackStudent?.fullName ?? event.studentId;
    const eventViolation = event.violation ?? event.violationRaw ?? event.reason ?? "";
    const eventAuthor = event.authorName ?? "";

    if (normalizedFilters.grade && fallbackGrade !== normalizedFilters.grade) {
      return false;
    }
    if (!matchesStudentSearch(normalizedFilters.student, event, fallbackName, fallbackGrade)) {
      return false;
    }
    if (
      normalizedFilters.violation &&
      normalizeCompareValue(eventViolation) !== normalizeCompareValue(normalizedFilters.violation)
    ) {
      return false;
    }
    if (normalizedFilters.author && normalizeCompareValue(eventAuthor) !== normalizeCompareValue(normalizedFilters.author)) {
      return false;
    }
    if (
      normalizedFilters.thresholdBand &&
      getDemeritEscalationBand(currentTotalsByStudent.get(event.studentId) ?? 0).id !== normalizedFilters.thresholdBand
    ) {
      return false;
    }
    return true;
  });

  const filteredEvents = comparableEvents.filter((event) => isWithinWindow(eventTimestamp(event), comparisonWindow.current));
  const previousWindowEvents = comparableEvents.filter((event) =>
    isWithinWindow(eventTimestamp(event), comparisonWindow.previous)
  );

  const crossingCountsByBand = new Map<string, number>();
  const liveEventsByStudent = new Map<string, DisciplineEventRecord[]>();
  for (const event of liveScopedEvents) {
    const rows = liveEventsByStudent.get(event.studentId) ?? [];
    rows.push(event);
    liveEventsByStudent.set(event.studentId, rows);
  }
  for (const [studentId, rows] of liveEventsByStudent.entries()) {
    const beforeWindowPoints = rows.reduce((sum, event) => {
      const epoch = Date.parse(eventTimestamp(event) ?? "");
      if (!Number.isFinite(epoch) || epoch >= comparisonWindow.current.fromEpoch) {
        return sum;
      }
      return sum + event.points;
    }, 0);
    const throughWindowPoints = rows.reduce((sum, event) => {
      const epoch = Date.parse(eventTimestamp(event) ?? "");
      if (!Number.isFinite(epoch) || epoch > comparisonWindow.current.toEpoch) {
        return sum;
      }
      return sum + event.points;
    }, 0);
    const beforeBand = getDemeritEscalationBand(beforeWindowPoints);
    const throughBand = getDemeritEscalationBand(throughWindowPoints);
    if (throughBand.priority > beforeBand.priority) {
      crossingCountsByBand.set(throughBand.id, (crossingCountsByBand.get(throughBand.id) ?? 0) + 1);
    }
    if (!currentTotalsByStudent.has(studentId)) {
      currentTotalsByStudent.set(studentId, throughWindowPoints);
    }
  }

  const analyticsScopedLocalStudentIds = new Set(
    comparableEvents.map((event) => event.localStudentId).filter((value): value is string => Boolean(value))
  );

  const interventionStatus: Record<string, number> = {};
  const activeInterventionCountByStudent = new Map<string, number>();
  const relevantInterventions = interventions.filter((intervention) => analyticsScopedLocalStudentIds.has(intervention.studentId));
  for (const intervention of relevantInterventions) {
    const isRelevant =
      (["open", "in_progress", "overdue"].includes(intervention.status) &&
        Date.parse(intervention.dueDate) <= comparisonWindow.current.toEpoch) ||
      isWithinWindow(intervention.dueDate, comparisonWindow.current) ||
      (intervention.completedAt ? isWithinWindow(intervention.completedAt, comparisonWindow.current) : false);

    if (!isRelevant) {
      continue;
    }
    incrementCounter(interventionStatus, intervention.status);
    if (["open", "in_progress", "overdue"].includes(intervention.status)) {
      activeInterventionCountByStudent.set(
        intervention.studentId,
        (activeInterventionCountByStudent.get(intervention.studentId) ?? 0) + 1
      );
    }
  }

  const notificationStatus: Record<string, number> = {};
  const queuedNotificationsByStudent = new Map<string, number>();
  const failedNotificationsByStudent = new Map<string, number>();
  const relevantNotifications = notifications.filter((notification) => analyticsScopedLocalStudentIds.has(notification.studentId));
  for (const notification of relevantNotifications) {
    const isRelevant =
      notification.status === "queued" ||
      (notification.sentAt ? isWithinWindow(notification.sentAt, comparisonWindow.current) : false);
    if (!isRelevant) {
      continue;
    }
    incrementCounter(notificationStatus, notification.status);
    if (notification.status === "queued") {
      queuedNotificationsByStudent.set(
        notification.studentId,
        (queuedNotificationsByStudent.get(notification.studentId) ?? 0) + 1
      );
    }
    if (notification.status === "failed") {
      failedNotificationsByStudent.set(
        notification.studentId,
        (failedNotificationsByStudent.get(notification.studentId) ?? 0) + 1
      );
    }
  }

  const thresholdPressure = buildThresholdPressureRows(currentTotalsByStudent, crossingCountsByBand);
  const gradesInScope = normalizedFilters.grade
    ? [normalizedFilters.grade]
    : [
        ...new Set(
          [...students.map((student) => student.grade), ...filteredEvents.map((event) => event.grade ?? "unknown")].filter(Boolean)
        )
      ].sort((left, right) => left.localeCompare(right));
  const gradePressureRows = buildGradePressureRows(gradesInScope, filteredEvents, studentsById, currentTotalsByStudent);
  const severityMix = buildSeverityMix(filteredEvents);
  const repeatIncident = buildRepeatIncidentMetric(filteredEvents, comparableEvents);
  const concentration = buildConcentrationMetric(filteredEvents);
  const behaviorShiftRows = buildBehaviorShiftRows(filteredEvents, previousWindowEvents);
  const hotspotTiming = buildHotspotTiming(filteredEvents);
  const interventionHealth = buildInterventionHealthMetric(
    relevantInterventions.map((intervention) => ({
      status: intervention.status,
      dueDate: intervention.dueDate,
      completedAt: intervention.completedAt
    })),
    comparisonWindow.current
  );
  const postIntervention = buildPostInterventionMetric(
    relevantInterventions.map((intervention) => ({
      studentId: intervention.studentId,
      completedAt: intervention.completedAt
    })),
    liveScopedEvents,
    comparisonWindow.current
  );
  const narrativeThemeRows = buildNarrativeThemeRows(filteredEvents);
  const studentRows = buildStudentRows(
    filteredEvents,
    new Map(
      students.map((student) => [
        student.id,
        {
          fullName: student.fullName,
          grade: student.grade
        }
      ] as const)
    ),
    currentTotalsByStudent,
    activeInterventionCountByStudent,
    queuedNotificationsByStudent,
    failedNotificationsByStudent
  );
  const trend = buildTrend(filteredEvents, {
    from: comparisonWindow.current.from,
    to: comparisonWindow.current.to
  });

  const summary: AnalyticsSummaryMetric[] = [
    {
      label: "Students in window",
      value: studentRows.length,
      description: "Students represented in the active analytics window."
    },
    {
      label: "Incidents in window",
      value: filteredEvents.length,
      description: "Discipline records inside the active decision window."
    },
    {
      label: "Points in window",
      value: filteredEvents.reduce((sum, event) => sum + event.points, 0),
      description: "Total points accumulated in the active decision window."
    },
    {
      label: "Live 10+ students",
      value: thresholdPressure.escalatedStudents,
      description: "Students currently at or above the first handbook escalation band."
    },
    {
      label: "30-day repeat %",
      value: repeatIncident.repeat30Rate,
      description: "Share of students in this window with a prior incident in the last 30 days."
    },
    {
      label: "Overdue interventions",
      value: interventionHealth.overdueCount,
      description: "Active intervention backlog due on or before the window close."
    }
  ];

  const topGrade = gradePressureRows[0];
  const topBehavior = behaviorShiftRows[0];
  const narrativeParts = [
    comparisonWindow.usedDefaultWindow
      ? `Analytics is using the most recent ${comparisonWindow.spanDays}-day window by default.`
      : `Analytics is using the selected decision window ${comparisonWindow.current.label}.`,
    topGrade
      ? `Grade ${topGrade.grade} has the highest pressure rate at ${topGrade.pointsPer100} points per 100 active students.`
      : "No grade pressure is visible in the active window.",
    `Repeat behavior is at ${repeatIncident.repeat30Rate}% within 30 days.`,
    topBehavior
      ? `${topBehavior.behavior} is ${topBehavior.trend === "up" ? "rising" : topBehavior.trend === "down" ? "easing" : "holding steady"} versus the prior window.`
      : "No dominant behavior shift is visible yet.",
    interventionHealth.overdueCount > 0
      ? `${interventionHealth.overdueCount} interventions are overdue at the close of the window.`
      : "No intervention backlog is overdue at the close of the window."
  ];

  const availableGrades = [
    ...new Set(sourceScopedEvents.map((event) => event.grade).filter((value): value is string => Boolean(value)))
  ].sort((left, right) => left.localeCompare(right));
  const availableViolations = [
    ...new Set(
      sourceScopedEvents
        .map((event) => (event.violation ?? event.violationRaw ?? event.reason ?? "").trim())
        .filter(Boolean)
    )
  ].sort((left, right) => left.localeCompare(right));
  const availableAuthors = [
    ...new Set(sourceScopedEvents.map((event) => (event.authorName ?? "").trim()).filter(Boolean))
  ].sort((left, right) => left.localeCompare(right));

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      grade: normalizedFilters.grade,
      from: comparisonWindow.current.from,
      to: comparisonWindow.current.to,
      sourceType: normalizedFilters.sourceType,
      student: normalizedFilters.student,
      violation: normalizedFilters.violation,
      author: normalizedFilters.author,
      thresholdBand: normalizedFilters.thresholdBand
    },
    comparisonWindow: {
      current: {
        from: comparisonWindow.current.from,
        to: comparisonWindow.current.to,
        label: comparisonWindow.current.label
      },
      previous: {
        from: comparisonWindow.previous.from,
        to: comparisonWindow.previous.to,
        label: comparisonWindow.previous.label
      },
      spanDays: comparisonWindow.spanDays,
      usedDefaultWindow: comparisonWindow.usedDefaultWindow
    },
    availableFilters: {
      grades: availableGrades,
      violations: availableViolations,
      authors: availableAuthors,
      thresholdBands: escalationBandOptions()
    },
    summary,
    trend,
    thresholdPressure,
    gradePressureRows,
    severityMix,
    repeatIncident,
    concentration,
    behaviorShiftRows,
    hotspotTiming,
    interventionHealth,
    postIntervention,
    narrativeThemeRows,
    studentRows,
    interventionStatus: sortCounts(interventionStatus),
    notificationStatus: sortCounts(notificationStatus),
    narrative: narrativeParts.join(" ")
  };
}

export function analyticsStatusRows(record: Record<string, number>): Array<{ key: string; label: string; count: number }> {
  return Object.entries(record)
    .map(([key, count]) => ({
      key,
      label: prettifyKey(key),
      count
    }))
    .sort((left, right) => right.count - left.count);
}
