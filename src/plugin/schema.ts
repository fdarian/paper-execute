import { Schema, type StaticToolSchema } from "@executor-js/sdk/core";
import type * as standardSchemaV1 from "@standard-schema/spec";

import type { PaperPluginSchema } from "#/plugin/define";

const EmptyObjectSchema = Schema.toStandardSchemaV1(Schema.Struct({}));

type PaperPluginToolSchema = standardSchemaV1.StandardSchemaV1 &
	ReturnType<typeof Schema.toStandardJSONSchemaV1>;

export function makeInputSchema(
	schema: PaperPluginSchema | undefined,
): StaticToolSchema<unknown, unknown> {
	if (schema === undefined) {
		return schemaToStaticToolSchema(EmptyObjectSchema);
	}
	return schemaToStaticToolSchema(schema);
}

export function makeOutputSchema(
	schema: PaperPluginSchema | undefined,
): StaticToolSchema<unknown, unknown> | undefined {
	if (schema === undefined) {
		return undefined;
	}
	return schemaToStaticToolSchema(schema);
}

function schemaToStaticToolSchema(schema: PaperPluginSchema): StaticToolSchema<unknown, unknown> {
	return toExecutorSchema(schema) as StaticToolSchema<unknown, unknown>;
}

function toExecutorSchema(schema: PaperPluginSchema): PaperPluginToolSchema {
	if (Schema.isSchema(schema)) {
		// Wraps a raw Effect Schema (e.g. `Schema.Boolean`) into a Standard Schema.
		// Idempotent for a schema that's already wrapped this way (`toStandardSchemaV1`/
		// `toStandardJSONSchemaV1` mutate the schema object in place and no-op if already applied).
		return Schema.toStandardSchemaV1(
			Schema.toStandardJSONSchemaV1(schema) as never,
		) as PaperPluginToolSchema;
	}
	const standardData = (schema as PaperPluginToolSchema)["~standard"] as
		| PaperPluginToolSchema["~standard"]
		| undefined;
	if (standardData === undefined) {
		throw new Error(
			"Invalid tool schema: expected a Standard Schema (e.g. a zod schema) or an Effect Schema (e.g. Schema.String), got neither.",
		);
	}
	return schema as PaperPluginToolSchema;
}
