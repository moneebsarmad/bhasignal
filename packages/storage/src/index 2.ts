import type { DisciplineIncident, Student, UUID } from "@syc/domain";

export interface StudentRepository {
  upsert(student: Student): Promise<void>;
  getById(id: UUID): Promise<Student | null>;
  list(): Promise<Student[]>;
}

export interface IncidentRepository {
  upsert(incident: DisciplineIncident): Promise<void>;
  getById(id: UUID): Promise<DisciplineIncident | null>;
  listByStudent(studentId: UUID): Promise<DisciplineIncident[]>;
}

export interface StorageRepositories {
  students: StudentRepository;
  incidents: IncidentRepository;
}

