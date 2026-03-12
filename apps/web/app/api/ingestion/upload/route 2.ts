import { randomUUID } from "node:crypto";

import type { AuditEvent, ParseRun } from "@syc/domain";
import { NextRequest, NextResponse } from "next/server";

import {
  buildRawIncident,
  buildReviewTask,
  countPdfPages,
  createPendingParseRun,
  defaultReviewRules,
  shouldRequireReview
} from "@/lib/ingestion";
import { parseDisciplinePdf } from "@/lib/parser-client";
import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter } from "@/lib/storage";

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isTransientParserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(returned 5\d\d|fetch failed|network|timed out|econn|enotfound|502|503|504)/i.test(message);
}

async function parseWithRetry(input: { fileName: string; contentBase64: string }): Promise<Awaited<ReturnType<typeof parseDisciplinePdf>>> {
  const maxAttempts = envNumber("PARSER_MAX_ATTEMPTS", 3);
  const baseDelayMs = envNumber("PARSER_RETRY_BASE_MS", 500);

  let attempt = 1;
  while (true) {
    try {
      return await parseDisciplinePdf(input);
    } catch (error) {
      const canRetry = attempt < maxAttempts && isTransientParserError(error);
      if (!canRetry) {
        throw error;
      }
      const waitMs = baseDelayMs * 2 ** (attempt - 1);
      await sleep(waitMs);
      attempt += 1;
    }
  }
}

function createAuditEvent(input: {
  eventType: string;
  parseRunId: string;
  actor: string;
  payload: unknown;
}): AuditEvent {
  return {
    id: randomUUID(),
    eventType: input.eventType,
    entityType: "parse_run",
    entityId: input.parseRunId,
    actor: input.actor,
    payloadJson: JSON.stringify(input.payload),
    createdAt: new Date().toISOString()
  };
}

