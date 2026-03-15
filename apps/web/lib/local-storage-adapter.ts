import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

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
  Student
} from "@syc/domain";
import type { StorageRepositories } from "@syc/storage";

export type AppStorageAdapter = StorageRepositories & { ensureSchema: () => Promise<void> };

interface LocalStoreState {
  students: Student[];
  guardianContacts: GuardianContact[];
  rawIncidents: RawIncident[];
  approvedIncidents: ApprovedIncident[];
  parseRuns: ParseRun[];
  reviewTasks: ReviewTask[];
  policies: Policy[];
  interventions: Intervention[];
  notifications: Notification[];
  auditEvents: AuditEvent[];
}

const emptyStoreState = (): LocalStoreState => ({
  students: [],
  guardianContacts: [],
  rawIncidents: [],
  approvedIncidents: [],
  parseRuns: [],
  reviewTasks: [],
  policies: [],
  interventions: [],
  notifications: [],
  auditEvents: []
});

function storageFilePath(): string {
  const configured = process.env.LOCAL_STORAGE_FILE?.trim();
  if (configured) {
    return resolve(configured);
  }
  return resolve(process.cwd(), ".local", "web-storage.json");
}

function normalizeStore(raw: unknown): LocalStoreState {
  const parsed = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    students: Array.isArray(parsed.students) ? (parsed.students as Student[]) : [],
    guardianContacts: Array.isArray(parsed.guardianContacts)
      ? (parsed.guardianContacts as GuardianContact[])
      : [],
    rawIncidents: Array.isArray(parsed.rawIncidents)
      ? (parsed.rawIncidents as RawIncident[]).map(normalizeRawIncident)
      : [],
    approvedIncidents: Array.isArray(parsed.approvedIncidents)
      ? (parsed.approvedIncidents as ApprovedIncident[]).map(normalizeApprovedIncident)
      : [],
    parseRuns: Array.isArray(parsed.parseRuns) ? (parsed.parseRuns as ParseRun[]) : [],
    reviewTasks: Array.isArray(parsed.reviewTasks) ? (parsed.reviewTasks as ReviewTask[]) : [],
    policies: Array.isArray(parsed.policies) ? (parsed.policies as Policy[]) : [],
    interventions: Array.isArray(parsed.interventions) ? (parsed.interventions as Intervention[]) : [],
    notifications: Array.isArray(parsed.notifications) ? (parsed.notifications as Notification[]) : [],
    auditEvents: Array.isArray(parsed.auditEvents) ? (parsed.auditEvents as AuditEvent[]) : []
  };
}

function normalizeRawIncident(incident: RawIncident): RawIncident {
  return {
    ...incident,
    writeupDate: incident.writeupDate ?? null,
    violation: incident.violation ?? incident.reason ?? null,
    violationRaw: incident.violationRaw ?? incident.reason ?? null,
    level: incident.level ?? null,
    description: incident.description ?? incident.comment ?? null,
    resolution: incident.resolution ?? null,
    authorName: incident.authorName ?? incident.teacherName ?? null,
    authorNameRaw: incident.authorNameRaw ?? incident.teacherName ?? null
  };
}

function normalizeApprovedIncident(incident: ApprovedIncident): ApprovedIncident {
  return {
    ...incident,
    writeupDate: incident.writeupDate ?? null,
    violation: incident.violation ?? incident.reason ?? null,
    violationRaw: incident.violationRaw ?? incident.reason ?? null,
    level: incident.level ?? null,
    description: incident.description ?? incident.comment ?? null,
    resolution: incident.resolution ?? null,
    authorName: incident.authorName ?? incident.teacherName ?? null,
    authorNameRaw: incident.authorNameRaw ?? incident.teacherName ?? null
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("ENOENT")) {
      return false;
    }
    throw error;
  }
}

export class LocalStorageAdapter implements AppStorageAdapter {
  private readonly path = storageFilePath();

  private async readState(): Promise<LocalStoreState> {
    if (!(await fileExists(this.path))) {
      return emptyStoreState();
    }
    const raw = await readFile(this.path, "utf8");
    if (!raw.trim()) {
      return emptyStoreState();
    }
    return normalizeStore(JSON.parse(raw));
  }

