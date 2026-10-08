import { homedir } from "node:os";
import { join } from "node:path";

import { Effect, Schema } from "effect";

import { PaperPluginConfigError } from "#/errors";

const PluginEntrySchema = Schema.Union([
	Schema.String,
	Schema.Tuple([Schema.String, Schema.Unknown]),
]);

// `true` inherits the whole value; a string array inherits only those sub-keys of an object value.
const InheritSettingSchema = Schema.Union([Schema.Literal(true), Schema.Array(Schema.String)]);

const PaperPluginConfigSchema = Schema.Struct({
	paperMcpUrl: Schema.optional(Schema.String),
	plugins: Schema.Array(PluginEntrySchema),
	cc: Schema.optional(
		Schema.Struct({
			inheritSettings: Schema.optional(Schema.Record(Schema.String, InheritSettingSchema)),
		}),
	),
});

export type PaperPluginEntry = typeof PluginEntrySchema.Type;
export type PaperPluginConfig = typeof PaperPluginConfigSchema.Type;
export type InheritSettings = Readonly<Record<string, typeof InheritSettingSchema.Type>>;

export function decodePluginConfig(input: unknown): PaperPluginConfig {
	return Schema.decodeUnknownSync(PaperPluginConfigSchema)(input);
}

export const defaultPluginConfig: PaperPluginConfig = {
	plugins: ["icon", "image"],
};

export function discoverPluginConfig(): Effect.Effect<
	{
		readonly config: PaperPluginConfig;
		readonly path: string | null;
	},
	PaperPluginConfigError
> {
	return Effect.gen(function* () {
		const localPath = join(process.cwd(), "paper-execute.config.json");
		const globalPath = join(homedir(), ".config", "paper-execute", "config.json");
		const localConfig = yield* readConfigAtPath(localPath);
		if (localConfig !== null) {
			return { config: localConfig, path: localPath };
		}
		const globalConfig = yield* readConfigAtPath(globalPath);
		if (globalConfig !== null) {
			return { config: globalConfig, path: globalPath };
		}
		return { config: defaultPluginConfig, path: null };
	});
}

function readConfigAtPath(
	path: string,
): Effect.Effect<PaperPluginConfig | null, PaperPluginConfigError> {
	return Effect.tryPromise({
		try: async () => {
			const file = Bun.file(path);
			const exists = await file.exists();
			if (!exists) {
				return null;
			}
			const parsed = JSON.parse(await file.text());
			return decodePluginConfig(parsed);
		},
		catch: (cause) =>
			new PaperPluginConfigError({
				reason: `Failed to read plugin config at ${path}: ${String(cause)}`,
			}),
	});
}
