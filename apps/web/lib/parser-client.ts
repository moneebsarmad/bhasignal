import { ParseRequest, parseRequestSchema, ParseResponse, parseResponseSchema } from "@/lib/parser-contract";
import { parserBaseUrl, parserRequestTimeoutMs } from "@/lib/parser-config";

export async function parseDisciplinePdf(input: ParseRequest): Promise<ParseResponse> {
  const request = parseRequestSchema.parse(input);
  const baseUrl = parserBaseUrl();
  const timeoutMs = parserRequestTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/parse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        file_name: request.fileName,
        content_base64: request.contentBase64
      }),
      cache: "no-store",
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Parser request timed out after ${timeoutMs}ms`);
    }
    if (error instanceof Error && /fetch failed|econn|enotfound|network/i.test(error.message)) {
      throw new Error(`Could not reach parser service at ${baseUrl}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Parser service returned ${response.status}`);
  }

  const raw = (await response.json()) as unknown;
  const normalized = normalizeParseResponse(raw);
  return parseResponseSchema.parse(normalized);
}

function normalizeParseResponse(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") {
    return raw;
  }

  const source = raw as Record<string, unknown>;
  const records = Array.isArray(source.records) ? source.records : [];
  const normalizedRecords = records.map((record) => {
    if (!record || typeof record !== "object") {
      return record;
    }
    const row = record as Record<string, unknown>;
    return {
      student: row.student,
      occurredAt: row.occurred_at ?? row.occurredAt,
      writeupDate: row.writeup_date ?? row.writeupDate,
      points: row.points,
      reason: row.reason,
      violation: row.violation,
      violationRaw: row.violation_raw ?? row.violationRaw,
      level: row.level,
      teacher: row.teacher,
      authorName: row.author_name ?? row.authorName,
      authorNameRaw: row.author_name_raw ?? row.authorNameRaw,
      comment: row.comment,
      description: row.description,
      resolution: row.resolution,
      sourceSnippet: row.source_snippet ?? row.sourceSnippet,
      recordConfidence: row.record_confidence ?? row.recordConfidence,
      warnings: row.warnings
    };
  });

  return {
    parserVersion: source.parser_version ?? source.parserVersion,
    parsedAt: source.parsed_at ?? source.parsedAt,
    records: normalizedRecords,
    warnings: source.warnings
  };
}
