import type { FeatureList } from "./list.ts";
import type { FeatureView, ShowView } from "./show.ts";
import type { SqlResult } from "./sql.ts";

const SEEDED_BANNER =
	"[seeded] summaries are machine-written; verify against code before relying on them";

const sha7 = (sha: string) => sha.slice(0, 7);

function featureBlock(feature: FeatureView): string {
	const sections: [label: string, lines: string[]][] = [];
	if (feature.path.length > 1) sections.push(["path", [feature.path.join(" > ")]]);
	if (feature.aliases.length > 0) {
		sections.push([
			"aliases",
			[feature.aliases.map((alias) => `${alias.term} (${alias.source})`).join(", ")],
		]);
	}
	if (feature.children.length > 0) sections.push(["children", [feature.children.join(", ")]]);
	if (feature.related.length > 0) {
		sections.push([
			"related",
			feature.related.map((related) => `${related.name}: ${related.note}`),
		]);
	}
	if (feature.code.length > 0) {
		sections.push([
			"code",
			feature.code.map((code) =>
				code.symbol === undefined ? code.path : `${code.path}#${code.symbol}`,
			),
		]);
	}
	if (feature.docs.length > 0) sections.push(["docs", [...feature.docs]]);

	const width = Math.max(0, ...sections.map((section) => section[0].length)) + 2;
	const lines = [
		`${feature.name} · ${feature.confidence} · seen ${sha7(feature.seenAt)}`,
		`  ${feature.summary}`,
	];
	for (const section of sections) {
		section[1].forEach((line, index) => {
			const label = index === 0 ? section[0] : "";
			lines.push(`  ${label.padEnd(width)}${line}`);
		});
	}
	return lines.join("\n");
}

export function formatShow(view: ShowView): string {
	const header = `atlas ${view.project} · repo ${view.repo} · HEAD ${sha7(view.head)}`;
	const seeded = view.results.some(
		(result) => result.kind === "feature" && result.feature.confidence === "seeded",
	);
	const blocks = view.results.map((result) => {
		if (result.kind === "feature") return featureBlock(result.feature);
		if (result.kind === "none") return `"${result.term}": no feature matches`;
		return [
			`"${result.term}" matches ${result.features.length} features:`,
			...result.features.map(
				(candidate) =>
					`  ${candidate.name} · ${candidate.summary}${
						candidate.matchedAlias === undefined ? "" : ` (matched alias ${candidate.matchedAlias})`
					}`,
			),
		].join("\n");
	});
	const top = seeded ? `${header}\n${SEEDED_BANNER}` : header;
	return [top, ...blocks].join("\n\n");
}

export function formatList(list: FeatureList): string {
	return list.rows
		.map((row) => `${"  ".repeat(row.depth)}${row.name} · ${row.confidence} · ${row.summary}`)
		.join("\n");
}

function cell(value: unknown): string {
	if (value === null) return "NULL";
	if (value instanceof Uint8Array) return `<${value.length} bytes>`;
	return String(value);
}

export function formatSql(result: SqlResult): string {
	return [result.columns.join("\t"), ...result.rows.map((row) => row.map(cell).join("\t"))].join(
		"\n",
	);
}
