import { type AtlasHandle, write } from "./atlas.ts";
import { AtlasConflict, AtlasInvalid, AtlasNotFound } from "./errors.ts";
import { assertContainsSymbol, repoPath } from "./repo-path.ts";
import type { aliasSources } from "./schema.ts";
import { all, get, run } from "./sqlite.ts";

export type FeatureStatus = "built" | "planned";
export type AliasSource = (typeof aliasSources)[number];

const kebabName = /^[a-z0-9]+(-[a-z0-9]+)*$/;

type FeatureRow = {
	readonly id: number;
	readonly name: string;
	readonly summary: string;
	readonly status: FeatureStatus;
	readonly confidence: "seeded" | "verified";
	readonly parent_id: number | null;
};

function findFeature(atlas: AtlasHandle, name: string): FeatureRow | null {
	return get<FeatureRow>(atlas.db, "SELECT * FROM feature WHERE name = ?", name);
}

function requireFeature(atlas: AtlasHandle, name: string): FeatureRow {
	const feature = findFeature(atlas, name);
	if (feature === null) throw new AtlasNotFound({ kind: "feature", name });
	return feature;
}

function assertName(name: string): void {
	if (!kebabName.test(name)) {
		throw new AtlasInvalid({
			reason: `"${name}" is not a valid feature name: use lowercase kebab-case, like "lead-status"`,
		});
	}
}

function touch(atlas: AtlasHandle, featureId: number, head: string): void {
	run(atlas.db, "UPDATE feature SET seen_at = ? WHERE id = ?", head, featureId);
}

function isAncestorOrSelf(atlas: AtlasHandle, candidateId: number, ofId: number): boolean {
	return (
		get(
			atlas.db,
			`WITH RECURSIVE up (id) AS (
				SELECT ?
				UNION
				SELECT feature.parent_id FROM feature JOIN up ON feature.id = up.id WHERE feature.parent_id IS NOT NULL
			)
			SELECT 1 FROM up WHERE id = ?`,
			ofId,
			candidateId,
		) !== null
	);
}

export type FeatureSetInput = {
	readonly name: string;
	readonly summary?: string;
	/** `undefined` keeps the current parent (root on create). */
	readonly parent?: { readonly set: string } | "root";
	readonly status?: FeatureStatus;
	/** `true` marks the feature verified; `false` never downgrades. */
	readonly verified: boolean;
};

function assertSummary(summary: string): string {
	const trimmed = summary.trim();
	if (trimmed.length === 0 || trimmed.includes("\n")) {
		throw new AtlasInvalid({ reason: "A feature summary must be one non-empty line" });
	}
	return trimmed;
}

function resolveParent(
	atlas: AtlasHandle,
	parent: FeatureSetInput["parent"],
	self: FeatureRow | null,
): number | null | undefined {
	if (parent === undefined) return undefined;
	if (parent === "root") return null;
	const parentRow = requireFeature(atlas, parent.set);
	if (self !== null) {
		if (parentRow.id === self.id) {
			throw new AtlasInvalid({ reason: `${self.name} cannot be its own parent` });
		}
		if (isAncestorOrSelf(atlas, self.id, parentRow.id)) {
			throw new AtlasInvalid({
				reason: `Making ${parent.set} the parent of ${self.name} would create a cycle`,
			});
		}
	}
	return parentRow.id;
}

