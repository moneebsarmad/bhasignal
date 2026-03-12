import { randomUUID } from "node:crypto";

import type { AuditEvent, IngestionSourceType, ParseRun } from "@syc/domain";
import type { StorageRepositories } from "@syc/storage";

import {
  buildManualPdfCandidateRecord,
  buildRawIncidentFromCandidate,
  buildReviewTask,
  countPdfPages,
  createPendingParseRun,
  defaultReviewRules,
  shouldRequireReviewCandidate,
  type SourceCandidateRecord,
  type ReviewRules
} from "@/lib/ingestion";
import type { ParseResponse } from "@/lib/parser-contract";

export interface IngestionProcessInput {
  storage: StorageRepositories;
  actorEmail: string;
  fileName: string;
  fileBuffer: Buffer;
  parsePdf: (input: { fileName: string; contentBase64: string }) => Promise<ParseResponse>;
  retryParseRunId?: string | null;
  reviewRules?: ReviewRules;
  retryMaxAttempts?: number;
  retryBaseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface SourceIngestionProcessInput {
  storage: StorageRepositories;
  actorEmail: string;
  sourceType: IngestionSourceType;
  fileName: string;
  sourceRecords: SourceCandidateRecord[];
  sourceWarnings?: string[];
  retryParseRunId?: string | null;
  reviewRules?: ReviewRules;
  triggeredBy?: string;
  metadataJson?: string;
  cursorJson?: string | null;
}

export interface IngestionProcessResult {
  parseRun: ParseRun;
  parserVersion: string;
  parserWarnings: string[];
}

export class IngestionProcessError extends Error {
  readonly parseRunId: string;

