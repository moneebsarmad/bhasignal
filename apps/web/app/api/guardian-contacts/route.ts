import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter, prepareStorage } from "@/lib/storage";

export async function GET() {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storage = createStorageAdapter();
  await prepareStorage(storage);
  const [contacts, students] = await Promise.all([
    storage.guardianContacts.list(),
    storage.students.list()
  ]);
  const studentMap = new Map(students.map((student) => [student.id, student] as const));

  const rows = contacts
    .map((contact) => ({
      ...contact,
      studentName: studentMap.get(contact.studentId)?.fullName || contact.studentId,
      grade: studentMap.get(contact.studentId)?.grade || "unknown"
    }))
    .sort((left, right) => left.studentName.localeCompare(right.studentName) || left.id.localeCompare(right.id));

  const summary = {
    totalContacts: rows.length,
    emailEnabledContacts: rows.filter((contact) => contact.isActive && contact.allowEmail && contact.email).length,
    studentsCovered: new Set(rows.filter((contact) => contact.email && contact.isActive).map((contact) => contact.studentId)).size
  };

  return NextResponse.json({ summary, rows }, { status: 200 });
}
