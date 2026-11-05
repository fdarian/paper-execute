import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Effect } from "effect";

import { Atlas } from "./atlas.ts";
import {
	aliasAdd,
	aliasRm,
	codeAdd,
	codeRm,
	docAdd,
	featureAdd,
	featureMerge,
	featureRename,
	featureRm,
	featureSet,
	relate,
	unrelate,
} from "./product.ts";
import { all } from "./sqlite.ts";
import {
	createTestEnv,
	failureOf,
	headOf,
	initTestAtlas,
	type TestEnv,
	withAtlas,
} from "./testing.ts";

let env: TestEnv;

beforeEach(async () => {
	env = createTestEnv();
	await initTestAtlas(env);
});

afterEach(() => {
	env.cleanup();
});

const query = <Row>(sql: string, ...params: (string | number)[]) =>
	withAtlas(
		env,
		Effect.gen(function* () {
			return all<Row>((yield* Atlas).db, sql, ...params);
		}),
	);

const feature = (name: string, extra: { parent?: string } = {}) =>
	featureSet({
		name,
		summary: `${name} summary`,
		verified: false,
		parent: extra.parent === undefined ? undefined : { set: extra.parent },
	});

describe("featureAdd", () => {
	test("creates a seeded feature under a parent", async () => {
		await withAtlas(env, feature("area"));
		await withAtlas(env, featureAdd({ name: "child", summary: "child summary", parent: "area" }));
		const rows = await query<{ confidence: string; parent: string }>(
			"SELECT child.confidence, parent.name AS parent FROM feature child JOIN feature parent ON parent.id = child.parent_id",
		);
		expect(rows).toEqual([{ confidence: "seeded", parent: "area" }]);
	});

	test("an existing name conflicts and the message shows its parent path and summary", async () => {
		await withAtlas(env, feature("area"));
		await withAtlas(env, feature("middle", { parent: "area" }));
		await withAtlas(env, feature("leaf", { parent: "middle" }));
		const error = await failureOf(env, featureAdd({ name: "leaf", summary: "other" }));
		expect(error._tag).toBe("AtlasConflict");
		expect(error.message).toBe(
			'feature "leaf" already exists (under area > middle): leaf summary. Add your pointers and aliases to it if it\'s the same thing, or pick a more specific name.',
		);
		expect(
			(await failureOf(env, featureAdd({ name: "area", summary: "other" }))).message,
		).toContain("(under root): area summary.");
		expect(await query("SELECT summary FROM feature WHERE name = 'leaf'")).toEqual([
			{ summary: "leaf summary" },
		]);
	});
});

describe("featureSet", () => {
	test("create requires a summary", async () => {
		const error = await failureOf(env, featureSet({ name: "alpha", verified: false }));
		expect(error._tag).toBe("AtlasInvalid");
	});

	test("rejects names that are not kebab-case", async () => {
		const error = await failureOf(env, feature("Not Kebab"));
		expect(error._tag).toBe("AtlasInvalid");
	});

	test("creates seeded root features stamped with HEAD", async () => {
		await withAtlas(env, feature("alpha"));
		const rows = await query<{
			confidence: string;
			parent_id: null;
			seen_at: string;
		}>("SELECT confidence, parent_id, seen_at FROM feature");
		expect(rows).toEqual([{ confidence: "seeded", parent_id: null, seen_at: headOf(env.repo) }]);
	});

	test("verified upgrades confidence and a later unverified write never downgrades", async () => {
		await withAtlas(env, feature("alpha"));
		await withAtlas(env, featureSet({ name: "alpha", verified: true }));
		await withAtlas(env, featureSet({ name: "alpha", summary: "changed", verified: false }));
		const rows = await query<{ summary: string; confidence: string }>(
			"SELECT summary, confidence FROM feature",
		);
		expect(rows).toEqual([{ summary: "changed", confidence: "verified" }]);
	});

	test("update keeps omitted fields, including the parent", async () => {
		await withAtlas(env, feature("root-one"));
		await withAtlas(env, feature("child", { parent: "root-one" }));
		await withAtlas(env, featureSet({ name: "child", verified: true }));
		const rows = await query<{ summary: string; parent: string }>(
			"SELECT child.summary, parent.name AS parent FROM feature child JOIN feature parent ON parent.id = child.parent_id",
		);
		expect(rows).toEqual([{ summary: "child summary", parent: "root-one" }]);
		await withAtlas(env, featureSet({ name: "child", parent: "root", verified: false }));
		expect(await query("SELECT 1 FROM feature WHERE parent_id IS NOT NULL")).toEqual([]);
	});

	test("rejects self-parent and cycles", async () => {
		await withAtlas(env, feature("a"));
		await withAtlas(env, feature("b", { parent: "a" }));
		await withAtlas(env, feature("c", { parent: "b" }));
		const self = await failureOf(
			env,
			featureSet({ name: "a", parent: { set: "a" }, verified: false }),
		);
		const cycle = await failureOf(
			env,
			featureSet({ name: "a", parent: { set: "c" }, verified: false }),
		);
		expect(self._tag).toBe("AtlasInvalid");
		expect(cycle._tag).toBe("AtlasInvalid");
		expect(cycle.message).toContain("cycle");
	});

	test("a missing parent is AtlasNotFound", async () => {
		const error = await failureOf(env, feature("a", { parent: "ghost" }));
		expect(error._tag).toBe("AtlasNotFound");
	});
});

