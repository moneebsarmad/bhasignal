import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";

import { createStorageAdapter } from "../lib/storage";

function withEnv<T>(updates: Record<string, string | undefined>, run: () => Promise<T> | T): Promise<T> | T {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(updates)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };

  try {
    const result = run();
    if (result instanceof Promise) {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

test("createStorageAdapter uses local file-backed adapter in development without Sheets env", async () => {
  const storageFile = `/tmp/syc-local-storage-${Date.now()}-dev.json`;
  await withEnv(
    {
      NODE_ENV: "development",
      LOCAL_STORAGE_FILE: storageFile,
      GOOGLE_SHEETS_SPREADSHEET_ID: undefined,
      GOOGLE_SERVICE_ACCOUNT_EMAIL: undefined,
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: undefined
    },
    async () => {
      const storage = createStorageAdapter();
      await storage.ensureSchema();
      await storage.students.upsert({
        id: "dev_student_1",
        externalId: null,
        fullName: "Local Dev Student",
        grade: "7",
        active: true,
        createdAt: "2026-02-12T00:00:00.000Z",
        updatedAt: "2026-02-12T00:00:00.000Z"
      });
      const student = await storage.students.getById("dev_student_1");
      assert.equal(student?.fullName, "Local Dev Student");
    }
  );
  await rm(storageFile, { force: true });
});

test("createStorageAdapter prefers Supabase when Supabase env is configured", () => {
  withEnv(
    {
      NODE_ENV: "development",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      GOOGLE_SHEETS_SPREADSHEET_ID: undefined,
      GOOGLE_SERVICE_ACCOUNT_EMAIL: undefined,
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: undefined
    },
    () => {
      const storage = createStorageAdapter();
      assert.ok(storage.students);
      assert.ok(storage.parseRuns);
      assert.equal(typeof storage.ensureSchema, "function");
    }
  );
});

test("createStorageAdapter rejects production fallback when remote storage env is missing", () => {
  const storageFile = `/tmp/syc-local-storage-${Date.now()}-prod.json`;
  withEnv(
    {
      NODE_ENV: "production",
      LOCAL_STORAGE_FILE: storageFile,
      NEXT_PUBLIC_SUPABASE_URL: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      GOOGLE_SHEETS_SPREADSHEET_ID: undefined,
      GOOGLE_SERVICE_ACCOUNT_EMAIL: undefined,
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: undefined
    },
    () => {
      assert.throws(
        () => createStorageAdapter(),
        /Supabase or Google Sheets credentials are required in production/
      );
    }
  );
});