export async function POST(request: NextRequest) {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid multipart form payload." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing PDF file in form field `file`." }, { status: 400 });
  }

  if (!isPdfFile(file)) {
    return NextResponse.json({ error: "Only PDF uploads are supported." }, { status: 400 });
  }

  const maxUploadBytes = envNumber("INGESTION_MAX_UPLOAD_BYTES", 15 * 1024 * 1024);
  if (file.size > maxUploadBytes) {
    return NextResponse.json(
      { error: `File exceeds max upload size (${maxUploadBytes} bytes).` },
      { status: 413 }
    );
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const maxUploadPages = envNumber("INGESTION_MAX_UPLOAD_PAGES", 150);
  const pageCount = countPdfPages(fileBuffer);
  if (maxUploadPages > 0 && pageCount > maxUploadPages) {
    return NextResponse.json(
      { error: `PDF exceeds max page limit (${maxUploadPages}).`, pageCount },
      { status: 400 }
    );
  }

  const storage = createStorageAdapter();
  await storage.ensureSchema();

  const retryParseRunIdRaw = formData.get("parseRunId");
  const retryParseRunId =
    typeof retryParseRunIdRaw === "string" && retryParseRunIdRaw.trim()
      ? retryParseRunIdRaw.trim()
      : null;

  const parseRunId = retryParseRunId || randomUUID();
  let pendingRun: ParseRun;

  if (retryParseRunId) {
    const existingRun = await storage.parseRuns.getById(retryParseRunId);
    if (!existingRun) {
      return NextResponse.json({ error: "Retry parse run not found." }, { status: 404 });
    }
    if (existingRun.status !== "failed") {
      return NextResponse.json(
        { error: "Only failed parse runs can be retried with parseRunId." },
        { status: 409 }
      );
    }

    pendingRun = {
      ...existingRun,
      fileName: file.name,
      uploadedBy: session.email,
      status: "pending",
      rowsExtracted: 0,
      rowsFlagged: 0,
      startedAt: new Date().toISOString(),
      completedAt: null
    };
  } else {
    pendingRun = createPendingParseRun({
      id: parseRunId,
      fileName: file.name,
      uploadedBy: session.email,
      startedAt: new Date().toISOString()
    });
  }

  await storage.parseRuns.upsert(pendingRun);

  if (retryParseRunId) {
    await storage.auditEvents.append(
      createAuditEvent({
        eventType: "ingestion_job_retry_requested",
        parseRunId,
        actor: session.email,
        payload: {
          previousStatus: "failed",
          fileName: file.name,
          fileSize: file.size,
          pageCount
        }
      })
    );
  } else {
    await storage.auditEvents.append(
      createAuditEvent({
        eventType: "ingestion_job_created",
        parseRunId,
        actor: session.email,
        payload: {
          fileName: file.name,
          fileSize: file.size,
          pageCount
        }
      })
    );
  }

  const processingRun: ParseRun = {
    ...pendingRun,
    status: "processing"
  };
  await storage.parseRuns.upsert(processingRun);

  try {
    const parserResult = await parseWithRetry({
      fileName: file.name,
      contentBase64: fileBuffer.toString("base64")
    });

    const staleRawIncidents = await storage.rawIncidents.listByParseRun(parseRunId);
    const staleReviewTasks = await storage.reviewTasks.listByParseRun(parseRunId);
    const existingTaskByRawIncident = new Map(
      staleReviewTasks.map((task) => [task.rawIncidentId, task] as const)
    );
    const seenRawIds = new Set<string>();

    let rowsFlagged = 0;
    for (let index = 0; index < parserResult.records.length; index += 1) {
      const record = parserResult.records[index];
      if (!record) {
        continue;
      }

      const rawIncident = buildRawIncident({
        parseRunId,
        record,
        rowNumber: index + 1
      });
      seenRawIds.add(rawIncident.id);

      await storage.rawIncidents.upsert(rawIncident);

      const requiresReview = shouldRequireReview(record, defaultReviewRules);
      if (requiresReview) {
        rowsFlagged += 1;
      }

      const existingTask = existingTaskByRawIncident.get(rawIncident.id);
      await storage.reviewTasks.upsert(
        buildReviewTask({
          id: existingTask?.id,
          parseRunId,
          rawIncidentId: rawIncident.id,
          createdAt: new Date().toISOString(),
          resolution: requiresReview ? "low_confidence_or_warning" : "high_confidence_review_queue"
        })
      );
    }

    for (const staleRow of staleRawIncidents) {
      if (seenRawIds.has(staleRow.id)) {
        continue;
      }
      await storage.rawIncidents.upsert({ ...staleRow, status: "rejected" });
    }

    for (const task of staleReviewTasks) {
      if (seenRawIds.has(task.rawIncidentId)) {
        continue;
      }
      await storage.reviewTasks.upsert({
        ...task,
        status: "rejected",
        resolution: "stale_after_retry",
        resolvedAt: new Date().toISOString()
      });
    }

    const completedAt = new Date().toISOString();
    const finalRun: ParseRun = {
      ...processingRun,
      status: parserResult.records.length > 0 ? "review_required" : "completed",
      rowsExtracted: parserResult.records.length,
      rowsFlagged,
      completedAt
    };

    await storage.parseRuns.upsert(finalRun);

    await storage.auditEvents.append(
      createAuditEvent({
        eventType: "ingestion_job_completed",
        parseRunId,
        actor: session.email,
        payload: {
          rowsExtracted: parserResult.records.length,
          rowsFlagged,
          parserWarnings: parserResult.warnings,
          retriesEnabled: true
        }
      })
    );

    if (parserResult.warnings.length > 0) {
      await storage.auditEvents.append(
        createAuditEvent({
          eventType: "ingestion_job_warning",
          parseRunId,
          actor: session.email,
          payload: { warnings: parserResult.warnings }
        })
      );
    }

    return NextResponse.json(
      {
        parseRun: finalRun,
        parserVersion: parserResult.parserVersion,
        parserWarnings: parserResult.warnings
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ingestion failure.";
    const failedRun: ParseRun = {
      ...processingRun,
      status: "failed",
      completedAt: new Date().toISOString()
    };
    await storage.parseRuns.upsert(failedRun);
    await storage.auditEvents.append(
      createAuditEvent({
        eventType: "ingestion_job_failed",
        parseRunId,
        actor: session.email,
        payload: { error: message }
      })
    );
    return NextResponse.json(
      {
        error: message,
        parseRunId
      },
      { status: 502 }
    );
  }
}
