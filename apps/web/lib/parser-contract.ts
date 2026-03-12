import { z } from "zod";

export const parseRequestSchema = z.object({
  fileName: z.string().min(1),
  contentBase64: z.string().min(1)
});
export type ParseRequest = z.infer<typeof parseRequestSchema>;

const parsedFieldSchema = z.object({
  value: z.string(),
  confidence: z.number().min(0).max(1)
});
const optionalParsedFieldSchema = parsedFieldSchema.optional();

export const parseRecordSchema = z.object({
  student: parsedFieldSchema,
  occurredAt: parsedFieldSchema,
  writeupDate: optionalParsedFieldSchema,
  points: parsedFieldSchema,
  reason: parsedFieldSchema,
  violation: optionalParsedFieldSchema,
  violationRaw: optionalParsedFieldSchema,
  level: optionalParsedFieldSchema,
  teacher: parsedFieldSchema,
  authorName: optionalParsedFieldSchema,
  authorNameRaw: optionalParsedFieldSchema,
  comment: parsedFieldSchema,
  description: optionalParsedFieldSchema,
  resolution: optionalParsedFieldSchema,
  sourceSnippet: z.string(),
  recordConfidence: z.number().min(0).max(1),
  warnings: z.array(z.string())
});
export type ParseRecord = z.infer<typeof parseRecordSchema>;

export const parseResponseSchema = z.object({
  parserVersion: z.string().min(1),
  parsedAt: z.string().min(1),
  records: z.array(parseRecordSchema),
  warnings: z.array(z.string())
});
export type ParseResponse = z.infer<typeof parseResponseSchema>;
