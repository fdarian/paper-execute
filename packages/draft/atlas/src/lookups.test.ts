import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Effect } from "effect";

import { Atlas } from "./atlas.ts";
import { formatList, formatShow, formatSql } from "./format.ts";
import { list } from "./list.ts";
import { aliasAdd, codeAdd, docAdd, featureSet, relate } from "./product.ts";
import { resolve } from "./resolve.ts";
import { show } from "./show.ts";
import { sql } from "./sql.ts";
import {
	createTestEnv,
	headOf,
	initTestAtlas,
	type TestEnv,
	withAtlas,
	withReadonlyAtlas,
} from "./testing.ts";

let env: TestEnv;

beforeEach(async () => {
	env = createTestEnv();
	await initTestAtlas(env);
});

afterEach(() => {
	env.cleanup();
});

const seed = Effect.gen(function* () {
	yield* featureSet({ name: "scout", summary: "Find leads", verified: true });
	yield* featureSet({
		name: "curated-feed",
		summary: "Feed of curated leads",
		parent: { set: "scout" },
		verified: false,
	});
	yield* featureSet({
		name: "lead-status",
		summary: "Track whether a lead was contacted",
		parent: { set: "curated-feed" },
		verified: false,
	});
	yield* featureSet({ name: "thumbs-feedback", summary: "Rate leads", verified: true });
	yield* featureSet({
		name: "lead-search",
		summary: "Search leads",
		parent: { set: "scout" },
		verified: false,
	});
	yield* aliasAdd("lead-status", "status pill", "ui");
	yield* aliasAdd("lead-status", "lead state", "plan");
	yield* aliasAdd("lead-search", "scout leads", "ui");
	yield* aliasAdd("curated-feed", "scout leads", "route");
	yield* codeAdd("lead-status", "src/widget.ts", "renderWidget");
	yield* docAdd("lead-status", "README.md");
	yield* relate("lead-status", "thumbs-feedback", "Skipped is not Not relevant");
});

describe("resolve", () => {
	beforeEach(async () => {
		await withAtlas(env, seed);
	});

	const resolveTerm = (term: string) => withAtlas(env, resolve(term));

	test("exact name, normalizing case and whitespace", async () => {
		const result = await resolveTerm("  Lead   Status ");
		expect(result.kind === "feature" && result.feature.name).toBe("lead-status");
	});

	test("exact alias, case-insensitive", async () => {
		const result = await resolveTerm("STATUS PILL");
		expect(result.kind === "feature" && result.feature.name).toBe("lead-status");
	});

	test("an alias pointing at several features yields candidates with the matched alias", async () => {
		expect(await resolveTerm("scout leads")).toEqual({
			kind: "candidates",
			features: [
				{ name: "curated-feed", summary: "Feed of curated leads", matchedAlias: "scout leads" },
				{ name: "lead-search", summary: "Search leads", matchedAlias: "scout leads" },
			],
		});
	});

	test("substring of a name resolves a single match and lists several", async () => {
		const one = await resolveTerm("thumbs");
		expect(one.kind === "feature" && one.feature.name).toBe("thumbs-feedback");
		const many = await resolveTerm("lead");
		expect(many.kind === "candidates" && many.features.map((candidate) => candidate.name)).toEqual([
			"curated-feed",
			"lead-search",
			"lead-status",
		]);
		expect(many.kind === "candidates" && many.features[0]?.matchedAlias).toBe("scout leads");
		expect(many.kind === "candidates" && many.features[1]?.matchedAlias).toBeUndefined();
	});

	test("substring of an alias reports the alias", async () => {
		const result = await resolveTerm("pill");
		expect(result.kind === "feature" && result.feature.name).toBe("lead-status");
	});

	test("none", async () => {
		expect(await resolveTerm("zebra")).toEqual({ kind: "none" });
	});
});