function insertFeature(
	atlas: AtlasHandle,
	head: string,
	input: Pick<FeatureSetInput, "name" | "summary" | "status" | "verified">,
	parentId: number | null | undefined,
): void {
	assertName(input.name);
	if (input.summary === undefined) {
		throw new AtlasInvalid({ reason: `Creating feature "${input.name}" requires a summary` });
	}
	run(
		atlas.db,
		`INSERT INTO feature (name, summary, status, confidence, parent_id, seen_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		input.name,
		assertSummary(input.summary),
		input.status ?? "built",
		input.verified ? "verified" : "seeded",
		parentId ?? null,
		head,
	);
}

export function featureSet(input: FeatureSetInput) {
	return write((atlas, head) => {
		const existing = findFeature(atlas, input.name);
		const parentId = resolveParent(atlas, input.parent, existing);
		if (existing === null) {
			insertFeature(atlas, head, input, parentId);
			return { name: input.name, created: true };
		}
		run(
			atlas.db,
			`UPDATE feature SET
				summary = ?, status = ?, confidence = ?, parent_id = ?, seen_at = ?
			WHERE id = ?`,
			input.summary === undefined ? existing.summary : assertSummary(input.summary),
			input.status ?? existing.status,
			input.verified ? "verified" : existing.confidence,
			parentId === undefined ? existing.parent_id : parentId,
			head,
			existing.id,
		);
		return { name: input.name, created: false };
	});
}

export type FeatureAddInput = {
	readonly name: string;
	readonly summary: string;
	readonly parent?: string;
	readonly status?: FeatureStatus;
};

function parentPath(atlas: AtlasHandle, parentId: number | null): string {
	if (parentId === null) return "root";
	return all<{ name: string }>(
		atlas.db,
		`WITH RECURSIVE up (id, parent_id, name, depth) AS (
			SELECT id, parent_id, name, 0 FROM feature WHERE id = ?
			UNION ALL
			SELECT feature.id, feature.parent_id, feature.name, up.depth + 1
			FROM feature JOIN up ON feature.id = up.parent_id
		)
		SELECT name FROM up ORDER BY depth DESC`,
		parentId,
	)
		.map((entry) => entry.name)
		.join(" > ");
}

/** Create-only: parallel writers must not silently overwrite each other's features. */
export function featureAdd(input: FeatureAddInput) {
	return write((atlas, head) => {
		const existing = findFeature(atlas, input.name);
		if (existing !== null) {
			throw new AtlasConflict({
				reason: `feature "${input.name}" already exists (under ${parentPath(atlas, existing.parent_id)}): ${existing.summary}. Add your pointers and aliases to it if it's the same thing, or pick a more specific name.`,
			});
		}
		const parentId = resolveParent(
			atlas,
			input.parent === undefined ? undefined : { set: input.parent },
			null,
		);
		insertFeature(atlas, head, { ...input, verified: false }, parentId);
		return { name: input.name };
	});
}

export function featureRename(oldName: string, newName: string) {
	return write((atlas, head) => {
		const feature = requireFeature(atlas, oldName);
		assertName(newName);
		if (findFeature(atlas, newName) !== null) {
			throw new AtlasInvalid({ reason: `Feature "${newName}" already exists; use merge` });
		}
		run(atlas.db, "UPDATE feature SET name = ? WHERE id = ?", newName, feature.id);
		run(
			atlas.db,
			"INSERT OR IGNORE INTO alias (term, feature_id, source) VALUES (?, ?, 'user')",
			oldName,
			feature.id,
		);
		touch(atlas, feature.id, head);
	});
}

