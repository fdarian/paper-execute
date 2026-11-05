import { join } from "node:path";
import { Effect } from "effect";

import { Atlas, read } from "./atlas.ts";
import type { AliasSource, FeatureStatus } from "./product.ts";
import { all } from "./sqlite.ts";

export type ExportedFeature = {
	readonly name: string;
	readonly summary: string;
	readonly status: FeatureStatus;
	readonly confidence: "seeded" | "verified";
	readonly seenAt: string;
	readonly parent: string | null;
	readonly aliases: readonly { term: string; source: AliasSource }[];
	/** `path` is repo-relative, `absolute` is joined with the repo. */
	readonly code: readonly { path: string; absolute: string; symbol: string | null }[];
	readonly docs: readonly { path: string; absolute: string }[];
};

export type ExportedRelation = { readonly a: string; readonly b: string; readonly note: string };

export type AtlasExport = {
	readonly project: string;
	readonly repo: string;
	readonly head: string;
	readonly features: readonly ExportedFeature[];
	readonly relations: readonly ExportedRelation[];
};

type FeatureRow = {
	readonly id: number;
	readonly name: string;
	readonly summary: string;
	readonly status: FeatureStatus;
	readonly confidence: "seeded" | "verified";
	readonly seen_at: string;
	readonly parent: string | null;
};

function groupByFeature<Row extends { readonly feature_id: number }, Item>(
	rows: readonly Row[],
	toItem: (row: Row) => Item,
): Map<number, Item[]> {
	const groups = new Map<number, Item[]>();
	for (const row of rows) {
		const group = groups.get(row.feature_id);
		if (group === undefined) groups.set(row.feature_id, [toItem(row)]);
		else group.push(toItem(row));
	}
	return groups;
}

/** The whole atlas in one document, built from a handful of set-based queries. */
export function exportAtlas() {
	return Effect.gen(function* () {
		const atlas = yield* Atlas;
		const head = yield* atlas.head;
		return yield* read((handle): AtlasExport => {
			const db = handle.db;
			const features = all<FeatureRow>(
				db,
				`SELECT feature.id, feature.name, feature.summary, feature.status, feature.confidence,
					feature.seen_at, parent.name AS parent
				FROM feature LEFT JOIN feature parent ON parent.id = feature.parent_id
				ORDER BY feature.name`,
			);
			const aliases = groupByFeature(
				all<{ feature_id: number; term: string; source: AliasSource }>(
					db,
					"SELECT feature_id, term, source FROM alias ORDER BY term",
				),
				(row) => ({ term: row.term, source: row.source }),
			);
			const code = groupByFeature(
				all<{ feature_id: number; path: string; symbol: string | null }>(
					db,
					"SELECT feature_id, path, symbol FROM code ORDER BY path, IFNULL(symbol, '')",
				),
				(row) => ({
					path: row.path,
					absolute: join(handle.repo, row.path),
					symbol: row.symbol,
				}),
			);
			const docs = groupByFeature(
				all<{ feature_id: number; path: string }>(
					db,
					"SELECT feature_id, path FROM doc ORDER BY path",
				),
				(row) => ({ path: row.path, absolute: join(handle.repo, row.path) }),
			);
			const relations = all<ExportedRelation>(
				db,
				`SELECT a.name AS a, b.name AS b, relation.note
				FROM relation JOIN feature a ON a.id = relation.a_id JOIN feature b ON b.id = relation.b_id
				ORDER BY a.name, b.name`,
			);
			return {
				project: handle.project,
				repo: handle.repo,
				head,
				features: features.map((row) => ({
					name: row.name,
					summary: row.summary,
					status: row.status,
					confidence: row.confidence,
					seenAt: row.seen_at,
					parent: row.parent,
					aliases: aliases.get(row.id) ?? [],
					code: code.get(row.id) ?? [],
					docs: docs.get(row.id) ?? [],
				})),
				relations,
			};
		});
	});
}