  constructor(message: string, parseRunId: string) {
    super(message);
    this.name = "IngestionProcessError";
    this.parseRunId = parseRunId;
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

export function isTransientParserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(returned 5\d\d|fetch failed|network|timed out|econn|enotfound|502|503|504)/i.test(message);
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function parseWithRetry(input: {
  parsePdf: IngestionProcessInput["parsePdf"];
  fileName: string;
  contentBase64: string;
  maxAttempts: number;
  baseDelayMs: number;
  sleep: (ms: number) => Promise<void>;
}): Promise<ParseResponse> {
  let attempt = 1;
  while (true) {
    try {
      return await input.parsePdf({
        fileName: input.fileName,
        contentBase64: input.contentBase64
      });
    } catch (error) {
      const canRetry = attempt < input.maxAttempts && isTransientParserError(error);
      if (!canRetry) {
        throw error;
      }
      const waitMs = input.baseDelayMs * 2 ** (attempt - 1);
      await input.sleep(waitMs);
      attempt += 1;
    }
  }
}

async function persistCandidateRecords(input: {
  storage: StorageRepositories;
  actorEmail: string;
  parseRun: ParseRun;
  sourceRecords: SourceCandidateRecord[];
  sourceWarnings: string[];
  reviewRules: ReviewRules;
}): Promise<ParseRun> {
  const staleRawIncidents = await input.storage.rawIncidents.listByParseRun(input.parseRun.id);
  const staleReviewTasks = await input.storage.reviewTasks.listByParseRun(input.parseRun.id);
  const existingTaskByRawIncident = new Map(
    staleReviewTasks.map((task) => [task.rawIncidentId, task] as const)
  );
  const seenRawIds = new Set<string>();

  let rowsFlagged = 0;
  for (let index = 0; index < input.sourceRecords.length; index += 1) {
    const record = input.sourceRecords[index];
    if (!record) {
      continue;
    }

    const rawIncident = buildRawIncidentFromCandidate({
      parseRunId: input.parseRun.id,
      candidate: record,
      rowNumber: index + 1
    });
    seenRawIds.add(rawIncident.id);
    await input.storage.rawIncidents.upsert(rawIncident);

    const requiresReview = shouldRequireReviewCandidate(record, input.reviewRules);
    if (requiresReview) {
      rowsFlagged += 1;
    }

    const existingTask = existingTaskByRawIncident.get(rawIncident.id);
    await input.storage.reviewTasks.upsert(
      buildReviewTask({
        id: existingTask?.id,
        parseRunId: input.parseRun.id,
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
    await input.storage.rawIncidents.upsert({ ...staleRow, status: "rejected" });
  }

  for (const task of staleReviewTasks) {
    if (seenRawIds.has(task.rawIncidentId)) {
      continue;
    }
    await input.storage.reviewTasks.upsert({
      ...task,
      status: "rejected",
      resolution: "stale_after_retry",
      resolvedAt: new Date().toISOString()
    });
  }

  const completedAt = new Date().toISOString();
  const finalRun: ParseRun = {
    ...input.parseRun,
    status: input.sourceRecords.length > 0 ? "review_required" : "completed",
    rowsExtracted: input.sourceRecords.length,
    rowsFlagged,
    completedAt
  };

  await input.storage.parseRuns.upsert(finalRun);
  await input.storage.auditEvents.append(
    createAuditEvent({
      eventType: "ingestion_job_completed",
      parseRunId: input.parseRun.id,
      actor: input.actorEmail,
      payload: {
        sourceType: input.parseRun.sourceType,
        rowsExtracted: input.sourceRecords.length,
        rowsFlagged,
        sourceWarnings: input.sourceWarnings,
        retriesEnabled: true
      }
    })
  );

  if (input.sourceWarnings.length > 0) {
    await input.storage.auditEvents.append(
      createAuditEvent({
        eventType: "ingestion_job_warning",
        parseRunId: input.parseRun.id,
        actor: input.actorEmail,
        payload: { warnings: input.sourceWarnings }
      })
    );
  }

  return finalRun;
}

async function startSourceIngestionRun(input: {
  storage: StorageRepositories;
  actorEmail: string;
  sourceType: IngestionSourceType;
  fileName: string;
  retryParseRunId?: string | null;
  triggeredBy?: string;
  metadataJson?: string;
  cursorJson?: string | null;
}): Promise<ParseRun> {
  const retryParseRunId = input.retryParseRunId?.trim() || null;
  const parseRunId = retryParseRunId || randomUUID();

  let pendingRun: ParseRun;
  if (retryParseRunId) {
    const existingRun = await input.storage.parseRuns.getById(retryParseRunId);
    if (!existingRun) {
      throw new Error("Retry parse run not found.");
    }
    if (existingRun.status !== "failed") {
      throw new Error("Only failed parse runs can be retried with parseRunId.");
    }

    pendingRun = {
      ...existingRun,
      sourceType: input.sourceType,
      fileName: input.fileName,
      uploadedBy: input.actorEmail,
      triggeredBy: input.triggeredBy ?? input.actorEmail,
      metadataJson: input.metadataJson ?? existingRun.metadataJson,
      cursorJson: input.cursorJson ?? null,
      status: "pending",
      rowsExtracted: 0,
      rowsFlagged: 0,
      startedAt: new Date().toISOString(),
      completedAt: null
    };
  } else {
    pendingRun = createPendingParseRun({
      id: parseRunId,
      sourceType: input.sourceType,
      fileName: input.fileName,
      uploadedBy: input.actorEmail,
      triggeredBy: input.triggeredBy ?? input.actorEmail,
      metadataJson: input.metadataJson ?? "{}",
      cursorJson: input.cursorJson ?? null,
      startedAt: new Date().toISOString()
    });
  }

  await input.storage.parseRuns.upsert(pendingRun);

  if (retryParseRunId) {
    await input.storage.auditEvents.append(
      createAuditEvent({
        eventType: "ingestion_job_retry_requested",
        parseRunId,
        actor: input.actorEmail,
        payload: {
          sourceType: pendingRun.sourceType,
          previousStatus: "failed",
          fileName: input.fileName
        }
      })
    );
  } else {
    await input.storage.auditEvents.append(
      createAuditEvent({
        eventType: "ingestion_job_created",
        parseRunId,
        actor: input.actorEmail,
        payload: {
          sourceType: pendingRun.sourceType,
          fileName: input.fileName
        }
      })
    );
  }

  const processingRun: ParseRun = {
    ...pendingRun,
    status: "processing"
  };
  await input.storage.parseRuns.upsert(processingRun);
  return processingRun;
}

async function failSourceIngestionRun(input: {
  storage: StorageRepositories;
  actorEmail: string;
  parseRun: ParseRun;
  error: string;
}): Promise<never> {
  const failedRun: ParseRun = {
    ...input.parseRun,
    status: "failed",
    completedAt: new Date().toISOString()
  };
  await input.storage.parseRuns.upsert(failedRun);
  await input.storage.auditEvents.append(
    createAuditEvent({
      eventType: "ingestion_job_failed",
      parseRunId: input.parseRun.id,
      actor: input.actorEmail,
      payload: { sourceType: input.parseRun.sourceType, error: input.error }
    })
  );
  throw new IngestionProcessError(input.error, input.parseRun.id);
}

export async function processSourceIngestionRecords(
  input: SourceIngestionProcessInput
): Promise<{ parseRun: ParseRun; sourceWarnings: string[] }> {
  const reviewRules = input.reviewRules ?? defaultReviewRules;
  const processingRun = await startSourceIngestionRun({
    storage: input.storage,
    actorEmail: input.actorEmail,
    sourceType: input.sourceType,
    fileName: input.fileName,
    retryParseRunId: input.retryParseRunId,
    triggeredBy: input.triggeredBy,
    metadataJson: input.metadataJson,
    cursorJson: input.cursorJson
  });

  try {
    const finalRun = await persistCandidateRecords({
      storage: input.storage,
      actorEmail: input.actorEmail,
      parseRun: processingRun,
      sourceRecords: input.sourceRecords,
      sourceWarnings: input.sourceWarnings ?? [],
      reviewRules
    });

    return {
      parseRun: finalRun,
      sourceWarnings: input.sourceWarnings ?? []
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ingestion failure.";
    return failSourceIngestionRun({
      storage: input.storage,
      actorEmail: input.actorEmail,
      parseRun: processingRun,
      error: message
    });
  }
}

export async function processIngestionUpload(
  input: IngestionProcessInput
): Promise<IngestionProcessResult> {
  const retryMaxAttempts = Math.max(1, Math.trunc(input.retryMaxAttempts ?? 3));
  const retryBaseDelayMs = Math.max(1, Math.trunc(input.retryBaseDelayMs ?? 500));
  const sleepFn = input.sleep ?? defaultSleep;

  const pageCount = countPdfPages(input.fileBuffer);
  const initialMetadata = JSON.stringify({
    fileName: input.fileName,
    fileSize: input.fileBuffer.byteLength,
    pageCount
  });
  const processingRun = await startSourceIngestionRun({
    storage: input.storage,
    actorEmail: input.actorEmail,
    sourceType: "manual_pdf",
    fileName: input.fileName,
    retryParseRunId: input.retryParseRunId,
    triggeredBy: input.actorEmail,
    metadataJson: initialMetadata,
    cursorJson: null
  });

  try {
    const parserResult = await parseWithRetry({
      parsePdf: input.parsePdf,
      fileName: input.fileName,
      contentBase64: input.fileBuffer.toString("base64"),
      maxAttempts: retryMaxAttempts,
      baseDelayMs: retryBaseDelayMs,
      sleep: sleepFn
    });
    const sourceRecords = parserResult.records.map((record, index) =>
      buildManualPdfCandidateRecord({
        record,
        rowNumber: index + 1
      })
    );
    const processingRunWithMetadata: ParseRun = {
      ...processingRun,
      metadataJson: JSON.stringify({
        fileName: input.fileName,
        fileSize: input.fileBuffer.byteLength,
        pageCount,
        parserVersion: parserResult.parserVersion
      })
    };
    await input.storage.parseRuns.upsert(processingRunWithMetadata);

    const finalRun = await persistCandidateRecords({
      storage: input.storage,
      actorEmail: input.actorEmail,
      parseRun: processingRunWithMetadata,
      sourceRecords,
      sourceWarnings: parserResult.warnings,
      reviewRules: input.reviewRules ?? defaultReviewRules
    });

    return {
      parseRun: finalRun,
      parserVersion: parserResult.parserVersion,
      parserWarnings: parserResult.warnings
    };
  } catch (error) {
    if (error instanceof IngestionProcessError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Unknown ingestion failure.";
    return failSourceIngestionRun({
      storage: input.storage,
      actorEmail: input.actorEmail,
      parseRun: processingRun,
      error: message
    });
  }
}
