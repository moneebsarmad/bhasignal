import { NextRequest, NextResponse } from "next/server";

import { countPdfPages } from "@/lib/ingestion";
import { IngestionProcessError, processIngestionUpload } from "@/lib/ingestion-workflow";
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

function collectUploadFiles(formData: FormData): File[] {
  const fromFiles = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (fromFiles.length > 0) {
    return fromFiles;
  }

  const single = formData.get("file");
  return single instanceof File ? [single] : [];
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

  const files = collectUploadFiles(formData);
  if (files.length === 0) {
    return NextResponse.json({ error: "Missing PDF file in form field `file` or `files`." }, { status: 400 });
  }

  const maxUploadBytes = envNumber("INGESTION_MAX_UPLOAD_BYTES", 15 * 1024 * 1024);
  const maxUploadPages = envNumber("INGESTION_MAX_UPLOAD_PAGES", 150);

  const retryParseRunIdRaw = formData.get("parseRunId");
  const retryParseRunId =
    typeof retryParseRunIdRaw === "string" && retryParseRunIdRaw.trim()
      ? retryParseRunIdRaw.trim()
      : null;
  if (retryParseRunId && files.length > 1) {
    return NextResponse.json(
      { error: "Retry uploads support only one PDF at a time." },
      { status: 400 }
    );
  }

  const storage = createStorageAdapter();
  await storage.ensureSchema();

  const uploadResults: Array<{
    fileName: string;
    parseRun?: Awaited<ReturnType<typeof processIngestionUpload>>["parseRun"];
    parserVersion?: string;
    parserWarnings?: string[];
    error?: string;
    parseRunId?: string;
    status: number;
  }> = [];

  for (const file of files) {
    if (!isPdfFile(file)) {
      uploadResults.push({
        fileName: file.name,
        error: "Only PDF uploads are supported.",
        status: 400
      });
      continue;
    }
    if (file.size > maxUploadBytes) {
      uploadResults.push({
        fileName: file.name,
        error: `File exceeds max upload size (${maxUploadBytes} bytes).`,
        status: 413
      });
      continue;
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const pageCount = countPdfPages(fileBuffer);
    if (maxUploadPages > 0 && pageCount > maxUploadPages) {
      uploadResults.push({
        fileName: file.name,
        error: `PDF exceeds max page limit (${maxUploadPages}).`,
        status: 400
      });
      continue;
    }

    try {
      const result = await processIngestionUpload({
        storage,
        actorEmail: session.email,
        fileName: file.name,
        fileBuffer,
        parsePdf: parseDisciplinePdf,
        retryParseRunId,
        retryMaxAttempts: envNumber("PARSER_MAX_ATTEMPTS", 3),
        retryBaseDelayMs: envNumber("PARSER_RETRY_BASE_MS", 500)
      });

      uploadResults.push({
        fileName: file.name,
        parseRun: result.parseRun,
        parserVersion: result.parserVersion,
        parserWarnings: result.parserWarnings,
        status: 200
      });
    } catch (error) {
      if (error instanceof IngestionProcessError) {
        uploadResults.push({
          fileName: file.name,
          error: error.message,
          parseRunId: error.parseRunId,
          status: 502
        });
        continue;
      }

      const message = error instanceof Error ? error.message : "Unknown ingestion failure.";
      const status = /not found/i.test(message) ? 404 : /only failed parse runs/i.test(message) ? 409 : 400;
      uploadResults.push({
        fileName: file.name,
        error: message,
        status
      });
    }
  }

  const successfulUploads = uploadResults.filter(
    (result): result is (typeof uploadResults)[number] & { parseRun: NonNullable<(typeof uploadResults)[number]["parseRun"]> } =>
      Boolean(result.parseRun)
  );
  const parseRuns = successfulUploads.map((result) => result.parseRun);
  const parserWarnings = successfulUploads.flatMap((result) => result.parserWarnings ?? []);
  const uploadErrors = uploadResults
    .filter((result) => result.error)
    .map((result) => `${result.fileName}: ${result.error}`);

  if (successfulUploads.length === 0) {
    const fallbackStatus = uploadResults[0]?.status ?? 400;
    return NextResponse.json(
      {
        error: uploadErrors[0] ?? "All uploads failed.",
        parseRuns: [],
        uploadResults,
        uploadErrors
      },
      { status: fallbackStatus }
    );
  }

  const hasFailures = uploadErrors.length > 0;
  return NextResponse.json(
    {
      parseRun: successfulUploads[0]?.parseRun ?? null,
      parseRuns,
      parserVersion: successfulUploads[0]?.parserVersion ?? null,
      parserWarnings,
      uploadResults,
      uploadErrors
    },
    { status: hasFailures ? 207 : 200 }
  );
}
