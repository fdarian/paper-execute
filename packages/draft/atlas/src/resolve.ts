import { read } from "./atlas.ts";
import { all } from "./sqlite.ts";

export type FeatureRef = {
	readonly id: number;
	readonly name: string;
	readonly summary: string;
};

export type Candidate = {
	readonly name: string;
	readonly summary: string;
	readonly matchedAlias?: string;
};

export type Resolution =
	| { readonly kind: "feature"; readonly feature: FeatureRef }
	| { readonly kind: "candidates"; readonly features: readonly Candidate[] }
	| { readonly kind: "none" };

type Hit = FeatureRef & { readonly matched_alias: string | null };

function toResolution(hits: readonly Hit[]): Resolution {
	if (hits.length === 0) return { kind: "none" };
	const first = hits[0];
	if (hits.length === 1 && first !== undefined) {
		return { kind: "feature", feature: { id: first.id, name: first.name, summary: first.summary } };
	}
	return {
		kind: "candidates",
		features: hits.map((hit) =>
			hit.matched_alias === null
				? { name: hit.name, summary: hit.summary }
				: { name: hit.name, summary: hit.summary, matchedAlias: hit.matched_alias },
		),
	};
}

/** Exact name, else exact alias, else substring of a name or alias. */
export function resolve(term: string) {
	return read((atlas) => {
		const alias = term.trim();
		const name = alias.toLowerCase().replace(/\s+/g, "-");
		const db = atlas.db;

		const byName = all<Hit>(
			db,
			"SELECT id, name, summary, NULL AS matched_alias FROM feature WHERE name = ?",
			name,
		);
		if (byName.length > 0) return toResolution(byName);

		const byAlias = all<Hit>(
			db,
			`SELECT feature.id, feature.name, feature.summary, alias.term AS matched_alias
			FROM alias JOIN feature ON feature.id = alias.feature_id
			WHERE alias.term = ? ORDER BY feature.name`,
			alias,
		);
		if (byAlias.length > 0) return toResolution(byAlias);

		const bySubstring = all<Hit>(
			db,
			`SELECT id, name, summary, NULL AS matched_alias FROM feature
				WHERE instr(name, ?1) > 0
			UNION ALL
			SELECT feature.id, feature.name, feature.summary, MIN(alias.term) AS matched_alias
				FROM alias JOIN feature ON feature.id = alias.feature_id
				WHERE instr(lower(alias.term), lower(?2)) > 0 AND instr(feature.name, ?1) = 0
				GROUP BY feature.id
			ORDER BY name`,
			name,
			alias,
		);
		return toResolution(bySubstring);
	});
}
