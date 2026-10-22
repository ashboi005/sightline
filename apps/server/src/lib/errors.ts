import type { ApiError, ApiErrorCode } from "@sightline/contracts";

const STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 422,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  NOT_IMPLEMENTED: 501,
  UPSTREAM_ERROR: 502,
  INTERNAL: 500,
};

/** Throw this anywhere in a handler; the error plugin turns it into the contract `ApiError` shape. */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.status = STATUS[code];
  }

  toBody(): ApiError {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export const notFound = (what: string) => new AppError("NOT_FOUND", `${what} not found`);

/** Use in real-implementation stubs so the gap is obvious at runtime and in the API response. */
export const notImplemented = (what: string, owner: string) =>
  new AppError("NOT_IMPLEMENTED", `${what} is not implemented yet (owner: ${owner}). Set the matching MOCK_* flag to true.`);
