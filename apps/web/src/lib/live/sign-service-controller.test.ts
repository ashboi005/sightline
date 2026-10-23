import { expect, test } from "bun:test";
import { CreateSignUtteranceInput, SignServiceMessage, type SignServiceCommand, type SignToken } from "@sightline/contracts";
import { createSignServiceController } from "./sign-service-controller";

const ready: SignServiceMessage = { type: "service.ready", protocolVersion: "1", model: "alphabet", vocabulary: ["A"], ts: 1000 };
const token: SignToken = { id: "tok_test", gloss: "BOOK", kind: "FINGERSPELL", confidence: .8, ts: 1100 };
function setup(onSubmit?: () => void | Promise<void>) {
  const commands: SignServiceCommand[] = [];
  const phrases: { tokens: SignToken[]; source: string }[] = [];
  const control = createSignServiceController({
    now: () => 1000,
    send: c => commands.push(c), changed: () => {},
    phrase: async (tokens, source) => { phrases.push({ tokens, source }); await onSubmit?.(); },
  });
  return { control, commands, phrases };
}
function partial(accepted: string, guess = "", ts = 1100): SignServiceMessage {
  return SignServiceMessage.parse({
    type: "sign.partial", gloss: accepted + guess, acceptedGloss: accepted, confidence: .8, ts,
  });
}
function running(onSubmit?: () => void | Promise<void>) {
  const result = setup(onSubmit);
  result.control.message(ready); result.control.start({ source: "PEER" });
  return result;
}

test("transport availability is separate from model readiness and visible errors", () => {
  const { control } = setup();
  control.status("OPEN"); expect(control.state.ready).toBe(false);
  control.message({ type: "error", code: "MODEL_UNAVAILABLE", message: "Missing model", ts: 1000 });
  expect(control.state.error).toBe("Missing model");
  expect(control.state.ready).toBe(false);
});

test("only newly accepted letters append; guesses and repeated updates never enter the draft", () => {
  const { control, phrases } = running();
  control.message(partial("A", "B"));
  control.message(partial("A", "C"));
  expect(control.state.draft).toBe("A");
  expect(control.state.partial).toBe("C");
  control.message(partial("AB"));
  control.message(partial("AB"));
  expect(control.state.draft).toBe("AB");
  expect(control.state.partial).toBeNull();
  expect(phrases).toEqual([]);
});

test("hands-down completion neither submits nor replaces raw spelling with corrected words", () => {
  const { control, phrases } = running();
  control.message(partial("OPENTHEBOK"));
  for (let i = 0; i < 2; i++) {
    control.message({ type: "sign.token", token: { ...token, gloss: "OPEN THE BOOK" }, ts: 1100 });
    control.message({ type: "phrase.end", tokenIds: [token.id], ts: 1100 });
  }
  expect(control.state.draft).toBe("OPENTHEBOK");
  expect(phrases).toEqual([]);
});

test("only a manual space creates a word break while recognition continues", () => {
  const { control } = running();
  control.message(partial("OPEN"));
  control.space(); control.space();
  control.message(partial("OPENT"));
  control.message(partial("OPENTHE"));
  expect(control.state.draft).toBe("OPEN THE");
  expect(control.state.streaming).toBe(true);
});

test("new recognition segments append without an automatic space", () => {
  const { control } = running();
  control.message(partial("A"));
  control.message({ type: "sign.token", token, ts: 1100 });
  control.message({ type: "phrase.end", tokenIds: [token.id], ts: 1100 });
  control.message(partial("B"));
  expect(control.state.draft).toBe("AB");
  // A duplicate old completion must not reset the new segment cursor.
  control.message({ type: "phrase.end", tokenIds: [token.id], ts: 1100 });
  control.message(partial("BC"));
  expect(control.state.draft).toBe("ABC");
});

test("editing a mistake does not reinsert previously accepted letters", () => {
  const { control } = running();
  control.message(partial("AB"));
  control.editDraft("A");
  control.message(partial("AB"));
  expect(control.state.draft).toBe("A");
  control.message(partial("ABC"));
  expect(control.state.draft).toBe("AC");
});

test("Enter submits manual words once, preserves source/confidence, and ignores the guess", async () => {
  const { control, phrases } = running();
  control.message(partial("OPEN"));
  control.space();
  control.message(partial("OPENTHE"));
  control.space();
  control.message(partial("OPENTHEBOOK", "C"));
  expect(await control.submit()).toBe(true);
  expect(phrases).toHaveLength(1);
  expect(phrases[0]!.source).toBe("PEER");
  expect(phrases[0]!.tokens.map(t => t.gloss)).toEqual(["OPEN", "THE", "BOOK"]);
  expect(phrases[0]!.tokens.every(t => t.kind === "FINGERSPELL" && t.confidence === .8)).toBe(true);
  CreateSignUtteranceInput.parse({ ...phrases[0], speak: false });
  expect(control.state.draft).toBe("");
  expect(await control.submit()).toBe(false);
  expect(phrases).toHaveLength(1);
});

