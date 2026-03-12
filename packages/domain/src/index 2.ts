export type UUID = string;

export interface Student {
  id: UUID;
  externalId: string | null;
  fullName: string;
  grade: string;
  active: boolean;
}

export interface DisciplineIncident {
  id: UUID;
  studentId: UUID;
  points: number;
  reason: string;
  comment: string;
  occurredAt: string;
  sourceJobId: UUID;
  fingerprint: string;
}