describe("featureRename", () => {
	test("keeps the old name as a user alias and refuses an existing target", async () => {
		await withAtlas(env, feature("old-name"));
		await withAtlas(env, feature("taken"));
		await withAtlas(env, featureRename("old-name", "new-name"));
		expect(await query("SELECT term, source FROM alias")).toEqual([
			{ term: "old-name", source: "user" },
		]);
		const error = await failureOf(env, featureRename("new-name", "taken"));
		expect(error._tag).toBe("AtlasInvalid");
	});
});

describe("featureMerge", () => {
	test("moves aliases, code, docs, relations, children and design links; drops the self relation", async () => {
		await withAtlas(
			env,
			Effect.gen(function* () {
				yield* feature("from-f");
				yield* feature("into-f");
				yield* feature("other");
				yield* feature("kid", { parent: "from-f" });
				yield* aliasAdd("from-f", "legacy", "ui");
				yield* codeAdd("from-f", "src/widget.ts", "renderWidget");
				yield* docAdd("from-f", "README.md");
				yield* relate("from-f", "into-f", "self after merge");
				yield* relate("from-f", "other", "moved");
				yield* relate("into-f", "other", "kept");
				const atlas = yield* Atlas;
				const id = (name: string) => {
					const row = atlas.db.query("SELECT id FROM feature WHERE name = ?").get(name) as {
						id: number;
					};
					return row.id;
				};
				atlas.db.exec(
					`INSERT INTO ref (id, file, app, viewport, caption, captured_at, "commit") VALUES (1, 'r.png', 'web', '1x1', 'c', 'd', 'x');
					INSERT INTO frame (id, path, state, date, caption) VALUES (1, 'f.html', 'proposed', 'd', 'c');
					INSERT INTO decision (id, text, date) VALUES (1, 't', 'd');
					INSERT INTO ref_feature VALUES (1, ${id("from-f")});
					INSERT INTO frame_feature VALUES (1, ${id("from-f")});
					INSERT INTO decision_feature VALUES (1, ${id("from-f")});`,
				);
				yield* featureMerge("from-f", "into-f");
			}),
		);
		expect(await query("SELECT name FROM feature ORDER BY name")).toEqual([
			{ name: "into-f" },
			{ name: "kid" },
			{ name: "other" },
		]);
		expect(await query("SELECT term, source FROM alias ORDER BY term")).toEqual([
			{ term: "from-f", source: "user" },
			{ term: "legacy", source: "ui" },
		]);
		expect(await query("SELECT path, symbol FROM code")).toEqual([
			{ path: "src/widget.ts", symbol: "renderWidget" },
		]);
		expect(await query("SELECT path FROM doc")).toEqual([{ path: "README.md" }]);
		expect(
			await query(
				"SELECT parent.name AS parent FROM feature kid JOIN feature parent ON parent.id = kid.parent_id WHERE kid.name = 'kid'",
			),
		).toEqual([{ parent: "into-f" }]);
		expect(await query("SELECT note FROM relation")).toEqual([{ note: "kept" }]);
		for (const table of ["ref_feature", "frame_feature", "decision_feature"]) {
			const rows = await query<{ name: string }>(
				`SELECT feature.name FROM ${table} JOIN feature ON feature.id = ${table}.feature_id`,
			);
			expect(rows).toEqual([{ name: "into-f" }]);
		}
	});

	test("merging a child into its parent reparents correctly", async () => {
		await withAtlas(env, feature("parent-f"));
		await withAtlas(env, feature("child-f", { parent: "parent-f" }));
		await withAtlas(env, feature("grand", { parent: "child-f" }));
		await withAtlas(env, featureMerge("parent-f", "child-f"));
		expect(await query("SELECT name, parent_id FROM feature ORDER BY name")).toEqual([
			{ name: "child-f", parent_id: null },
			{ name: "grand", parent_id: expect.any(Number) },
		]);
	});
});

describe("featureRm", () => {
	test("removes a bare feature and its rows", async () => {
		await withAtlas(env, feature("lonely"));
		await withAtlas(env, aliasAdd("lonely", "alone", "user"));
		await withAtlas(env, featureRm("lonely"));
		expect(await query("SELECT 1 FROM feature")).toEqual([]);
		expect(await query("SELECT 1 FROM alias")).toEqual([]);
	});

	test("refuses while children exist", async () => {
		await withAtlas(env, feature("p"));
		await withAtlas(env, feature("c", { parent: "p" }));
		const error = await failureOf(env, featureRm("p"));
		expect(error._tag).toBe("AtlasConflict");
		expect(error.message).toContain("merge");
	});

	test("refuses while a ref, frame or decision links to it", async () => {
		await withAtlas(env, feature("linked"));
		await withAtlas(
			env,
			Effect.gen(function* () {
				const atlas = yield* Atlas;
				atlas.db.exec(
					`INSERT INTO decision (id, text, date) VALUES (1, 't', 'd');
					INSERT INTO decision_feature SELECT 1, id FROM feature;`,
				);
			}),
		);
		const error = await failureOf(env, featureRm("linked"));
		expect(error._tag).toBe("AtlasConflict");
		expect(error.message).toContain("1 decisions");
	});
});

