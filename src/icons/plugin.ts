import { icons, type PhosphorIcon } from "@phosphor-icons/core";
import { Effect, Schema } from "effect";
import MiniSearch from "minisearch";

import { IconSearchError } from "#/errors";
import { readIconSvg } from "#/icons/svg";
import { definePaperPlugin } from "#/plugin/define";

type IconRecord = {
	readonly name: string;
	readonly pascal_name: string;
	readonly tags: readonly string[];
};

type IconSearchDocument = {
	readonly id: string;
	readonly text: string;
};

const IconSearchInput = Schema.toStandardSchemaV1(Schema.String);

const IconSearchOutput = Schema.toStandardSchemaV1(
	Schema.Array(
		Schema.Struct({
			name: Schema.String,
			pascal_name: Schema.String,
			tags: Schema.Array(Schema.String),
		}),
	),
);

const IconGetInput = Schema.toStandardSchemaV1(Schema.String);

const IconGetOutput = Schema.toStandardSchemaV1(Schema.String);

export const iconPlugin = definePaperPlugin({
	name: "icon",
	docs: "Phosphor icon helpers. `plugins.icon.get(name)` returns SVG markup. `plugins.icon.search(query)` returns candidate icon matches.",
	tools: buildIconTools(),
});

function buildSearchText(icon: PhosphorIcon): string {
	const aliasText =
		"alias" in icon && icon.alias ? `${icon.alias.name} ${icon.alias.pascal_name}` : "";
	return [icon.name, icon.pascal_name, ...icon.tags, aliasText].join(" ").trim();
}

function buildIconTools() {
	const iconByName = new Map<string, IconRecord>();
	const index = new MiniSearch<IconSearchDocument>({
		fields: ["text"],
		storeFields: ["id"],
	});

	for (const icon of icons) {
		iconByName.set(icon.name, {
			name: icon.name,
			pascal_name: icon.pascal_name,
			tags: icon.tags,
		});
		index.add({
			id: icon.name,
			text: buildSearchText(icon),
		});
	}

	function searchIcons(query: string, limit: number): readonly IconRecord[] {
		const results = index.search(query, { fuzzy: 0.2, prefix: true });
		return results.slice(0, limit).flatMap((result) => {
			const icon = iconByName.get(result.id);
			return icon ? [icon] : [];
		});
	}

	return {
		search: {
			input: IconSearchInput,
			output: IconSearchOutput,
			execute: (query: unknown) =>
				Effect.sync(() => {
					if (typeof query !== "string") {
						return [];
					}
					return searchIcons(query, 8);
				}),
		},
		get: {
			input: IconGetInput,
			output: IconGetOutput,
			execute: (query: unknown) =>
				Effect.gen(function* () {
					if (typeof query !== "string") {
						return yield* new IconSearchError({
							query: String(query),
							reason: "Query must be a string",
						});
					}
					const matches = searchIcons(query, 1);
					const match = matches[0];
					if (match === undefined) {
						return yield* new IconSearchError({
							query,
							reason: "No matching icon found",
						});
					}
					return yield* readIconSvg({
						name: match.name,
						weight: "regular",
						size: undefined,
						color: undefined,
					});
				}),
		},
	};
}
