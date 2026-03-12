import type { ParseRun } from "@syc/domain";
import type { StorageRepositories } from "@syc/storage";

import { processSourceIngestionRecords } from "@/lib/ingestion-workflow";
import {
  fetchSycamoreDisciplineRange,
  getSycamoreClientConfigFromEnv,
  type SycamoreClientDependencies
} from "@/lib/sycamore-client";
import {
  resolveSycamoreDateWindow,
  sycamoreSyncRequestSchema,
  type SycamoreSyncRequest
} from "@/lib/sycamore-contract";
import { normalizeSycamoreDisciplineRecords } from "@/lib/sycamore-normalizer";

export interface SyncSycamoreDisciplineInput {
  storage: StorageRepositories;
  actorEmail: string;
  request: SycamoreSyncRequest;
  dependencies?: SycamoreClientDependencies;
}

export interface SyncSycamoreDisciplineResult {
  parseRun: ParseRun;
  sourceWarnings: string[];
  fetchedRecords: number;
  dateWindow: {
    startDate: string;
    endDate: string;
  };
}

export async function syncSycamoreDiscipline(
  input: SyncSycamoreDisciplineInput
): Promise<SyncSycamoreDisciplineResult> {
  const request = sycamoreSyncRequestSchema.parse(input.request);
  const config = getSycamoreClientConfigFromEnv();
  const dateWindow = resolveSycamoreDateWindow(request);
  const fetched = await fetchSycamoreDisciplineRange(dateWindow, config, input.dependencies);
  const normalized = normalizeSycamoreDisciplineRecords(fetched.records);
  const combinedWarnings = [...fetched.warnings, ...normalized.warnings];

  const metadataJson = JSON.stringify({
    kind: "sycamore_discipline_sync",
    schoolId: config.schoolId,
    baseUrl: config.baseUrl,
    startDate: dateWindow.startDate,
    endDate: dateWindow.endDate,
    fetchedRecords: fetched.records.length
  });

  const result = await processSourceIngestionRecords({
    storage: input.storage,
    actorEmail: input.actorEmail,
    sourceType: "sycamore_api",
    fileName: `sycamore-discipline-${dateWindow.startDate}_to_${dateWindow.endDate}.json`,
    sourceRecords: normalized.sourceRecords,
    sourceWarnings: combinedWarnings,
    retryParseRunId: request.retryParseRunId,
    triggeredBy: input.actorEmail,
    metadataJson,
    cursorJson: JSON.stringify({
      endDate: dateWindow.endDate
    })
  });

  return {
    parseRun: result.parseRun,
    sourceWarnings: result.sourceWarnings,
    fetchedRecords: fetched.records.length,
    dateWindow
  };
}

