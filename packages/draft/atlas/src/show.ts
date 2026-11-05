import { join } from "node:path";
import { Effect } from "effect";

import { Atlas, type AtlasHandle, read } from "./atlas.ts";
import type { AliasSource } from "./product.ts";
import { type Candidate, resolve } from "./resolve.ts";
import { all, get } from "./sqlite.ts";

export type FeatureView = {
	readonly name: string;
	readonly summary: string;
	readonly confidence: "seeded" | "verified";
	readonly seenAt: string;
	/** Root to self. */
	readonly path: readonly string[];
	readonly children: readonly string[];
	readonly aliases: readonly { term: string; source: AliasSource }[];
	/** Absolute. */
	readonly code: readonly { path: string; symbol?: string }[];
	/** Absolute. */
	readonly docs: readonly string[];
	readonly related: readonly { name: string; note: string }[];
};

export type ShowResult =
	| { readonly kind: "feature"; readonly term: string; readonly feature: FeatureView }
	| { readonly kind: "candidates"; readonly term: string; readonly features: readonly Candidate[] }
	| { readonly kind: "none"; readonly term: string };

export type ShowView = {
	readonly project: string;
	readonly repo: string;
	readonly head: string;
	readonly results: readonly ShowResult[];
};

type Row = {
	readonly id: number;
	readonly name: string;
	readonly summary: string;
	readonly confidence: "seeded" | "verified";
	readonly seen_at: string;
};

function loadFeature(atlas: AtlasHandle, id: number): FeatureView {
	const db = atlas.db;
	const row = get<Row>(
		db,
		"SELECT id, name, summary, confidence, seen_at FROM feature WHERE id = ?",
		id,
	);
	if (row === null) throw new Error(`Feature ${id} vanished during show`);
	const path = all<{ name: string }>(
		db,
		`WITH RECURSIVE up (id, parent_id, name, depth) AS (
			SELECT id, parent_id, name, 0 FROM feature WHERE id = ?
			UNION ALL
			SELECT feature.id, feature.parent_id, feature.name, up.depth + 1
			FROM feature JOIN up ON feature.id = up.parent_id
		)
		SELECT name FROM up ORDER BY depth DESC`,
		id,
	);
	return {
		name: row.name,
		summary: row.summary,
		confidence: row.confidence,
		seenAt: row.seen_at,
		path: path.map((entry) => entry.name),
		children: all<{ name: string }>(
			db,
			"SELECT name FROM feature WHERE parent_id = ? ORDER BY name",
			id,
		).map((child) => child.name),
		aliases: all<{ term: string; source: AliasSource }>(
			db,
			"SELECT term, source FROM alias WHERE feature_id = ? ORDER BY term",
			id,
		),
		code: all<{ path: string; symbol: string | null }>(
			db,
			"SELECT path, symbol FROM code WHERE feature_id = ? ORDER BY path, IFNULL(symbol, '')",
			id,
		).map((code) =>
			code.symbol === null
				? { path: join(atlas.repo, code.path) }
				: { path: join(atlas.repo, code.path), symbol: code.symbol },
		),
		docs: all<{ path: string }>(
			db,
			"SELECT path FROM doc WHERE feature_id = ? ORDER BY path",
			id,
		).map((doc) => join(atlas.repo, doc.path)),
		related: all<{ name: string; note: string }>(
			db,
			`SELECT feature.name, relation.note FROM relation
			JOIN feature ON feature.id = CASE WHEN relation.a_id = ?1 THEN relation.b_id ELSE relation.a_id END
			WHERE relation.a_id = ?1 OR relation.b_id = ?1 ORDER BY feature.name`,
			id,
		),
	};
}

export function show(terms: readonly string[]) {
	return Effect.gen(function* () {
		const atlas = yield* Atlas;
		const head = yield* atlas.head;
		const results: ShowResult[] = [];
		for (const term of terms) {
			const resolution = yield* resolve(term);
			if (resolution.kind === "none") {
				results.push({ kind: "none", term });
			} else if (resolution.kind === "candidates") {
				results.push({ kind: "candidates", term, features: resolution.features });
			} else {
				const feature = yield* read((handle) => loadFeature(handle, resolution.feature.id));
				results.push({ kind: "feature", term, feature });
			}
		}
		return { project: atlas.project, repo: atlas.repo, head, results } satisfies ShowView;
	});
}
