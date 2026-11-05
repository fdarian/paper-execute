import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";

import { Atlas, initAtlas } from "./atlas.ts";
import { featureSet } from "./product.ts";
import { migrations, schemaVersion, userVersion } from "./schema.ts";
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

describe("migrations", () => {
	function writeVersionOneDb(): void {
		mkdirSync(join(env.dir, "common"), { recursive: true });
		const db = new Database(join(env.dir, "common", "atlas.db"), { create: true });
		db.exec(migrations[0] as string);
		db.exec("PRAGMA user_version = 1");
		db.exec(`
			INSERT INTO meta (key, value) VALUES ('repo', '${env.repo}');
			INSERT INTO feature (id, name, summary, status, confidence, parent_id, seen_at) VALUES
				(1, 'scout', 'Find leads', 'built', 'verified', NULL, 'abc'),
				(2, 'lead-status', 'Track leads', 'planned', 'seeded', 1, 'abc'),
				(3, 'thumbs', 'Rate leads', 'built', 'seeded', NULL, 'abc');
			INSERT INTO alias (term, feature_id, source) VALUES ('status pill', 2, 'ui');
			INSERT INTO code (feature_id, path, symbol) VALUES (2, 'src/widget.ts', 'renderWidget');
			INSERT INTO relation (a_id, b_id, note) VALUES (2, 3, 'related');
		`);
		db.close();
	}

	test("a version 1 db drops the feature status column and keeps its data", async () => {
		writeVersionOneDb();
		const rows = await withAtlas(
			env,
			Effect.gen(function* () {
				const db = (yield* Atlas).db;
				return {
					version: userVersion(db),
					columns: db
						.query<{ name: string }, []>("SELECT name FROM pragma_table_info('feature')")
						.all()
						.map((column) => column.name),
					features: db.query("SELECT id, name, parent_id FROM feature ORDER BY id").all(),
					aliases: db.query("SELECT term, feature_id FROM alias").all(),
					code: db.query("SELECT feature_id, path, symbol FROM code").all(),
					relations: db.query("SELECT a_id, b_id, note FROM relation").all(),
					violations: db.query("PRAGMA foreign_key_check").all(),
				};
			}),
		);
		expect(rows.version).toBe(schemaVersion);
		expect(rows.columns).not.toContain("status");
		expect(rows.features).toEqual([
			{ id: 1, name: "scout", parent_id: null },
			{ id: 2, name: "lead-status", parent_id: 1 },
			{ id: 3, name: "thumbs", parent_id: null },
		]);
		expect(rows.aliases).toEqual([{ term: "status pill", feature_id: 2 }]);
		expect(rows.code).toEqual([{ feature_id: 2, path: "src/widget.ts", symbol: "renderWidget" }]);
		expect(rows.relations).toEqual([{ a_id: 2, b_id: 3, note: "related" }]);
		expect(rows.violations).toEqual([]);
	});

	test("cascades still apply after the migration", async () => {
		writeVersionOneDb();
		const remaining = await withAtlas(
			env,
			Effect.gen(function* () {
				const db = (yield* Atlas).db;
				db.exec("DELETE FROM feature WHERE id = 2");
				return db
					.query(
						"SELECT (SELECT COUNT(*) FROM alias) AS aliases, (SELECT COUNT(*) FROM code) AS code, (SELECT COUNT(*) FROM relation) AS relations",
					)
					.get();
			}),
		);
		expect(remaining).toEqual({ aliases: 0, code: 0, relations: 0 });
	});

	test("a read-only open of an unmigrated db asks for a write command and leaves it untouched", async () => {
		writeVersionOneDb();
		const error = await Effect.runPromise(
			Effect.flip(Effect.void.pipe(Effect.provide(Atlas.layerReadonly(env.options)))),
		);
		expect(error._tag).toBe("AtlasInvalid");
		expect(error.message).toContain("draft atlas init");
		const db = new Database(join(env.dir, "common", "atlas.db"), { readonly: true });
		expect(userVersion(db)).toBe(1);
		db.close();
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
					"INSERT INTO feature (name, summary, confidence, seen_at) VALUES (?, 's', 'seeded', 'x')",
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
