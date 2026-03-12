import { z } from "zod";

const isoDateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const sycamoreSyncRequestSchema = z
  .object({
    date: isoDateOnlySchema.optional(),
    startDate: isoDateOnlySchema.optional(),
    endDate: isoDateOnlySchema.optional(),
    incremental: z.boolean().optional(),
    retryParseRunId: z.string().trim().min(1).optional()
  })
  .superRefine((value, context) => {
    if (value.incremental && (value.date || value.startDate || value.endDate)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["incremental"],
        message: "Incremental sync cannot be combined with explicit date filters."
      });
    }

    if (value.date && (value.startDate || value.endDate)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["date"],
        message: "Use either `date` or `startDate`/`endDate`, not both."
      });
    }

    if ((value.startDate && !value.endDate) || (!value.startDate && value.endDate)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startDate"],
        message: "Both `startDate` and `endDate` are required for a range sync."
      });
    }

    if (value.startDate && value.endDate && value.startDate > value.endDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "`endDate` must be on or after `startDate`."
      });
    }
  });
export type SycamoreSyncRequest = z.infer<typeof sycamoreSyncRequestSchema>;

export const normalizedSycamoreDisciplineRecordSchema = z.object({
  id: z.string().min(1),
  studentId: z.string().nullable(),
  studentCode: z.string().nullable(),
  studentName: z.string().nullable(),
  grade: z.string().nullable(),
  violation: z.string().nullable(),
  description: z.string().nullable(),
  points: z.string().nullable(),
  createdAt: z.string().nullable(),
  author: z.string().nullable(),
  occurredOn: isoDateOnlySchema.nullable()
});
export type NormalizedSycamoreDisciplineRecord = z.infer<typeof normalizedSycamoreDisciplineRecordSchema>;

export const normalizedSycamoreStudentRecordSchema = z.object({
  id: z.string().min(1),
  studentCode: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  fullName: z.string().min(1),
  grade: z.string().nullable(),
  graduated: z.boolean()
});
export type NormalizedSycamoreStudentRecord = z.infer<typeof normalizedSycamoreStudentRecordSchema>;

export interface SycamoreDateWindow {
  startDate: string;
  endDate: string;
}

export interface SycamoreDisciplineFetchResult {
  records: Array<Record<string, unknown>>;
  warnings: string[];
  dateWindow: SycamoreDateWindow;
}

export function resolveSycamoreDateWindow(input: SycamoreSyncRequest): SycamoreDateWindow {
  if (input.incremental) {
    throw new Error("Incremental Sycamore sync requests require storage-backed window resolution.");
  }

  if (input.date) {
    return {
      startDate: input.date,
      endDate: input.date
    };
  }

  if (input.startDate && input.endDate) {
    return {
      startDate: input.startDate,
      endDate: input.endDate
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  return {
    startDate: today,
    endDate: today
  };
}
