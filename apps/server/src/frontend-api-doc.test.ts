import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { routes } from "@sightline/contracts";

/** docs/contracts/frontend-api.md is Sahil's single list of APIs: it must name every route and link only to real files. */
const DOC = resolve(import.meta.dir, "../../../docs/contracts/frontend-api.md");
const doc = await Bun.file(DOC).text();

test("frontend API contract lists every REST route", () => {
  const missing = Object.entries(routes)
    .map(([name, r]) => ({ name, entry: `${r.method} ${r.path.replace(":sessionId", ":id")}` }))
    .filter(({ entry }) => !doc.includes(entry));
  expect(missing).toEqual([]);
});

test("frontend API contract links resolve to files in the repo", () => {
  const broken = [...doc.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)]
    .map((m) => m[1]!)
    .filter((target) => !/^https?:/.test(target))
    .filter((target) => !existsSync(resolve(dirname(DOC), target)));
  expect(broken).toEqual([]);
});
