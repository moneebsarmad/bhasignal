import type {
  ApprovedIncident,
  AuditEvent,
  Intervention,
  Notification,
  ParseRun,
  Policy,
  RawIncident,
  ReviewTask,
  Student
} from "@syc/domain";
import type { StorageRepositories } from "@syc/storage";

export type AppStorageAdapter = StorageRepositories & { ensureSchema: () => Promise<void> };

export class LocalStorageAdapter implements AppStorageAdapter {
  private studentsData: Student[] = [];
  private rawIncidentsData: RawIncident[] = [];
  private approvedIncidentsData: ApprovedIncident[] = [];
  private parseRunsData: ParseRun[] = [];
  private reviewTasksData: ReviewTask[] = [];
  private policiesData: Policy[] = [];
  private interventionsData: Intervention[] = [];
  private notificationsData: Notification[] = [];
  private auditEventsData: AuditEvent[] = [];

  readonly students = {
    upsert: async (student: Student) => {
      const index = this.studentsData.findIndex((item) => item.id === student.id);
      if (index >= 0) {
        this.studentsData[index] = student;
      } else {
        this.studentsData.push(student);
      }
    },
    getById: async (id: string) => this.studentsData.find((item) => item.id === id) ?? null,
    list: async () => [...this.studentsData]
  };

  readonly rawIncidents = {
    upsert: async (incident: RawIncident) => {
      const index = this.rawIncidentsData.findIndex((item) => item.id === incident.id);
      if (index >= 0) {
        this.rawIncidentsData[index] = incident;
      } else {
        this.rawIncidentsData.push(incident);
      }
    },
    getById: async (id: string) => this.rawIncidentsData.find((item) => item.id === id) ?? null,
    listByParseRun: async (parseRunId: string) =>
      this.rawIncidentsData.filter((item) => item.parseRunId === parseRunId),
    listByStatus: async (status: RawIncident["status"]) =>
      this.rawIncidentsData.filter((item) => item.status === status),
    list: async () => [...this.rawIncidentsData]
  };

  readonly approvedIncidents = {
    upsert: async (incident: ApprovedIncident) => {
      const index = this.approvedIncidentsData.findIndex(
        (item) => item.fingerprint === incident.fingerprint
      );
      if (index >= 0) {
        this.approvedIncidentsData[index] = {
          ...incident,
          id: this.approvedIncidentsData[index]?.id ?? incident.id
        };
      } else {
        this.approvedIncidentsData.push(incident);
      }
    },
    getById: async (id: string) =>
      this.approvedIncidentsData.find((item) => item.id === id) ?? null,
    getByFingerprint: async (fingerprint: string) =>
      this.approvedIncidentsData.find((item) => item.fingerprint === fingerprint) ?? null,
    listByStudent: async (studentId: string) =>
      this.approvedIncidentsData.filter((item) => item.studentId === studentId),
    list: async () => [...this.approvedIncidentsData]
  };

  readonly parseRuns = {
    upsert: async (parseRun: ParseRun) => {
      const index = this.parseRunsData.findIndex((item) => item.id === parseRun.id);
      if (index >= 0) {
        this.parseRunsData[index] = parseRun;
      } else {
        this.parseRunsData.push(parseRun);
      }
    },
    getById: async (id: string) => this.parseRunsData.find((item) => item.id === id) ?? null,
    list: async () => [...this.parseRunsData]
  };

  readonly reviewTasks = {
    upsert: async (task: ReviewTask) => {
      const index = this.reviewTasksData.findIndex((item) => item.id === task.id);
      if (index >= 0) {
        this.reviewTasksData[index] = task;
      } else {
        this.reviewTasksData.push(task);
      }
    },
    getById: async (id: string) => this.reviewTasksData.find((item) => item.id === id) ?? null,
    listByParseRun: async (parseRunId: string) =>
      this.reviewTasksData.filter((item) => item.parseRunId === parseRunId),
    listByStatus: async (status: ReviewTask["status"]) =>
      this.reviewTasksData.filter((item) => item.status === status)
  };

  readonly policies = {
    upsert: async (policy: Policy) => {
      const index = this.policiesData.findIndex((item) => item.version === policy.version);
      if (index >= 0) {
        this.policiesData[index] = policy;
      } else {
        this.policiesData.push(policy);
      }
    },
    getByVersion: async (version: number) =>
      this.policiesData.find((item) => item.version === version) ?? null,
    getLatest: async () =>
      [...this.policiesData].sort((left, right) => right.version - left.version)[0] ?? null,
    list: async () => [...this.policiesData]
  };

  readonly interventions = {
    upsert: async (intervention: Intervention) => {
      const index = this.interventionsData.findIndex((item) => item.id === intervention.id);
      if (index >= 0) {
        this.interventionsData[index] = intervention;
      } else {
        this.interventionsData.push(intervention);
      }
    },
    getById: async (id: string) =>
      this.interventionsData.find((item) => item.id === id) ?? null,
    listByStudent: async (studentId: string) =>
      this.interventionsData.filter((item) => item.studentId === studentId),
    list: async () => [...this.interventionsData]
  };

  readonly notifications = {
    upsert: async (notification: Notification) => {
      const index = this.notificationsData.findIndex((item) => item.id === notification.id);
      if (index >= 0) {
        this.notificationsData[index] = notification;
      } else {
        this.notificationsData.push(notification);
      }
    },
    listByStudent: async (studentId: string) =>
      this.notificationsData.filter((item) => item.studentId === studentId),
    list: async () => [...this.notificationsData]
  };

  readonly auditEvents = {
    append: async (event: AuditEvent) => {
      this.auditEventsData.push(event);
    },
    listByEntity: async (entityType: string, entityId: string) =>
      this.auditEventsData.filter(
        (event) => event.entityType === entityType && event.entityId === entityId
      ),
    list: async () => [...this.auditEventsData]
  };

  async ensureSchema(): Promise<void> {
    // No-op: local adapter uses in-memory arrays and does not require schema bootstrapping.
  }
}