describe("aliases", () => {
	test("add upserts the source, rm removes, a missing alias is not found", async () => {
		await withAtlas(env, feature("a"));
		await withAtlas(env, aliasAdd("a", "Status Pill", "plan"));
		await withAtlas(env, aliasAdd("a", "status pill", "ui"));
		expect(await query("SELECT term, source FROM alias")).toEqual([
			{ term: "Status Pill", source: "ui" },
		]);
		await withAtlas(env, aliasRm("a", "STATUS PILL"));
		expect(await query("SELECT 1 FROM alias")).toEqual([]);
		expect((await failureOf(env, aliasRm("a", "nope")))._tag).toBe("AtlasNotFound");
	});
});

describe("code and docs", () => {
	beforeEach(async () => {
		await withAtlas(env, feature("a"));
	});

	test("stores repo-relative POSIX paths from relative or absolute input", async () => {
		await withAtlas(env, codeAdd("a", "./src/../src/widget.ts", "renderWidget"));
		await withAtlas(env, codeAdd("a", join(env.repo, "src", "widget.ts")));
		expect(await query("SELECT path, symbol FROM code ORDER BY symbol")).toEqual([
			{ path: "src/widget.ts", symbol: null },
			{ path: "src/widget.ts", symbol: "renderWidget" },
		]);
	});

	test("is unique per feature, path and symbol", async () => {
		await withAtlas(env, codeAdd("a", "src/widget.ts"));
		await withAtlas(env, codeAdd("a", "src/widget.ts"));
		await withAtlas(env, codeAdd("a", "src/widget.ts", "renderWidget"));
		await withAtlas(env, codeAdd("a", "src/widget.ts", "renderWidget"));
		expect(await query("SELECT 1 FROM code")).toHaveLength(2);
	});

	test("rejects paths outside the repo, missing files and missing symbols", async () => {
		const outside = await failureOf(env, codeAdd("a", join(env.root, "data")));
		const traversal = await failureOf(env, codeAdd("a", "../outside.ts"));
		const missing = await failureOf(env, codeAdd("a", "src/nope.ts"));
		const symbol = await failureOf(env, codeAdd("a", "src/widget.ts", "render"));
		expect([outside._tag, traversal._tag, missing._tag, symbol._tag]).toEqual([
			"AtlasInvalid",
			"AtlasInvalid",
			"AtlasInvalid",
			"AtlasInvalid",
		]);
		expect(symbol.message).toContain("render");
		expect(await query("SELECT 1 FROM code")).toEqual([]);
	});

	test("rm removes the pointer, even when the file is gone", async () => {
		await withAtlas(env, codeAdd("a", "src/widget.ts", "renderWidget"));
		await withAtlas(env, codeRm("a", "src/widget.ts", "renderWidget"));
		expect(await query("SELECT 1 FROM code")).toEqual([]);
		expect((await failureOf(env, codeRm("a", "src/widget.ts")))._tag).toBe("AtlasNotFound");
	});

	test("docs need an existing file inside the repo", async () => {
		await withAtlas(env, docAdd("a", "README.md"));
		expect(await query("SELECT path FROM doc")).toEqual([{ path: "README.md" }]);
		expect((await failureOf(env, docAdd("a", "GONE.md")))._tag).toBe("AtlasInvalid");
		expect((await failureOf(env, docAdd("a", "/etc/hosts")))._tag).toBe("AtlasInvalid");
	});

	test("a write stamps the feature with HEAD", async () => {
		await withAtlas(env, codeAdd("a", "src/widget.ts"));
		expect(await query("SELECT seen_at FROM feature")).toEqual([{ seen_at: headOf(env.repo) }]);
	});
});

describe("relations", () => {
	test("relate upserts the note under the smaller id and rejects a == b", async () => {
		await withAtlas(env, feature("a"));
		await withAtlas(env, feature("b"));
		await withAtlas(env, relate("b", "a", "first"));
		await withAtlas(env, relate("a", "b", "second"));
		expect(await query("SELECT a_id, b_id, note FROM relation")).toEqual([
			{ a_id: 1, b_id: 2, note: "second" },
		]);
		expect((await failureOf(env, relate("a", "a", "x")))._tag).toBe("AtlasInvalid");
		await withAtlas(env, unrelate("b", "a"));
		expect(await query("SELECT 1 FROM relation")).toEqual([]);
		expect((await failureOf(env, unrelate("a", "b")))._tag).toBe("AtlasNotFound");
	});
});
