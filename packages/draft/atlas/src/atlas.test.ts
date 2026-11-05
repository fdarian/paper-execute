import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";

import { Atlas, initAtlas } from "./atlas.ts";
import { featureSet } from "./product.ts";
import { createTestEnv, headOf, initTestAtlas, type TestEnv, withAtlas } from "./testing.ts";

let env: TestEnv;

beforeEach(() => {
	env = createTestEnv();
});

afterEach(() => {
	env.cleanup();
});

describe("initAtlas", () => {
	test("creates common/atlas.db with meta.repo set to the git toplevel", async () => {
		const handle = await Effect.runPromise(
			Effect.scoped(initAtlas({ ...env.options, repo: join(env.repo, "src") })),
		);
		expect(handle.repo).toBe(env.repo);
		expect(existsSync(join(env.dir, "common", "atlas.db"))).toBe(true);
	});

	test("is idempotent and keeps existing rows", async () => {
		await initTestAtlas(env);
		await withAtlas(env, featureSet({ name: "alpha", summary: "A", verified: false }));
		await initTestAtlas(env);
		const rows = await withAtlas(
			env,
			Effect.gen(function* () {
				const atlas = yield* Atlas;
				return atlas.db.query("SELECT name FROM feature").all();
			}),
		);
		expect(rows).toEqual([{ name: "alpha" }]);
	});

	test("re-running with another repo updates meta.repo", async () => {
		await initTestAtlas(env);
		const other = createTestEnv();
		try {
			await Effect.runPromise(Effect.scoped(initAtlas({ ...env.options, repo: other.repo })));
			const repo = await withAtlas(
				env,
				Effect.gen(function* () {
					return (yield* Atlas).repo;
				}),
			);
			expect(repo).toBe(other.repo);
		} finally {
			other.cleanup();
		}
	});

	test("fails with AtlasInvalid outside a git repository", async () => {
		const error = await Effect.runPromise(
			Effect.flip(Effect.scoped(initAtlas({ ...env.options, repo: env.root }))),
		);
		expect(error._tag).toBe("AtlasInvalid");
		expect(existsSync(join(env.dir, "common", "atlas.db"))).toBe(false);
	});
});

describe("Atlas layers", () => {
	test("fail with AtlasNotInitialized when the db is missing", async () => {
		const error = await Effect.runPromise(
			Effect.flip(Effect.void.pipe(Effect.provide(Atlas.layer(env.options)))),
		);
		expect(error._tag).toBe("AtlasNotInitialized");
		expect(error.message).toContain("draft atlas init");
		const readonlyError = await Effect.runPromise(
			Effect.flip(Effect.void.pipe(Effect.provide(Atlas.layerReadonly(env.options)))),
		);
		expect(readonlyError._tag).toBe("AtlasNotInitialized");
	});

	test("expose the repo HEAD sha", async () => {
		await initTestAtlas(env);
		const head = await withAtlas(
			env,
			Effect.gen(function* () {
				return yield* (yield* Atlas).head;
			}),
		);
		expect(head).toBe(headOf(env.repo));
	});

	test("the db enforces kebab-case names", async () => {
		await initTestAtlas(env);
		const db = new Database(join(env.dir, "common", "atlas.db"));
		const insert = (name: string) =>
			db
				.query(
					"INSERT INTO feature (name, summary, status, confidence, seen_at) VALUES (?, 's', 'built', 'seeded', 'x')",
				)
				.run(name);
		expect(() => insert("Upper")).toThrow();
		expect(() => insert("two words")).toThrow();
		expect(() => insert("-lead")).toThrow();
		expect(() => insert("trail-")).toThrow();
		expect(() => insert("dou--ble")).toThrow();
		expect(() => insert("")).toThrow();
		expect(() => insert("ok-name-2")).not.toThrow();
		db.close();
	});

	test("two processes write the same db concurrently without SQLITE_BUSY", async () => {
		await initTestAtlas(env);
		const fixture = join(import.meta.dir, "concurrent-writer.fixture.ts");
		const spawn = (prefix: string) =>
			Bun.spawn([process.execPath, "run", fixture, env.dir, prefix], {
				stdout: "pipe",
				stderr: "pipe",
			});
		const procs = ["a", "b", "c"].map(spawn);
		const codes = await Promise.all(procs.map((proc) => proc.exited));
		const stderr = await Promise.all(procs.map((proc) => new Response(proc.stderr).text()));
		expect(stderr.join("")).toBe("");
		expect(codes).toEqual([0, 0, 0]);
		const count = await withAtlas(
			env,
			Effect.gen(function* () {
				const atlas = yield* Atlas;
				return atlas.db.query("SELECT COUNT(*) AS n FROM feature").get();
			}),
		);
		expect(count).toEqual({ n: 120 });
	});
});