test("duplicate Enter while saving cannot submit twice or lose the draft", async () => {
  let finish!: () => void;
  const { control, phrases } = running(() => new Promise<void>(resolve => { finish = resolve; }));
  control.message(partial("A"));
  const pending = control.submit();
  expect(control.state.submitting).toBe(true);
  expect(await control.submit()).toBe(false);
  control.editDraft("WRONG");
  control.message(partial("AB"));
  expect(control.state.draft).toBe("A");
  finish();
  expect(await pending).toBe(true);
  expect(phrases).toHaveLength(1);
});

test("failed submission keeps the editable draft for retry", async () => {
  const { control } = running(() => { throw new Error("API unavailable"); });
  control.message(partial("ABC"));
  expect(await control.submit()).toBe(false);
  expect(control.state.draft).toBe("ABC");
  expect(control.state.submitting).toBe(false);
  expect(control.state.error).toBe("API unavailable");
});

test("reconnect preserves the draft and signer but clears the live guess", () => {
  const { control, commands } = running();
  control.message(partial("AB", "C"));
  control.status("RECONNECTING");
  expect(control.state.draft).toBe("AB");
  expect(control.state.partial).toBeNull();
  expect(control.state.active).toBe(true);
  control.status("OPEN"); control.message(ready); control.message(ready);
  const starts = commands.filter(c => c.type === "stream.start");
  expect(starts).toHaveLength(2);
  expect(starts.every(c => c.source === "PEER")).toBe(true);
});

test("stop preserves the draft, ignores late results, and prevents reconnect restart", () => {
  const { control, commands, phrases } = running();
  control.message(partial("A"));
  control.status("RECONNECTING"); control.stop(); control.message(ready);
  control.message(partial("AB"));
  expect(control.state.draft).toBe("A");
  expect(control.state.active).toBe(false);
  expect(commands.filter(c => c.type === "stream.start")).toHaveLength(1);
  expect(phrases).toEqual([]);
});

test("clear discards the draft and stale results cannot restore it", () => {
  const { control } = running();
  control.message(partial("A"));
  control.reset();
  control.message(partial("AB", "", 999));
  expect(control.state.draft).toBe("");
  control.message(partial("C"));
  expect(control.state.draft).toBe("C");
});

test("legacy partials stay tentative and empty drafts do not submit", async () => {
  const { control, phrases } = running();
  control.message({ type: "sign.partial", gloss: "A", confidence: .9, ts: 1100 });
  expect(control.state.partial).toBe("A");
  expect(control.state.draft).toBe("");
  control.space();
  expect(await control.submit()).toBe(false);
  expect(phrases).toEqual([]);
});

test("an unsent draft cannot silently change signer", () => {
  const { control, commands } = running();
  control.message(partial("A")); control.stop();
  control.start({ source: "SELF" });
  expect(control.state.error).toContain("signer");
  expect(commands.filter(c => c.type === "stream.start")).toHaveLength(1);
});

test("later held guesses do not inflate the accepted letter confidence", async () => {
  const { control, phrases } = running();
  control.message({ ...partial("A"), confidence: .2 });
  control.message({ ...partial("A"), confidence: .99 });
  await control.submit();
  expect(phrases[0]!.tokens[0]!.confidence).toBe(.2);
});

test("oversized drafts stay editable instead of sending an invalid API request", async () => {
  const { control, phrases } = running();
  control.editDraft(Array.from({ length: 65 }, () => "A").join(" "));
  expect(await control.submit()).toBe(false);
  expect(control.state.error).toContain("64 words");
  expect(phrases).toEqual([]);
  expect(control.state.draft.split(" ")).toHaveLength(65);
});

test("backspace undoes a space or mistaken letter without reaccepting the held guess", () => {
  const { control } = running();
  control.message(partial("AB"));
  control.space();
  control.backspace();
  expect(control.state.draft).toBe("AB");
  control.backspace();
  expect(control.state.draft).toBe("A");
  control.message(partial("AB"));
  expect(control.state.draft).toBe("A");
  control.message(partial("ABC"));
  expect(control.state.draft).toBe("AC");
  control.reset();
  control.backspace();
  expect(control.state.draft).toBe("");
});
