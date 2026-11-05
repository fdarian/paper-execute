import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Effect } from "effect";

import { exportAtlas } from "./export.ts";
import { aliasAdd, codeAdd, docAdd, featureSet, relate } from "./product.ts";
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

describe("exportAtlas", () => {
	test("exports features with parents, aliases, pointers and relations by name", async () => {
		await withAtlas(
			env,
			Effect.gen(function* () {
				yield* featureSet({ name: "scout", summary: "Find leads", verified: true });
				yield* featureSet({
					name: "lead-status",
					summary: "Track leads",
					parent: { set: "scout" },
					verified: false,
				});
				yield* featureSet({ name: "thumbs-feedback", summary: "Rate leads", verified: false });
				yield* aliasAdd("lead-status", "status pill", "ui");
				yield* aliasAdd("lead-status", "lead state", "plan");
				yield* codeAdd("lead-status", "src/widget.ts", "renderWidget");
				yield* codeAdd("lead-status", "src/widget.ts");
				yield* docAdd("lead-status", "README.md");
				yield* relate("thumbs-feedback", "lead-status", "Skipped is not Not relevant");
			}),
		);

		const exported = await withReadonlyAtlas(env, exportAtlas());

		expect(exported.project).toBe("demo");
		expect(exported.repo).toBe(env.repo);
		expect(exported.head).toBe(headOf(env.repo));
		expect(exported.features.map((feature) => feature.name)).toEqual([
			"lead-status",
			"scout",
			"thumbs-feedback",
		]);
		expect(exported.features[0]).toEqual({
			name: "lead-status",
			summary: "Track leads",
			confidence: "seeded",
			seenAt: headOf(env.repo),
			parent: "scout",
			aliases: [
				{ term: "lead state", source: "plan" },
				{ term: "status pill", source: "ui" },
			],
			code: [
				{ path: "src/widget.ts", absolute: join(env.repo, "src/widget.ts"), symbol: null },
				{
					path: "src/widget.ts",
					absolute: join(env.repo, "src/widget.ts"),
					symbol: "renderWidget",
				},
			],
			docs: [{ path: "README.md", absolute: join(env.repo, "README.md") }],
		});
		expect(exported.features[1]?.parent).toBeNull();
		expect(exported.features[1]?.aliases).toEqual([]);
		expect(exported.features[1]?.code).toEqual([]);
		expect(exported.relations).toEqual([
			{ a: "lead-status", b: "thumbs-feedback", note: "Skipped is not Not relevant" },
		]);
	});

	test("an empty atlas exports no features", async () => {
		const exported = await withReadonlyAtlas(env, exportAtlas());
		expect(exported.features).toEqual([]);
		expect(exported.relations).toEqual([]);
	});
});
