import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSycamoreDisciplineRecords,
  normalizeSycamoreStudentRecords
} from "../lib/sycamore-normalizer";

test("normalizeSycamoreDisciplineRecords maps Sycamore discipline rows into source candidates", () => {
  const result = normalizeSycamoreDisciplineRecords([
    {
      ID: "disc-1",
      StudentID: "student-1",
      Student: "Jane Doe",
      Grade: "7",
      Violation: "Disrespect",
      Description: "Repeated classroom disruption",
      Points: "4",
      Created: "2026-03-10T14:05:00Z",
      Author: "Ms Smith"
    }
  ]);

  assert.equal(result.warnings.length, 0);
  assert.equal(result.sourceRecords.length, 1);
  assert.equal(result.sourceRecords[0]?.sourceType, "sycamore_api");
  assert.equal(result.sourceRecords[0]?.sourceRecordId, "disc-1");
  assert.equal(result.sourceRecords[0]?.externalStudentId, "student-1");
  assert.equal(result.sourceRecords[0]?.gradeAtEvent, "7");
  assert.equal(result.sourceRecords[0]?.eventType, "discipline");
  assert.equal(result.sourceRecords[0]?.writeupDate, "2026-03-10");
  assert.equal(result.sourceRecords[0]?.points, 4);
  assert.equal(result.sourceRecords[0]?.reason, "Disrespect");
  assert.equal(result.sourceRecords[0]?.violation, "Disrespect");
  assert.equal(result.sourceRecords[0]?.violationRaw, "Disrespect");
  assert.equal(result.sourceRecords[0]?.teacherName, "Ms Smith");
  assert.equal(result.sourceRecords[0]?.authorName, "Ms Smith");
});

test("normalizeSycamoreDisciplineRecords normalizes numeric grades embedded in labels", () => {
  const result = normalizeSycamoreDisciplineRecords([
    {
      ID: "disc-3",
      StudentID: "student-1",
      Student: "Jane Doe",
      Grade: "7th",
      Violation: "Disrespect",
      Points: "2",
      Created: "2026-03-10T14:05:00Z"
    }
  ]);

  assert.equal(result.sourceRecords[0]?.gradeAtEvent, "7");
});

test("normalizeSycamoreDisciplineRecords splits level-prefixed violations", () => {
  const result = normalizeSycamoreDisciplineRecords([
    {
      ID: "disc-4",
      StudentID: "student-2",
      Student: "Danah Ginawi",
      Grade: "8",
      Violation: "Level 2: Disruptive Behavior",
      Description: "Spoke loudly and disrupted class",
      Points: "3",
      Created: "2026-03-11T11:00:00Z",
      Author: "Bou Imajjane, Abir"
    }
  ]);

  assert.equal(result.sourceRecords[0]?.level, 2);
  assert.equal(result.sourceRecords[0]?.violation, "Disruptive Behavior");
  assert.equal(result.sourceRecords[0]?.violationRaw, "Level 2: Disruptive Behavior");
  assert.equal(result.sourceRecords[0]?.authorName, "Abir Bou Imajjane");
  assert.equal(result.sourceRecords[0]?.authorNameRaw, "Bou Imajjane, Abir");
});

test("normalizeSycamoreStudentRecords maps roster rows into local student records", () => {
  const result = normalizeSycamoreStudentRecords(
    [
      {
        ID: "student-1",
        StudentCode: "DOE100",
        FirstName: "Jane",
        LastName: "Doe",
        Grade: "7th",
        Graduated: "0"
      }
    ],
    "2026-03-10T10:00:00.000Z"
  );

  assert.equal(result.warnings.length, 0);
  assert.equal(result.students.length, 1);
  assert.equal(result.students[0]?.externalId, "student-1");
  assert.equal(result.students[0]?.fullName, "Jane Doe");
  assert.equal(result.students[0]?.grade, "7");
  assert.equal(result.students[0]?.active, true);
});

test("normalizeSycamoreDisciplineRecords emits warnings for missing critical fields", () => {
  const result = normalizeSycamoreDisciplineRecords([
    {
      ID: "disc-2",
      Description: "No student and bad points",
      Points: "n/a",
      Created: "not-a-date"
    }
  ]);

  assert.equal(result.sourceRecords.length, 1);
  const record = result.sourceRecords[0];
  assert.ok(record);
  assert.equal(record.studentConfidence, 0);
  assert.equal(record.points, 0);
  assert.equal((record.recordConfidence ?? 0) < 0.88, true);
  assert.equal(record.warnings.includes("missing_student"), true);
  assert.equal(record.warnings.some((warning) => warning.startsWith("invalid_points:")), true);
  assert.equal(record.warnings.some((warning) => warning.startsWith("invalid_occurred_at:")), true);
});