  private async writeState(state: LocalStoreState): Promise<void> {
    const dir = dirname(this.path);
    await mkdir(dir, { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(state), "utf8");
    await rename(tmp, this.path);
  }

  private async withState<T>(mutate: (state: LocalStoreState) => T | Promise<T>): Promise<T> {
    const state = await this.readState();
    const result = await mutate(state);
    await this.writeState(state);
    return result;
  }

  private async fromState<T>(select: (state: LocalStoreState) => T | Promise<T>): Promise<T> {
    const state = await this.readState();
    return select(state);
  }

  readonly students = {
    upsert: async (student: Student) => {
      await this.withState((state) => {
        const index = state.students.findIndex((item) => item.id === student.id);
        if (index >= 0) {
          state.students[index] = student;
        } else {
          state.students.push(student);
        }
      });
    },
    getById: async (id: string) =>
      this.fromState((state) => state.students.find((item) => item.id === id) ?? null),
    list: async () => this.fromState((state) => [...state.students])
  };

  readonly guardianContacts = {
    upsert: async (contact: GuardianContact) => {
      await this.withState((state) => {
        const index = state.guardianContacts.findIndex((item) => item.id === contact.id);
        if (index >= 0) {
          state.guardianContacts[index] = contact;
        } else {
          state.guardianContacts.push(contact);
        }
      });
    },
    getById: async (id: string) =>
      this.fromState((state) => state.guardianContacts.find((item) => item.id === id) ?? null),
    listByStudent: async (studentId: string) =>
      this.fromState((state) => state.guardianContacts.filter((item) => item.studentId === studentId)),
    list: async () => this.fromState((state) => [...state.guardianContacts])
  };

  readonly rawIncidents = {
    upsert: async (incident: RawIncident) => {
      await this.withState((state) => {
        const index = state.rawIncidents.findIndex((item) => item.id === incident.id);
        if (index >= 0) {
          state.rawIncidents[index] = incident;
        } else {
          state.rawIncidents.push(incident);
        }
      });
    },
    getById: async (id: string) =>
      this.fromState((state) => state.rawIncidents.find((item) => item.id === id) ?? null),
    listByParseRun: async (parseRunId: string) =>
      this.fromState((state) => state.rawIncidents.filter((item) => item.parseRunId === parseRunId)),
    listByStatus: async (status: RawIncident["status"]) =>
      this.fromState((state) => state.rawIncidents.filter((item) => item.status === status)),
    list: async () => this.fromState((state) => [...state.rawIncidents])
  };

  readonly approvedIncidents = {
    upsert: async (incident: ApprovedIncident) => {
      await this.withState((state) => {
        const index = state.approvedIncidents.findIndex(
          (item) =>
            item.id === incident.id ||
            item.fingerprint === incident.fingerprint ||
            (incident.sourceType === "sycamore_api" &&
              item.sourceType === incident.sourceType &&
              item.sourceRecordId === incident.sourceRecordId)
        );
        if (index >= 0) {
          state.approvedIncidents[index] = {
            ...incident,
            id: state.approvedIncidents[index]?.id ?? incident.id
          };
        } else {
          state.approvedIncidents.push(incident);
        }
      });
    },
    getById: async (id: string) =>
      this.fromState((state) => state.approvedIncidents.find((item) => item.id === id) ?? null),
    getByFingerprint: async (fingerprint: string) =>
      this.fromState(
        (state) => state.approvedIncidents.find((item) => item.fingerprint === fingerprint) ?? null
      ),
    listByStudent: async (studentId: string) =>
      this.fromState((state) => state.approvedIncidents.filter((item) => item.studentId === studentId)),
    list: async () => this.fromState((state) => [...state.approvedIncidents])
  };

  readonly parseRuns = {
    upsert: async (parseRun: ParseRun) => {
      await this.withState((state) => {
        const index = state.parseRuns.findIndex((item) => item.id === parseRun.id);
        if (index >= 0) {
          state.parseRuns[index] = parseRun;
        } else {
          state.parseRuns.push(parseRun);
        }
      });
    },
    getById: async (id: string) =>
      this.fromState((state) => state.parseRuns.find((item) => item.id === id) ?? null),
    list: async () => this.fromState((state) => [...state.parseRuns])
  };

  readonly reviewTasks = {
    upsert: async (task: ReviewTask) => {
      await this.withState((state) => {
        const index = state.reviewTasks.findIndex((item) => item.id === task.id);
        if (index >= 0) {
          state.reviewTasks[index] = task;
        } else {
          state.reviewTasks.push(task);
        }
      });
    },
    getById: async (id: string) =>
      this.fromState((state) => state.reviewTasks.find((item) => item.id === id) ?? null),
    listByParseRun: async (parseRunId: string) =>
      this.fromState((state) => state.reviewTasks.filter((item) => item.parseRunId === parseRunId)),
    listByStatus: async (status: ReviewTask["status"]) =>
      this.fromState((state) => state.reviewTasks.filter((item) => item.status === status))
  };

  readonly policies = {
    upsert: async (policy: Policy) => {
      await this.withState((state) => {
        const index = state.policies.findIndex((item) => item.version === policy.version);
        if (index >= 0) {
          state.policies[index] = policy;
        } else {
          state.policies.push(policy);
        }
      });
    },
    getByVersion: async (version: number) =>
      this.fromState((state) => state.policies.find((item) => item.version === version) ?? null),
    getLatest: async () =>
      this.fromState(
        (state) => [...state.policies].sort((left, right) => right.version - left.version)[0] ?? null
      ),
    list: async () => this.fromState((state) => [...state.policies])
  };

  readonly interventions = {
    upsert: async (intervention: Intervention) => {
      await this.withState((state) => {
        const index = state.interventions.findIndex((item) => item.id === intervention.id);
        if (index >= 0) {
          state.interventions[index] = intervention;
        } else {
          state.interventions.push(intervention);
        }
      });
    },
    getById: async (id: string) =>
      this.fromState((state) => state.interventions.find((item) => item.id === id) ?? null),
    listByStudent: async (studentId: string) =>
      this.fromState((state) => state.interventions.filter((item) => item.studentId === studentId)),
    list: async () => this.fromState((state) => [...state.interventions])
  };

  readonly notifications = {
    upsert: async (notification: Notification) => {
      await this.withState((state) => {
        const index = state.notifications.findIndex((item) => item.id === notification.id);
        if (index >= 0) {
          state.notifications[index] = notification;
        } else {
          state.notifications.push(notification);
        }
      });
    },
    listByStudent: async (studentId: string) =>
      this.fromState((state) => state.notifications.filter((item) => item.studentId === studentId)),
    list: async () => this.fromState((state) => [...state.notifications])
  };

  readonly auditEvents = {
    append: async (event: AuditEvent) => {
      await this.withState((state) => {
        state.auditEvents.push(event);
      });
    },
    listByEntity: async (entityType: string, entityId: string) =>
      this.fromState((state) =>
        state.auditEvents.filter(
          (event) => event.entityType === entityType && event.entityId === entityId
        )
      ),
    list: async () => this.fromState((state) => [...state.auditEvents])
  };

  async ensureSchema(): Promise<void> {
    if (await fileExists(this.path)) {
      return;
    }
    await this.writeState(emptyStoreState());
  }
}
