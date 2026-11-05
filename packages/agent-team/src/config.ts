import { homedir } from "node:os";
import { join } from "node:path";

import { Effect, Schema } from "effect";

import { AgentTeamConfigError } from "./errors.ts";

// `true` inherits the whole value; a string array inherits only those sub-keys of an object value.
const InheritSettingSchema = Schema.Union([Schema.Literal(true), Schema.Array(Schema.String)]);

// The config file is shared with the host app, which owns every other key; excess keys are ignored on decode.
const AgentTeamConfigSchema = Schema.Struct({
	cc: Schema.optional(
		Schema.Struct({
			inheritSettings: Schema.optional(Schema.Record(Schema.String, InheritSettingSchema)),
			settings: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
		}),
	),
});

export type InheritSettings = Readonly<Record<string, typeof InheritSettingSchema.Type>>;
export type AgentTeamConfig = typeof AgentTeamConfigSchema.Type;

export function decodeAgentTeamConfig(input: unknown): AgentTeamConfig {
	return Schema.decodeUnknownSync(AgentTeamConfigSchema)(input);
}

// Same discovery order as the host app's plugin config: the first file that exists wins.
export function discoverAgentTeamConfig(): Effect.Effect<AgentTeamConfig, AgentTeamConfigError> {
	return Effect.gen(function* () {
		const localConfig = yield* readConfigAtPath(join(process.cwd(), "paper-execute.config.json"));
		if (localConfig !== null) return localConfig;
		const globalConfig = yield* readConfigAtPath(
			join(homedir(), ".config", "paper-execute", "config.json"),
		);
		return globalConfig ?? {};
	});
}

function readConfigAtPath(
	path: string,
): Effect.Effect<AgentTeamConfig | null, AgentTeamConfigError> {
	return Effect.tryPromise({
		try: async () => {
			const file = Bun.file(path);
			if (!(await file.exists())) return null;
			return decodeAgentTeamConfig(JSON.parse(await file.text()));
		},
		catch: (cause) =>
			new AgentTeamConfigError({
				reason: `Failed to read agent team config at ${path}: ${String(cause)}`,
			}),
	});
}
