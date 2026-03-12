import assert from "node:assert/strict";
import test from "node:test";

import { authenticate, createSessionToken, verifySessionToken } from "../lib/auth";

function withEnv<T>(updates: Record<string, string | undefined>, run: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(updates)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("createSessionToken/verifySessionToken round-trip", () => {
  withEnv(
    {
      AUTH_SESSION_SECRET: "x".repeat(40)
    },
    () => {
      const token = createSessionToken("admin@school.org", "admin");
      const payload = verifySessionToken(token);
      assert.equal(payload?.email, "admin@school.org");
      assert.equal(payload?.role, "admin");
    }
  );
});

test("authenticate uses configured credentials only", () => {
  withEnv(
    {
      AUTH_ADMIN_EMAIL: "admin@school.org",
      AUTH_ADMIN_PASSWORD: "super-secret-admin",
      AUTH_REVIEWER_EMAIL: "reviewer@school.org",
      AUTH_REVIEWER_PASSWORD: "super-secret-reviewer"
    },
    () => {
      assert.equal(
        authenticate("admin@school.org", "super-secret-admin")?.role,
        "admin"
      );
      assert.equal(
        authenticate("reviewer@school.org", "super-secret-reviewer")?.role,
        "reviewer"
      );
      assert.equal(authenticate("admin@school.org", "wrong-password"), null);
    }
  );
});

test("authenticate throws when auth env is missing", () => {
  withEnv(
    {
      AUTH_ADMIN_EMAIL: undefined,
      AUTH_ADMIN_PASSWORD: undefined,
      AUTH_REVIEWER_EMAIL: undefined,
      AUTH_REVIEWER_PASSWORD: undefined
    },
    () => {
      assert.throws(() => authenticate("admin@school.org", "secret"), /Missing required environment variable/);
    }
  );
});
