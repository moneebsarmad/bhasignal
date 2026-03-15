import type {
  ApprovedIncident,
  AuditEvent,
  GuardianContact,
  Intervention,
  Notification,
  ParseRun,
  Policy,
  RawIncident,
  ReviewTask,
  Student,
  UUID
} from "@syc/domain";

export interface StudentRepository {
  upsert(student: Student): Promise<void>;
  getById(id: UUID): Promise<Student | null>;
  list(): Promise<Student[]>;
}

export interface GuardianContactRepository {
  upsert(contact: GuardianContact): Promise<void>;
  getById(id: UUID): Promise<GuardianContact | null>;
  listByStudent(studentId: UUID): Promise<GuardianContact[]>;
  list(): Promise<GuardianContact[]>;
}

export interface RawIncidentRepository {
  upsert(rawIncident: RawIncident): Promise<void>;
  getById(id: UUID): Promise<RawIncident | null>;
  listByParseRun(parseRunId: UUID): Promise<RawIncident[]>;
  listByStatus(status: RawIncident["status"]): Promise<RawIncident[]>;
  list(): Promise<RawIncident[]>;
}

export interface ApprovedIncidentRepository {
  upsert(incident: ApprovedIncident): Promise<void>;
  getById(id: UUID): Promise<ApprovedIncident | null>;
  getByFingerprint(fingerprint: string): Promise<ApprovedIncident | null>;
  listByStudent(studentId: UUID): Promise<ApprovedIncident[]>;
  list(): Promise<ApprovedIncident[]>;
}

export interface ParseRunRepository {
  upsert(parseRun: ParseRun): Promise<void>;
  getById(id: UUID): Promise<ParseRun | null>;
  list(): Promise<ParseRun[]>;
}

export interface ReviewTaskRepository {
  upsert(reviewTask: ReviewTask): Promise<void>;
  getById(id: UUID): Promise<ReviewTask | null>;
  listByParseRun(parseRunId: UUID): Promise<ReviewTask[]>;
  listByStatus(status: ReviewTask["status"]): Promise<ReviewTask[]>;
}

export interface PolicyRepository {
  upsert(policy: Policy): Promise<void>;
  getByVersion(version: number): Promise<Policy | null>;
  getLatest(): Promise<Policy | null>;
  list(): Promise<Policy[]>;
}

export interface InterventionRepository {
  upsert(intervention: Intervention): Promise<void>;
  getById(id: UUID): Promise<Intervention | null>;
  listByStudent(studentId: UUID): Promise<Intervention[]>;
  list(): Promise<Intervention[]>;
}

export interface NotificationRepository {
  upsert(notification: Notification): Promise<void>;
  listByStudent(studentId: UUID): Promise<Notification[]>;
  list(): Promise<Notification[]>;
}

export interface AuditEventRepository {
  append(event: AuditEvent): Promise<void>;
  listByEntity(entityType: string, entityId: string): Promise<AuditEvent[]>;
  list(): Promise<AuditEvent[]>;
}

export interface StorageRepositories {
  students: StudentRepository;
  guardianContacts: GuardianContactRepository;
  rawIncidents: RawIncidentRepository;
  approvedIncidents: ApprovedIncidentRepository;
  parseRuns: ParseRunRepository;
  reviewTasks: ReviewTaskRepository;
  policies: PolicyRepository;
  interventions: InterventionRepository;
  notifications: NotificationRepository;
  auditEvents: AuditEventRepository;
}
