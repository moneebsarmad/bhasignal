import assert from "node:assert/strict";
import test from "node:test";

import { parseDisciplinePdf } from "../lib/parser-client";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

test.after(() => {
  globalThis.fetch = originalFetch;
  process.env = originalEnv;
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

test("parseDisciplinePdf normalizes snake_case parser response", async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        parser_version: "0.1.0",
        parsed_at: "2026-02-12T00:00:00Z",
        records: [
          {
            student: { value: "Jane Doe", confidence: 0.99 },
            occurred_at: { value: "2026-02-11", confidence: 0.98 },
            writeup_date: { value: "2026-02-11", confidence: 0.98 },
            points: { value: "3", confidence: 0.99 },
            reason: { value: "Disrespect", confidence: 0.95 },
            violation: { value: "Disrespect", confidence: 0.95 },
            violation_raw: { value: "Level 2: Disrespect", confidence: 0.95 },
            level: { value: "2", confidence: 0.99 },
            teacher: { value: "Mr. Adams", confidence: 0.94 },
            author_name: { value: "Mr. Adams", confidence: 0.94 },
            author_name_raw: { value: "Adams, Mr.", confidence: 0.94 },
            comment: { value: "Talking back", confidence: 0.9 },
            description: { value: "Talking back", confidence: 0.9 },
            resolution: { value: "", confidence: 1 },
            source_snippet: "raw snippet",
            record_confidence: 0.96,
            warnings: []
          }
        ],
        warnings: []
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  const parsed = await parseDisciplinePdf({
    fileName: "sample.pdf",
    contentBase64: "ZmFrZQ=="
  });

  assert.equal(parsed.parserVersion, "0.1.0");
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0]?.sourceSnippet, "raw snippet");
  assert.equal(parsed.records[0]?.occurredAt.value, "2026-02-11");
  assert.equal(parsed.records[0]?.writeupDate?.value, "2026-02-11");
  assert.equal(parsed.records[0]?.level?.value, "2");
  assert.equal(parsed.records[0]?.violation?.value, "Disrespect");
  assert.equal(parsed.records[0]?.teacher.value, "Mr. Adams");
});

test("parseDisciplinePdf throws when parser payload does not match contract", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ parser_version: "0.1.0", records: "bad-shape" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  await assert.rejects(
    () =>
      parseDisciplinePdf({
        fileName: "sample.pdf",
        contentBase64: "ZmFrZQ=="
      }),
    /Invalid|expected|required|records/i
  );
});

test("parseDisciplinePdf uses the IPv4 local parser default when env is empty", async () => {
  delete process.env.PARSER_BASE_URL;

  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        parser_version: "0.1.0",
        parsed_at: "2026-02-12T00:00:00Z",
        records: [],
        warnings: []
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  await parseDisciplinePdf({
    fileName: "sample.pdf",
    contentBase64: "ZmFrZQ=="
  });

  assert.equal(requestedUrl, "http://127.0.0.1:8000/parse");
});

test("parseDisciplinePdf surfaces parser timeouts clearly", async () => {
  process.env.PARSER_REQUEST_TIMEOUT_MS = "5";

  globalThis.fetch = async (_input, init) =>
    await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
      });
    });

  await assert.rejects(
    () =>
      parseDisciplinePdf({
        fileName: "sample.pdf",
        contentBase64: "ZmFrZQ=="
      }),
    /timed out after 5ms/i
  );
});
