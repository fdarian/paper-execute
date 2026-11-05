import { read } from "./atlas.ts";
import { all } from "./sqlite.ts";

export type TreeRow = {
	readonly name: string;
	readonly confidence: "seeded" | "verified";
	readonly summary: string;
	readonly depth: number;
};

export type FeatureList = { readonly rows: readonly TreeRow[] };

// char(1) sorts below every name character, which keeps a parent's subtree ahead of its next sibling.
const WALK = `WITH RECURSIVE walk AS (
	SELECT name, confidence, summary, 0 AS depth, name AS sort_key, id
	FROM feature WHERE parent_id IS NULL
	UNION ALL
	SELECT child.name, child.confidence, child.summary, walk.depth + 1,
		walk.sort_key || char(1) || child.name, child.id
	FROM feature child JOIN walk ON child.parent_id = walk.id
)
SELECT name, confidence, summary, depth FROM walk ORDER BY sort_key`;

export function list() {
	return read((atlas): FeatureList => ({ rows: all<TreeRow>(atlas.db, WALK) }));
}
