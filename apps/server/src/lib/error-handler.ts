import type { ApiError } from "@sightline/contracts";
import { Elysia } from "elysia";

import { AppError } from "./errors";

const json = (status: number, body: ApiError) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Maps every thrown error to the contract `ApiError` shape. */
export const errorHandler = new Elysia({ name: "error-handler" }).onError({ as: "global" }, ({ code, error }) => {
  if (error instanceof AppError) return json(error.status, error.toBody());
  if (code === "VALIDATION") {
    return json(422, {
      error: { code: "VALIDATION_ERROR", message: "Request validation failed", details: error.all },
    });
  }
  if (code === "NOT_FOUND") return json(404, { error: { code: "NOT_FOUND", message: "Route not found" } });
  if (code === "PARSE") return json(400, { error: { code: "VALIDATION_ERROR", message: "Malformed request body" } });
  console.error("[server] unhandled error", error);
  return json(500, { error: { code: "INTERNAL", message: "Internal server error" } });
});