describe("list", () => {
	beforeEach(async () => {
		await withAtlas(env, seed);
	});

	test("is a pre-order tree with siblings by name", async () => {
		const result = await withAtlas(env, list());
		expect(result.rows.map((row) => [row.depth, row.name])).toEqual([
			[0, "scout"],
			[1, "curated-feed"],
			[2, "lead-status"],
			[1, "lead-search"],
			[0, "thumbs-feedback"],
		]);
		expect(formatList(result)).toBe(
			[
				"scout · verified · Find leads",
				"  curated-feed · seeded · Feed of curated leads",
				"    lead-status · seeded · Track whether a lead was contacted",
				"  lead-search · seeded · Search leads",
				"thumbs-feedback · verified · Rate leads",
			].join("\n"),
		);
	});

	test("a hyphenated sibling does not split a subtree", async () => {
		await withAtlas(
			env,
			featureSet({ name: "scout-extra", summary: "x", verified: false }).pipe(
				Effect.andThen(
					featureSet({
						name: "z-child",
						summary: "x",
						parent: { set: "scout" },
						verified: false,
					}),
				),
			),
		);
		const result = await withAtlas(env, list());
		const names = result.rows.map((row) => row.name);
		expect(names.indexOf("z-child")).toBeLessThan(names.indexOf("scout-extra"));
	});
});

describe("show", () => {
	beforeEach(async () => {
		await withAtlas(env, seed);
	});

	test("builds feature views with absolute code and doc paths", async () => {
		const view = await withAtlas(env, show(["lead-status"]));
		const result = view.results[0];
		expect(result?.kind === "feature" && result.feature).toEqual({
			name: "lead-status",
			summary: "Track whether a lead was contacted",
			confidence: "seeded",
			seenAt: headOf(env.repo),
			path: ["scout", "curated-feed", "lead-status"],
			children: [],
			aliases: [
				{ term: "lead state", source: "plan" },
				{ term: "status pill", source: "ui" },
			],
			code: [{ path: join(env.repo, "src/widget.ts"), symbol: "renderWidget" }],
			docs: [join(env.repo, "README.md")],
			related: [{ name: "thumbs-feedback", note: "Skipped is not Not relevant" }],
		});
	});

	test("a miss is a result, not a failure", async () => {
		const view = await withAtlas(env, show(["zebra", "scout leads"]));
		expect(view.results.map((result) => result.kind)).toEqual(["none", "candidates"]);
		expect(formatShow(view)).toContain('"zebra": no feature matches');
		expect(formatShow(view)).toContain('"scout leads" matches 2 features:');
		expect(formatShow(view)).toContain("  lead-search · Search leads (matched alias scout leads)");
	});

	test("text for one feature", async () => {
		const view = await withAtlas(env, show(["lead-status"]));
		const text = formatShow(view)
			.replaceAll(env.repo, "<repo>")
			.replaceAll(headOf(env.repo).slice(0, 7), "<sha7>");
		expect(text).toMatchInlineSnapshot(`
"atlas demo · repo <repo> · HEAD <sha7>
[seeded] summaries are machine-written; verify against code before relying on them

lead-status · seeded · seen <sha7>
  Track whether a lead was contacted
  path     scout > curated-feed > lead-status
  aliases  lead state (plan), status pill (ui)
  related  thumbs-feedback: Skipped is not Not relevant
  code     <repo>/src/widget.ts#renderWidget
  docs     <repo>/README.md"
`);
	});

	test("omits the seeded banner when every shown feature is verified", async () => {
		const view = await withAtlas(env, show(["scout"]));
		const text = formatShow(view);
		expect(text).not.toContain("[seeded]");
		expect(text).toContain("  children  curated-feed, lead-search");
	});
});

describe("sql", () => {
	test("runs a select on the read-only layer", async () => {
		await withAtlas(env, seed);
		const result = await withReadonlyAtlas(
			env,
			sql("SELECT name, confidence FROM feature WHERE name LIKE 'lead-%' ORDER BY name"),
		);
		expect(result).toEqual({
			columns: ["name", "confidence"],
			rows: [
				["lead-search", "seeded"],
				["lead-status", "seeded"],
			],
		});
		expect(formatSql(result)).toBe("name\tconfidence\nlead-search\tseeded\nlead-status\tseeded");
	});

	test("a write statement fails", async () => {
		await withAtlas(env, seed);
		const error = await Effect.runPromise(
			Effect.flip(sql("DELETE FROM feature")).pipe(
				Effect.provide(Atlas.layerReadonly(env.options)),
			),
		);
		expect(error._tag).toBe("AtlasDbError");
		const remaining = await withReadonlyAtlas(env, sql("SELECT COUNT(*) AS n FROM feature"));
		expect(remaining.rows).toEqual([[5]]);
	});

	test("refuses the read-write layer", async () => {
		await withAtlas(env, seed);
		const error = await Effect.runPromise(
			Effect.flip(sql("SELECT 1")).pipe(Effect.provide(Atlas.layer(env.options))),
		);
		expect(error._tag).toBe("AtlasInvalid");
	});
});