export function featureMerge(from: string, into: string) {
	return write((atlas, head) => {
		const source = requireFeature(atlas, from);
		const target = requireFeature(atlas, into);
		if (source.id === target.id) {
			throw new AtlasInvalid({ reason: `Cannot merge ${from} into itself` });
		}
		const db = atlas.db;

		if (isAncestorOrSelf(atlas, source.id, target.id)) {
			run(db, "UPDATE feature SET parent_id = ? WHERE id = ?", source.parent_id, target.id);
		}
		run(db, "UPDATE feature SET parent_id = ? WHERE parent_id = ?", target.id, source.id);

		run(
			db,
			`INSERT OR IGNORE INTO alias (term, feature_id, source)
			SELECT term, ?, source FROM alias WHERE feature_id = ?`,
			target.id,
			source.id,
		);
		run(
			db,
			"INSERT OR IGNORE INTO alias (term, feature_id, source) VALUES (?, ?, 'user')",
			from,
			target.id,
		);
		run(
			db,
			`INSERT OR IGNORE INTO code (feature_id, path, symbol)
			SELECT ?, path, symbol FROM code WHERE feature_id = ?`,
			target.id,
			source.id,
		);
		run(
			db,
			"INSERT OR IGNORE INTO doc (feature_id, path) SELECT ?, path FROM doc WHERE feature_id = ?",
			target.id,
			source.id,
		);

		const relations = all<{ other: number; note: string }>(
			db,
			`SELECT CASE WHEN a_id = ? THEN b_id ELSE a_id END AS other, note
			FROM relation WHERE a_id = ? OR b_id = ?`,
			source.id,
			source.id,
			source.id,
		);
		for (const relation of relations) {
			if (relation.other === target.id) continue;
			run(
				db,
				"INSERT OR IGNORE INTO relation (a_id, b_id, note) VALUES (?, ?, ?)",
				Math.min(target.id, relation.other),
				Math.max(target.id, relation.other),
				relation.note,
			);
		}

		run(
			db,
			`INSERT OR IGNORE INTO ref_feature (ref_id, feature_id)
			SELECT ref_id, ? FROM ref_feature WHERE feature_id = ?`,
			target.id,
			source.id,
		);
		run(
			db,
			`INSERT OR IGNORE INTO frame_feature (frame_id, feature_id)
			SELECT frame_id, ? FROM frame_feature WHERE feature_id = ?`,
			target.id,
			source.id,
		);
		run(
			db,
			`INSERT OR IGNORE INTO decision_feature (decision_id, feature_id)
			SELECT decision_id, ? FROM decision_feature WHERE feature_id = ?`,
			target.id,
			source.id,
		);

		run(db, "DELETE FROM feature WHERE id = ?", source.id);
		touch(atlas, target.id, head);
	});
}

function count(atlas: AtlasHandle, sql: string, featureId: number): number {
	const row = get<{ n: number }>(atlas.db, sql, featureId);
	if (row === null) throw new Error("COUNT returned no row");
	return row.n;
}

export function featureRm(name: string) {
	return write((atlas) => {
		const feature = requireFeature(atlas, name);
		const blockers = [
			[
				"children",
				count(atlas, "SELECT COUNT(*) AS n FROM feature WHERE parent_id = ?", feature.id),
			],
			[
				"refs",
				count(atlas, "SELECT COUNT(*) AS n FROM ref_feature WHERE feature_id = ?", feature.id),
			],
			[
				"frames",
				count(atlas, "SELECT COUNT(*) AS n FROM frame_feature WHERE feature_id = ?", feature.id),
			],
			[
				"decisions",
				count(atlas, "SELECT COUNT(*) AS n FROM decision_feature WHERE feature_id = ?", feature.id),
			],
		] as const;
		const blocking = blockers.filter((blocker) => blocker[1] > 0);
		if (blocking.length > 0) {
			throw new AtlasConflict({
				reason: `Cannot remove ${name}: it still has ${blocking
					.map((blocker) => `${blocker[1]} ${blocker[0]}`)
					.join(", ")}. Use merge to fold it into another feature.`,
			});
		}
		run(atlas.db, "DELETE FROM feature WHERE id = ?", feature.id);
	});
}

export function aliasAdd(feature: string, term: string, source: AliasSource) {
	return write((atlas, head) => {
		const row = requireFeature(atlas, feature);
		const trimmed = term.trim();
		if (trimmed.length === 0) throw new AtlasInvalid({ reason: "An alias cannot be empty" });
		run(
			atlas.db,
			`INSERT INTO alias (term, feature_id, source) VALUES (?, ?, ?)
			ON CONFLICT (term, feature_id) DO UPDATE SET source = excluded.source`,
			trimmed,
			row.id,
			source,
		);
		touch(atlas, row.id, head);
	});
}

