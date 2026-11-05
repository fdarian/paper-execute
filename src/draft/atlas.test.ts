import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrations, schemaVersion, userVersion } from "@paper-execute/draft-atlas";
import { Effect } from "effect";

import { openProjectAtlas } from "./atlas.ts";

const sandbox = realpathSync(mkdtempSync(join(tmpdir(), "draft-atlas-open-")));

afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

test("a version 1 atlas is migrated when the project is opened for a launch", async () => {
	const dir = join(sandbox, "projects", "demo");
	const repo = join(sandbox, "repo");
	mkdirSync(join(dir, "common"), { recursive: true });
	mkdirSync(repo);
	const seed = new Database(join(dir, "common", "atlas.db"), { create: true });
	seed.exec(migrations[0] as string);
	seed.exec(`PRAGMA user_version = 1; INSERT INTO meta (key, value) VALUES ('repo', '${repo}');`);
	seed.close();

	const inputs = await Effect.runPromise(openProjectAtlas({ project: "demo", dir }));

	expect(inputs?.repo).toBe(repo);
	const db = new Database(join(dir, "common", "atlas.db"), { readonly: true });
	expect(userVersion(db)).toBe(schemaVersion);
	db.close();
});
