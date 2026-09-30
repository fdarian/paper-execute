import type { Schema } from "@executor-js/sdk/core";
import type * as standardSchemaV1 from "@standard-schema/spec";

/** A tool's `input`/`output`: a Standard Schema (e.g. zod), or an Effect Schema (e.g. Schema.Boolean, wrapped or not). */
export type PaperPluginSchema = standardSchemaV1.StandardSchemaV1 | Schema.Schema<unknown>;

export type PaperPluginLeaf = {
	readonly input?: PaperPluginSchema;
	readonly output?: PaperPluginSchema;
	readonly execute: (arg: unknown) => unknown;
};

export type PaperPluginToolNode =
	| PaperPluginLeaf
	| {
			readonly [key: string]: PaperPluginToolNode;
	  };

export type PaperPlugin = {
	readonly name: string;
	readonly docs: string;
	readonly tools: Record<string, PaperPluginToolNode>;
};

export function definePaperPlugin(plugin: PaperPlugin): PaperPlugin {
	return plugin;
}
