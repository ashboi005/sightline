import { z } from "zod";

/** Unix epoch milliseconds. Every realtime message carries one as `ts`. */
export const Timestamp = z.number().int().nonnegative().describe("Unix epoch milliseconds");

/** Milliseconds offset from the session's `startedAt`. */
export const OffsetMs = z.number().int().nonnegative().describe("Milliseconds since session start");

const prefixedId = (prefix: string) =>
  z.string().startsWith(`${prefix}_`).describe(`ID with "${prefix}_" prefix`);

export const SessionId = prefixedId("ses");
export const SegmentId = prefixedId("seg");
export const SlideDeckId = prefixedId("dck");
export const SlideId = prefixedId("sld");
export const GlossaryTermId = prefixedId("trm");
export const SignTokenId = prefixedId("tok");
export const UtteranceId = prefixedId("utt");
export const NotesId = prefixedId("nts");

export const Confidence = z.number().min(0).max(1);

export const ApiErrorCode = z.enum([
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "NOT_FOUND",
  "CONFLICT",
  "NOT_IMPLEMENTED",
  "UPSTREAM_ERROR",
  "INTERNAL",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

/** Every non-2xx REST response has exactly this shape. */
export const ApiError = z.object({
  error: z.object({
    code: ApiErrorCode,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof PaginationQuery>;

export const Pagination = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  totalItems: z.number().int(),
  totalPages: z.number().int(),
});
export type Pagination = z.infer<typeof Pagination>;

export const paginated = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), pagination: Pagination });

/** Socket-level error frame, shared by every WebSocket protocol in the system. */
export const SocketError = z.object({
  type: z.literal("error"),
  code: z.string(),
  message: z.string(),
  ts: Timestamp,
});
export type SocketError = z.infer<typeof SocketError>;
