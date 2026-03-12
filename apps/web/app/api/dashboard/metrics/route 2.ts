import { NextRequest, NextResponse } from "next/server";

import { buildStudentScores, buildTriggerLevels, parseRunStatusSummary } from "@/lib/policies";
import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter } from "@/lib/storage";

export async function GET(request: NextRequest) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const gradeFilter = request.nextUrl.searchParams.get("grade");
  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");

  const storage = createStorageAdapter();
  await storage.ensureSchema();
  const latestPolicy = await storage.policies.getLatest();
  const studentScores = await buildStudentScores(storage);
  const parseRuns = await storage.parseRuns.list();
  const interventions = await storage.interventions.list();
  const notifications = await storage.notifications.list();
  const approvedIncidents = await storage.approvedIncidents.list();
  const students = await storage.students.list();

  const studentById = new Map(students.map((student) => [student.id, student] as const));
  const filteredScores = studentScores.filter((score) => {
    if (!gradeFilter) {
      return true;
    }
    return score.student.grade === gradeFilter;
  });

  const fromEpoch = from ? Date.parse(from) : Number.NaN;
  const toEpoch = to ? Date.parse(to) : Number.NaN;
  const filteredIncidents = approvedIncidents.filter((incident) => {
    if (gradeFilter) {
      const student = studentById.get(incident.studentId);
      if (student?.grade !== gradeFilter) {
        return false;
      }
    }
    const occurredEpoch = Date.parse(incident.occurredAt);
    if (!Number.isNaN(fromEpoch) && occurredEpoch < fromEpoch) {
      return false;
    }
    if (!Number.isNaN(toEpoch) && occurredEpoch > toEpoch) {
      return false;
    }
    return true;
  });

  const baseThreshold = latestPolicy?.baseThreshold ?? 10;
  const milestoneByDelta = new Set(latestPolicy?.milestones ?? [0, 10, 20, 30]);
  milestoneByDelta.add(0);
  milestoneByDelta.add(10);
  milestoneByDelta.add(20);
  milestoneByDelta.add(30);

  const triggerLevels = latestPolicy ? buildTriggerLevels(latestPolicy) : [];
  const countsByLabel: Record<string, number> = {};
  for (const trigger of triggerLevels) {
    countsByLabel[trigger.label] = filteredScores.filter(
      (score) => score.totalPoints >= trigger.threshold
    ).length;
  }

  const nearThresholdCount = filteredScores.filter(
    (score) => score.totalPoints >= baseThreshold - 3 && score.totalPoints < baseThreshold
  ).length;

  const countAtX = filteredScores.filter((score) => score.totalPoints >= baseThreshold).length;
  const countAtX10 = filteredScores.filter((score) => score.totalPoints >= baseThreshold + 10).length;
  const countAtX20 = filteredScores.filter((score) => score.totalPoints >= baseThreshold + 20).length;
  const countAtX30 = filteredScores.filter((score) => score.totalPoints >= baseThreshold + 30).length;

  const interventionCounts = interventions.reduce<Record<string, number>>((acc, intervention) => {
    acc[intervention.status] = (acc[intervention.status] ?? 0) + 1;
    return acc;
  }, {});
  const notificationCounts = notifications.reduce<Record<string, number>>((acc, notification) => {
    acc[notification.status] = (acc[notification.status] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    filters: { grade: gradeFilter, from, to },
    latestPolicy,
    metrics: {
      totalStudents: filteredScores.length,
      incidentsInRange: filteredIncidents.length,
      countAtX,
      countAtX10,
      countAtX20,
      countAtX30,
      nearThresholdCount
    },
    countsByLabel,
    interventionCounts,
    notificationCounts,
    parseRunStatus: parseRunStatusSummary(parseRuns),
    topStudents: filteredScores.slice(0, 20).map((score) => ({
      studentId: score.student.id,
      fullName: score.student.fullName,
      grade: score.student.grade,
      totalPoints: score.totalPoints
    }))
  });
}
