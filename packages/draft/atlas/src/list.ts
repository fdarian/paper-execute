import { read } from "./atlas.ts";
import type { FeatureStatus } from "./product.ts";
import { all } from "./sqlite.ts";

export type TreeRow = {
	readonly name: string;
	readonly status: FeatureStatus;
	readonly confidence: "seeded" | "verified";
	readonly summary: string;
	readonly depth: number;
};

export type FilteredRow = Omit<TreeRow, "depth"> & { readonly path: readonly string[] };

export type FeatureList =
	| { readonly kind: "tree"; readonly rows: readonly TreeRow[] }
	| { readonly kind: "filtered"; readonly rows: readonly FilteredRow[] };

type WalkRow = TreeRow & { readonly sort_key: string };

// char(1) sorts below every name character, which keeps a parent's subtree ahead of its next sibling.
const WALK = `WITH RECURSIVE walk AS (
	SELECT name, status, confidence, summary, 0 AS depth, name AS sort_key, id
	FROM feature WHERE parent_id IS NULL
	UNION ALL
	SELECT child.name, child.status, child.confidence, child.summary, walk.depth + 1,
		walk.sort_key || char(1) || child.name, child.id
	FROM feature child JOIN walk ON child.parent_id = walk.id
)
SELECT name, status, confidence, summary, depth, sort_key FROM walk ORDER BY sort_key`;

export function list(options: { status?: FeatureStatus } = {}) {
	return read((atlas): FeatureList => {
		const rows = all<WalkRow>(atlas.db, WALK);
		if (options.status === undefined) {
			return {
				kind: "tree",
				rows: rows.map((row) => ({
					name: row.name,
					status: row.status,
					confidence: row.confidence,
					summary: row.summary,
					depth: row.depth,
				})),
			};
		}
		return {
			kind: "filtered",
			rows: rows
				.filter((row) => row.status === options.status)
				.map((row) => ({
					name: row.name,
					status: row.status,
					confidence: row.confidence,
					summary: row.summary,
					path: row.sort_key.split("\u0001"),
				})),
		};
	});
}