export function aliasRm(feature: string, term: string) {
	return write((atlas, head) => {
		const row = requireFeature(atlas, feature);
		const removed = run(
			atlas.db,
			"DELETE FROM alias WHERE feature_id = ? AND term = ?",
			row.id,
			term.trim(),
		);
		if (removed === 0) throw new AtlasNotFound({ kind: "alias", name: term });
		touch(atlas, row.id, head);
	});
}

export function codeAdd(feature: string, path: string, symbol?: string) {
	return write((atlas, head) => {
		const row = requireFeature(atlas, feature);
		const file = repoPath(atlas.repo, path, { mustExist: true });
		if (symbol !== undefined) assertContainsSymbol(file, symbol);
		run(
			atlas.db,
			"INSERT OR IGNORE INTO code (feature_id, path, symbol) VALUES (?, ?, ?)",
			row.id,
			file.stored,
			symbol ?? null,
		);
		touch(atlas, row.id, head);
	});
}

/** Unlike `add`, the file may be gone: removing a broken pointer is the point. */
export function codeRm(feature: string, path: string, symbol?: string) {
	return write((atlas, head) => {
		const row = requireFeature(atlas, feature);
		const file = repoPath(atlas.repo, path, { mustExist: false });
		const removed = run(
			atlas.db,
			"DELETE FROM code WHERE feature_id = ? AND path = ? AND IFNULL(symbol, '') = ?",
			row.id,
			file.stored,
			symbol ?? "",
		);
		if (removed === 0) {
			throw new AtlasNotFound({
				kind: "code",
				name: symbol === undefined ? file.stored : `${file.stored}#${symbol}`,
			});
		}
		touch(atlas, row.id, head);
	});
}

export function docAdd(feature: string, path: string) {
	return write((atlas, head) => {
		const row = requireFeature(atlas, feature);
		const file = repoPath(atlas.repo, path, { mustExist: true });
		run(
			atlas.db,
			"INSERT OR IGNORE INTO doc (feature_id, path) VALUES (?, ?)",
			row.id,
			file.stored,
		);
		touch(atlas, row.id, head);
	});
}

/** Unlike `add`, the file may be gone: removing a broken pointer is the point. */
export function docRm(feature: string, path: string) {
	return write((atlas, head) => {
		const row = requireFeature(atlas, feature);
		const file = repoPath(atlas.repo, path, { mustExist: false });
		const removed = run(
			atlas.db,
			"DELETE FROM doc WHERE feature_id = ? AND path = ?",
			row.id,
			file.stored,
		);
		if (removed === 0) throw new AtlasNotFound({ kind: "doc", name: file.stored });
		touch(atlas, row.id, head);
	});
}

export function relate(a: string, b: string, note: string) {
	return write((atlas) => {
		const first = requireFeature(atlas, a);
		const second = requireFeature(atlas, b);
		if (first.id === second.id) {
			throw new AtlasInvalid({ reason: `Cannot relate ${a} to itself` });
		}
		run(
			atlas.db,
			`INSERT INTO relation (a_id, b_id, note) VALUES (?, ?, ?)
			ON CONFLICT (a_id, b_id) DO UPDATE SET note = excluded.note`,
			Math.min(first.id, second.id),
			Math.max(first.id, second.id),
			note,
		);
	});
}

export function unrelate(a: string, b: string) {
	return write((atlas) => {
		const first = requireFeature(atlas, a);
		const second = requireFeature(atlas, b);
		const removed = run(
			atlas.db,
			"DELETE FROM relation WHERE a_id = ? AND b_id = ?",
			Math.min(first.id, second.id),
			Math.max(first.id, second.id),
		);
		if (removed === 0) throw new AtlasNotFound({ kind: "relation", name: `${a} ~ ${b}` });
	});
}
