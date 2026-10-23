import { describe, expect, test } from "bun:test";

import { assetUrl } from "./api";
import { SERVER_URL } from "./config";

describe("assetUrl", () => {
  test("relative asset paths get this server's origin", () => {
    expect(assetUrl("/api/assets/ast_1")).toBe(`${SERVER_URL}/api/assets/ast_1`);
  });

  test("assets written with another backend's host load from this server", () => {
    expect(assetUrl("https://sightline-api.example.dev/api/assets/ast_1?v=2")).toBe(`${SERVER_URL}/api/assets/ast_1?v=2`);
  });

  test("other absolute URLs are untouched", () => {
    const signed = "https://bucket.s3.ap-south-1.amazonaws.com/recordings/ses_1/0.webm?X-Amz-Signature=abc";
    expect(assetUrl(signed)).toBe(signed);
  });
});
