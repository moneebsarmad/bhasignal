export type DemeritEscalationBandId =
  | "below_10"
  | "points_10_19"
  | "points_20_29"
  | "points_30_34"
  | "points_35_39"
  | "points_40_plus";

export interface DemeritEscalationBand {
  id: DemeritEscalationBandId;
  label: string;
  shortLabel: string;
  minPoints: number;
  maxPoints: number | null;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
  priority: number;
  parentCommunication: string;
  adminAction: string;
  adminMessage: string;
  policyImpact: string;
}

export const demeritEscalationBands: DemeritEscalationBand[] = [
  {
    id: "below_10",
    label: "Below 10 points",
    shortLabel: "Below 10",
    minPoints: 0,
    maxPoints: 9,
    tone: "neutral",
    priority: 0,
    parentCommunication: "No handbook-triggered parent communication yet.",
    adminAction: "Monitor and intervene early if patterns intensify.",
    adminMessage: "Keep the student below the communication ladder and watch for repeat behavior.",
    policyImpact: "No handbook escalation is triggered before 10 points."
  },
  {
    id: "points_10_19",
    label: "10 to 19 points",
    shortLabel: "10-19",
    minPoints: 10,
    maxPoints: 19,
    tone: "info",
    priority: 1,
    parentCommunication: "Parents should receive a phone call and an email.",
    adminAction: "Notify the family and flag program eligibility risk.",
    adminMessage:
      "Inform parents that the student has reached 10 demerit points and document the contact promptly.",
    policyImpact:
      "Student may be at risk for programs tied to demerit points, including Dual Credit, club roles, participation, and athletics scholarship eligibility."
  },
  {
    id: "points_20_29",
    label: "20 to 29 points",
    shortLabel: "20-29",
    minPoints: 20,
    maxPoints: 29,
    tone: "warning",
    priority: 2,
    parentCommunication: "Parents should meet with BHA administration.",
    adminAction: "Schedule the meeting and advise counseling support.",
    adminMessage:
      "Review the infractions with the family and communicate that the student is approaching the non-enrollment threshold.",
    policyImpact:
      "Student should be advised to attend counseling with Behavior and/or Academic Counselors."
  },
  {
    id: "points_30_34",
    label: "30 to 34 points",
    shortLabel: "30-34",
    minPoints: 30,
    maxPoints: 34,
    tone: "warning",
    priority: 3,
    parentCommunication: "Send a certified letter and an email to the family.",
    adminAction: "Scan the letter and place the copy into Sycamore and the student file.",
    adminMessage:
      "Issue the formal letter immediately and make sure the signed communication is archived in the student record.",
    policyImpact:
      "The handbook expects a documented certified letter at 30 points with the record scanned into Sycamore and the student file."
  },
  {
    id: "points_35_39",
    label: "35 to 39 points",
    shortLabel: "35-39",
    minPoints: 35,
    maxPoints: 39,
    tone: "danger",
    priority: 4,
    parentCommunication: "Parents should meet with administration for a severity review.",
    adminAction: "Obtain signed acknowledgement, document the case in Sycamore, and prepare the 5-day OSS response.",
    adminMessage:
      "Explain that reaching 40+ points may require un-enrollment, secure parent sign-off, and document the full action trail.",
    policyImpact:
      "Students are placed at risk for enrollment and probation during re-enrollment, and the handbook calls for automatic 5-day out-of-school suspension."
  },
  {
    id: "points_40_plus",
    label: "40 or more points",
    shortLabel: "40+",
    minPoints: 40,
    maxPoints: null,
    tone: "danger",
    priority: 5,
    parentCommunication: "Parents should be informed of unenrollment or expulsion review.",
    adminAction: "Escalate to formal unenrollment or expulsion recommendation workflow.",
    adminMessage:
      "Move the case into the school's highest-severity discipline review and document the recommendation path immediately.",
    policyImpact:
      "The handbook states that parents may be asked to un-enroll the student or expulsion proceedings may be recommended."
  }
];

export function getDemeritEscalationBand(totalPoints: number): DemeritEscalationBand {
  const normalizedPoints = Number.isFinite(totalPoints) ? Math.max(0, Math.trunc(totalPoints)) : 0;
  return (
    demeritEscalationBands.find((band) => {
      if (normalizedPoints < band.minPoints) {
        return false;
      }
      if (band.maxPoints !== null && normalizedPoints > band.maxPoints) {
        return false;
      }
      return true;
    }) ?? demeritEscalationBands[0]!
  );
}

export function escalationBandOptions(): Array<{ id: string; label: string }> {
  return demeritEscalationBands.map((band) => ({
    id: band.id,
    label: band.label
  }));
}
