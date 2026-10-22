import { afterAll, describe, expect, it } from "bun:test";
import type { CaptionSegment, SessionServerMessage } from "@sightline/contracts";

import { MemoryAssetStore } from "../../platform/assets/asset-store";
import { MemoryStore } from "../../platform/store/memory-store";
import { SnapshotService } from "./snapshot-service";
import { CueCooldown, detectVisualCue } from "./visual-cues";
import { GatewayVisionDescriber } from "./vision";

describe("detectVisualCue", () => {
  it("fires on English and Hinglish visual references, not on plain speech", () => {
    for (const t of [
      "Let me draw an example on the board.",
      "As you can see, the current splits here.",
      "Look at this circuit carefully.",
      "Now this diagram shows node A.",
      "Board pe dekho, yeh current aa raha hai",
      "Yahan dekho, I3 nikal raha hai",
      "इधर देखो, यह node A है",
    ]) {
      expect(detectVisualCue(t)).not.toBeNull();
    }
    for (const t of ["Kirchhoff's current law says the sum is zero.", "Any questions so far?", "Power is I squared R."]) {
      expect(detectVisualCue(t)).toBeNull();
    }
  });

  it("rate-limits per session", () => {
    const c = new CueCooldown(20_000);
    expect(c.allow("s1", 0)).toBe(true);
    expect(c.allow("s1", 5_000)).toBe(false);
    expect(c.allow("s2", 5_000)).toBe(true);
    expect(c.allow("s1", 21_000)).toBe(true);
  });
});

describe("SnapshotService", () => {
  const setup = async () => {
    const store = new MemoryStore();
    const assets = new MemoryAssetStore();
    const published: SessionServerMessage[] = [];
    const startedAt = Date.now() - 60_000;
    await store.createSession("usr", {
      id: "ses_1", title: "t", subject: null, mode: "DEAF", status: "LIVE",
      contextStatus: "EMPTY", slidesStatus: "EMPTY", notesStatus: "EMPTY",
      createdAt: startedAt, startedAt, endedAt: null,
    });
    const seg = (id: string, startMs: number, text: string): CaptionSegment => ({
      id, sessionId: "ses_1", seq: startMs, status: "REFINED", startMs, endMs: startMs + 3000, speaker: null,
      rawText: text, text, parts: [{ type: "text", text }], corrections: [], slidePointer: null, confidence: 0.9,
    });
    await store.upsertSegment(seg("seg_old", 1_000, "intro"));
    await store.upsertSegment(seg("seg_a", 40_000, "Let me draw an example on the board."));
    await store.upsertSegment(seg("seg_b", 46_000, "Here three branches meet at node A."));
    let described = "";
    const service = new SnapshotService({
      store,
      assets,
      events: { publish: (_s, m) => published.push(m) },
      vision: { name: "fake", describe: async (_img, _mime, ctx) => ((described = ctx), "Node A with three branches") },
      assetUrl: (id) => `http://x/api/assets/${id}`,
    });
    return { store, assets, published, service, startedAt, getDescribed: () => described };
  };

  it("stores the image, links nearby captions, broadcasts, then adds the vision description", async () => {
    const { store, assets, published, service, startedAt, getDescribed } = await setup();
    const snap = await service.create(
      "ses_1",
      { bytes: new Uint8Array([0xff, 0xd8, 0xff]), mimeType: "image/jpeg" },
      { trigger: "SPEECH_CUE", reason: "", capturedAt: startedAt + 48_000 },
    );
    expect(snap.atMs).toBe(48_000);
    expect(snap.segmentIds).toEqual(["seg_a", "seg_b"]);
    expect(snap.reason).toBe("Teacher referred to the board");
    expect(snap.imageUrl).toStartWith("http://x/api/assets/ast_");
    expect((await assets.get(snap.imageUrl.split("/").at(-1)!))!.contentType).toBe("image/jpeg");

    await Bun.sleep(20);
    const captured = published.filter((m) => m.type === "snapshot.captured");
    expect(captured).toHaveLength(2);
    expect((await store.listSnapshots("ses_1"))[0]!.description).toBe("Node A with three branches");
    expect(getDescribed()).toContain("node A");
  });
});

describe("GatewayVisionDescriber → Merge Gateway", () => {
  const seen: Record<string, unknown>[] = [];
  const gateway = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as Record<string, unknown>;
      seen.push(body);
      const content = "Circuit diagram: node A, I1 = 2 A and I2 = 3 A in, I3 = 5 A out.";
      const base = { id: "c", created: 1, model: String(body.model) };
      if (body.stream) {
        const chunks = [
          { ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] },
          { ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
        ];
        return new Response(`${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`, {
          headers: { "content-type": "text/event-stream" },
        });
      }
      return Response.json({ ...base, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] });
    },
  });
  afterAll(() => gateway.stop(true));

  it("sends the image to the vision model and returns a one-line description", async () => {
    const vision = new GatewayVisionDescriber({ url: `http://localhost:${gateway.port}/v1/openai`, apiKey: "mg_x" }, "zai/glm-4.5v");
    const text = await vision.describe(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg", "let me draw an example");
    expect(text).toBe("Circuit diagram: node A, I1 = 2 A and I2 = 3 A in, I3 = 5 A out.");
    const body = seen.at(-1)!;
    expect(body.model).toBe("zai/glm-4.5v");
    expect(JSON.stringify(body.messages)).toContain("data:image/jpeg;base64,");
  });

  it("returns null instead of throwing when the gateway fails", async () => {
    const vision = new GatewayVisionDescriber({ url: "http://localhost:1/v1/openai", apiKey: "mg_x" }, "zai/glm-4.5v", 2000);
    expect(await vision.describe(new Uint8Array([1]), "image/jpeg", "")).toBeNull();
  });
});
