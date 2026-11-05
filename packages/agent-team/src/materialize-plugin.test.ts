import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { materializePlugin } from "./materialize-plugin.ts";

test("writes the files once under a name-and-hash directory", () => {
	const files = { "plugin.json": "{}", "skills/a/SKILL.md": `a ${Date.now()}` };
	const dir = materializePlugin("agent-team-test", files);
	expect(basename(dir)).toMatch(/^agent-team-test-[0-9a-z]+$/);
	expect(readFileSync(join(dir, "skills/a/SKILL.md"), "utf8")).toBe(files["skills/a/SKILL.md"]);
	expect(materializePlugin("agent-team-test", files)).toBe(dir);
});
