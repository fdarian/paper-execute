import { definePlugin, type StaticToolSchema, tool } from "@executor-js/sdk/core";
import { icons, type PhosphorIcon } from "@phosphor-icons/core";
import { Effect, Schema } from "effect";
import MiniSearch from "minisearch";

import { IconSearchError } from "#/errors";
import { type IconWeight, iconWeights, readIconSvg } from "#/icons/svg";

type IconRecord = {
	readonly name: string;
	readonly pascal_name: string;
	readonly tags: readonly string[];
};

type IconSearchDocument = {
	readonly id: string;
	readonly text: string;
};

const schemaToStandard = <A, I>(schema: Schema.Decoder<A, I>): StaticToolSchema<A, I> =>
	Schema.toStandardSchemaV1(Schema.toStandardJSONSchemaV1(schema) as never) as StaticToolSchema<
		A,
		I
	>;

const IconSearchInput = Schema.Struct({
	query: Schema.String,
	limit: Schema.optional(Schema.Number),
});

const IconSearchOutput = Schema.Struct({
	results: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			pascal_name: Schema.String,
			tags: Schema.Array(Schema.String),
		}),
	),
});

const IconGetInput = Schema.Struct({
	query: Schema.String,
	weight: Schema.optional(Schema.String),
	size: Schema.optional(Schema.Number),
	color: Schema.optional(Schema.String),
});

const IconGetOutput = Schema.Struct({
	name: Schema.String,
	svg: Schema.String,
});

function buildSearchText(icon: PhosphorIcon): string {
	const aliasText =
		"alias" in icon && icon.alias ? `${icon.alias.name} ${icon.alias.pascal_name}` : "";
	return [icon.name, icon.pascal_name, ...icon.tags, aliasText].join(" ").trim();
}

function resolveWeight(weight: string | undefined): IconWeight {
	if (weight === undefined) {
		return "regular";
	}
	for (const value of iconWeights) {
		if (value === weight) {
			return value;
		}
	}
	return "regular";
}

export const iconToolsPlugin = definePlugin(() => {
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
		id: "icon-tools" as const,
		packageName: "paper-execute",
		storage: () => ({}),
		extension: () => ({}),
		staticSources: () => [
			{
				id: "iconTools",
				kind: "custom",
				name: "Icon Tools",
				tools: [
					tool({
						name: "icon_search",
						description: "Search Phosphor icons by name, PascalCase name, and tags.",
						inputSchema: schemaToStandard(IconSearchInput),
						outputSchema: schemaToStandard(IconSearchOutput),
						execute: (input: typeof IconSearchInput.Type) =>
							Effect.sync(() => {
								const limit = input.limit ?? 8;
								return { results: searchIcons(input.query, limit) };
							}),
					}),
					tool({
						name: "icon_get",
						description: "Find the best matching Phosphor icon and return embed-ready SVG markup.",
						inputSchema: schemaToStandard(IconGetInput),
						outputSchema: schemaToStandard(IconGetOutput),
						execute: (input: typeof IconGetInput.Type) =>
							Effect.gen(function* () {
								const matches = searchIcons(input.query, 1);
								const match = matches[0];
								if (match === undefined) {
									return yield* new IconSearchError({
										query: input.query,
										reason: "No matching icon found",
									});
								}
								const svg = yield* readIconSvg({
									name: match.name,
									weight: resolveWeight(input.weight),
									size: input.size,
									color: input.color,
								});
								return { name: match.name, svg };
							}),
					}),
				],
			},
		],
	};
});
