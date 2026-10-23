import { describe, expect, test } from "bun:test";
import { readCameraJson, requireCameraUser } from "./server-auth";

function request(origin = "https://sightline.example") {
  // Authentication receives a server request; happy-dom's browser Request strips forbidden headers.
  return {
    url: "https://sightline.example/api/esp-camera",
    headers: new Headers({ origin, cookie: "session=test" }),
    signal: new AbortController().signal,
  } as Request;
}
describe("camera route authentication", () => {
  test("rejects cross-origin requests before contacting auth", async () => {
    let called = false;
    await expect(
      requireCameraUser(request("https://other.example"), {
        fetch: async () => {
          called = true;
          return Response.json({ id: "kate" });
        },
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(called).toBe(false);
  });
  test("requires the existing authenticated user", async () => {
    await expect(
      requireCameraUser(request(), {
        fetch: async () => new Response(null, { status: 401 }),
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      await requireCameraUser(request(), {
        fetch: async (_url, init) => {
          expect(new Headers(init?.headers).get("cookie")).toBe("session=test");
          return Response.json({ id: "kate", isMock: false });
        },
      }),
    ).toBe("kate");
  });
  test("does not expose camera control through hosted mock auth", async () => {
    await expect(
      requireCameraUser(request(), {
        fetch: async () => Response.json({ id: "demo", isMock: true }),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

test("cancelling a stalled upload releases its body reader", async () => {
  const abort = new AbortController();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const pending = readCameraJson(
    {
      headers: new Headers({ "content-type": "application/json" }),
      signal: abort.signal,
      body,
    } as Request,
    1024,
  );
  abort.abort();
  await expect(pending).rejects.toMatchObject({ status: 499 });
  expect(cancelled).toBe(true);
  expect(body.locked).toBe(false);
});
