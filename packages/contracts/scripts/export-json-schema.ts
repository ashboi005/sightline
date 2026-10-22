/**
 * Exports JSON Schemas for the non-TypeScript teammates (Python gaze bridge + sign service).
 *   bun run --filter @sightline/contracts json-schema
 * Python: `datamodel-codegen --input json-schema/gaze-bridge.message.json --output models.py`
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import * as c from "../src/index";

const OUT_DIR = join(import.meta.dir, "..", "json-schema");

const schemas: Record<string, z.ZodType> = {
  "gaze-bridge.message": c.GazeBridgeMessage,
  "gaze-bridge.command": c.GazeBridgeCommand,
  "sign-service.message": c.SignServiceMessage,
  "sign-service.command": c.SignServiceCommand,
  "speaker-service.message": c.SpeakerServiceMessage,
  "speaker-service.command": c.SpeakerServiceCommand,
  "session-socket.client": c.SessionClientMessage,
  "session-socket.server": c.SessionServerMessage,
  "sign-token": c.SignToken,
  "caption-segment": c.CaptionSegment,
  "lecture-notes": c.LectureNotes,
  snapshot: c.Snapshot,
};

await mkdir(OUT_DIR, { recursive: true });
for (const [name, schema] of Object.entries(schemas)) {
  const json = z.toJSONSchema(schema, { io: "output", unrepresentable: "any" });
  await Bun.write(join(OUT_DIR, `${name}.json`), `${JSON.stringify(json, null, 2)}\n`);
  console.log(`wrote json-schema/${name}.json`);
}
