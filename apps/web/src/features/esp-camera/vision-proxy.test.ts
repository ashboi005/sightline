import { expect, test } from "bun:test";
import { proxyVision } from "./vision-proxy";
const config = { url: "http://127.0.0.1:1234", secret: "test" };
const req = (body: object) =>
  new Request("http://localhost/api/viewer-vision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
test("model selections belong to the signed-in profile", async () => {
  const transport = (async () =>
    Response.json({ token: "test-owner-token" })) as typeof fetch;
  expect(
    (await proxyVision(req({ action: "select" }), "kate", config, transport))
      .ok,
  ).toBe(true);
  await expect(
    proxyVision(
      req({ action: "match", token: "test-owner-token" }),
      "other",
      config,
      transport,
    ),
  ).rejects.toMatchObject({ status: 410 });
  expect(
    (
      await proxyVision(
        req({ action: "clear", token: "test-owner-token" }),
        "kate",
        config,
        transport,
      )
    ).ok,
  ).toBe(true);
  await expect(
    proxyVision(
      req({ action: "match", token: "test-owner-token" }),
      "kate",
      config,
      transport,
    ),
  ).rejects.toMatchObject({ status: 410 });
});

test("the ESP selection endpoint only asks the model for a person", async () => {
  let forwarded: Record<string, unknown> | undefined;
  await proxyVision(
    req({ action: "select", kind: "object", point: [0.2, 0.4] }),
    "kate",
    config,
    (async (_url, init) => {
      forwarded = JSON.parse(String(init?.body));
      return Response.json({ token: "person-only-test" });
    }) as typeof fetch,
  );
  expect(forwarded?.kind).toBe("person");
});
