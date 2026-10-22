import { describe, expect, it } from "bun:test";

import { CachedTts, ElevenLabsTts, MockTts, SarvamTts } from "./tts";

type Call = { url: string; init: RequestInit };

const fakeFetch = (respond: (call: Call) => Response) => {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { fn, calls };
};

describe("ElevenLabsTts", () => {
  it("posts text + model to the voice endpoint with xi-api-key and returns mp3 bytes", async () => {
    const { fn, calls } = fakeFetch(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const tts = new ElevenLabsTts({ apiKey: "k", voiceId: "voice1", modelId: "eleven_flash_v2_5", fetch: fn });
    const audio = await tts.synthesize("  Could you repeat the formula?  ");
    expect(audio).toEqual({ contentType: "audio/mpeg", bytes: new Uint8Array([1, 2, 3]) });
    expect(calls[0]!.url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice1?output_format=mp3_44100_128");
    expect((calls[0]!.init.headers as Record<string, string>)["xi-api-key"]).toBe("k");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      text: "Could you repeat the formula?",
      model_id: "eleven_flash_v2_5",
    });
  });

  it("maps upstream failures to UPSTREAM_ERROR and refuses without a key", async () => {
    const { fn } = fakeFetch(() => new Response("quota", { status: 429 }));
    await expect(new ElevenLabsTts({ apiKey: "k", voiceId: "v", modelId: "m", fetch: fn }).synthesize("hi")).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
    await expect(new ElevenLabsTts({ apiKey: undefined, voiceId: "v", modelId: "m" }).synthesize("hi")).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
  });
});

describe("SarvamTts", () => {
  it("sends language_code/model/speaker and decodes the base64 wav", async () => {
    const wav = Buffer.from("RIFFfakewav").toString("base64");
    const { fn, calls } = fakeFetch(() => Response.json({ request_id: "r", audios: [wav] }));
    const tts = new SarvamTts({ apiKey: "s", model: "bulbul:v3", speaker: "shubh", language: "en-IN", fetch: fn });
    const audio = await tts.synthesize("Thank you!");
    expect(audio.contentType).toBe("audio/wav");
    expect(Buffer.from(audio.bytes).toString()).toBe("RIFFfakewav");
    expect(calls[0]!.url).toBe("https://api.sarvam.ai/text-to-speech");
    expect((calls[0]!.init.headers as Record<string, string>)["api-subscription-key"]).toBe("s");
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      text: "Thank you!",
      language_code: "en-IN",
      model: "bulbul:v3",
      speaker: "shubh",
    });
  });

  it("rejects an empty audios array", async () => {
    const { fn } = fakeFetch(() => Response.json({ audios: [] }));
    const tts = new SarvamTts({ apiKey: "s", model: "m", speaker: "x", language: "en-IN", fetch: fn });
    await expect(tts.synthesize("hi")).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
  });
});

describe("CachedTts", () => {
  it("calls the provider once per distinct text", async () => {
    let calls = 0;
    const inner = { name: "x", synthesize: async () => (calls++, { contentType: "audio/wav" as const, bytes: new Uint8Array([9]) }) };
    const tts = new CachedTts(inner, 2);
    await tts.synthesize("a");
    await tts.synthesize("a ");
    await tts.synthesize("b");
    expect(calls).toBe(2);
  });
});

describe("MockTts", () => {
  it("returns a valid WAV header", async () => {
    const { bytes, contentType } = await new MockTts().synthesize("hello");
    expect(contentType).toBe("audio/wav");
    expect(Buffer.from(bytes.subarray(0, 4)).toString()).toBe("RIFF");
  });
});
