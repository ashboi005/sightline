/** Verify the compose/audio boundary with all six fixtures, not recognition accuracy. */
import { Session, SignToken, SignUtterance, type SignSource } from "../packages/contracts/src/index";
import { createSightlineApi } from "../packages/contracts/src/client";
import phrases from "../packages/mocks/fixtures/sign.phrases.json";

const baseUrl = process.env.SERVER_URL ?? "http://localhost:3000";
const api = createSightlineApi({ baseUrl });
const session = Session.parse(await api.createSession({ title: "Sign compose verification", mode: "DEAF" }));
try {
  for (const fixture of phrases.phrases) {
    const tokens = fixture.tokens.map(token => SignToken.parse({
      ...token, id: `tok_${crypto.randomUUID()}`, ts: Date.now(),
      kind: ["FORMULA", "BOARD"].includes(token.gloss) ? "FINGERSPELL" : token.kind,
    }));
    const utterance = SignUtterance.parse(await api.createSignUtterance(session.id, {
      tokens, source: fixture.source as SignSource, speak: true,
    }));
    if (!utterance.text || utterance.source !== fixture.source || !utterance.audioUrl) {
      throw new Error(`Incomplete compose/audio result: ${tokens.map(token => token.gloss).join(" ")}`);
    }
    const audio = await fetch(new URL(utterance.audioUrl, baseUrl));
    if (!audio.ok || !(audio.headers.get("content-type") ?? "").startsWith("audio/") || !(await audio.arrayBuffer()).byteLength) {
      throw new Error("Audio URL did not return playable audio bytes");
    }
    console.log(`PASS ${fixture.source}: ${tokens.map(token => token.gloss).join(" ")} -> ${utterance.text}`);
  }
  console.log("Six compose/audio fixtures passed. Real signing/M2 acceptance is separate.");
} finally {
  await api.deleteSession(session.id);
}
