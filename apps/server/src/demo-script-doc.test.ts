import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { DEMO } from "../scripts/demo-lecture";

/** docs/demo/demo-script.md is what the teacher rehearses: it must quote every line the rehearsal check speaks. */
test("demo script quotes every teacher line of scripts/demo-lecture.ts word for word", async () => {
  const doc = await Bun.file(resolve(import.meta.dir, "../../../docs/demo/demo-script.md")).text();
  expect(DEMO.lines.map((line) => line.say).filter((say) => !doc.includes(say))).toEqual([]);
});
