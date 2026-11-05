import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { dataDir, projectLayout, resolveInside } from "./project.ts";

describe("dataDir", () => {
	const saved = process.env.DRAFT_DATA_DIR;

	afterEach(() => {
		if (saved === undefined) {
			delete process.env.DRAFT_DATA_DIR;
		} else {
			process.env.DRAFT_DATA_DIR = saved;
		}
	});

	test("uses an absolute DRAFT_DATA_DIR as given", () => {
		process.env.DRAFT_DATA_DIR = "/data/draft";
		expect(dataDir()).toBe("/data/draft");
	});

	test("resolves a relative DRAFT_DATA_DIR against the cwd", () => {
		process.env.DRAFT_DATA_DIR = "draft-data";
		expect(dataDir()).toBe(join(process.cwd(), "draft-data"));
	});

	test("falls back to ~/.config/draft when unset or empty", () => {
		const fallback = join(homedir(), ".config", "draft");
		delete process.env.DRAFT_DATA_DIR;
		expect(dataDir()).toBe(fallback);
		process.env.DRAFT_DATA_DIR = "";
		expect(dataDir()).toBe(fallback);
	});
});

describe("projectLayout", () => {
	test("returns the common paths under the project", () => {
		expect(projectLayout("/data/projects/demo")).toEqual({
			common: join("/data/projects/demo", "common"),
			atlasDb: join("/data/projects/demo", "common", "atlas.db"),
			refs: join("/data/projects/demo", "common", "refs"),
			tokens: join("/data/projects/demo", "common", "styles", "tokens.css"),
		});
	});
});

describe("resolveInside", () => {
	let root: string;
	let outside: string;

	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "draft-root-")));
		outside = realpathSync(mkdtempSync(join(tmpdir(), "draft-outside-")));
		writeFileSync(join(outside, "secret.txt"), "secret");
		writeFileSync(join(root, "a.html"), "");
		symlinkSync(outside, join(root, "link"));
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	});

	test("rejects paths outside the project", () => {
		expect(resolveInside(root, "a.html")).toBe(join(root, "a.html"));
		expect(() => resolveInside(root, "../etc/passwd")).toThrow("outside");
		expect(() => resolveInside(root, join(outside, "secret.txt"))).toThrow("outside");
		expect(() => resolveInside(root, "link/secret.txt")).toThrow("outside");
		expect(() => resolveInside(root, ".")).toThrow("outside");
	});
});
