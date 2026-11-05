import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";

import { discoverAgentTeamConfig, type InheritSettings } from "./config.ts";
import type { AgentTeamConfigError } from "./errors.ts";
import type { AgentTeam } from "./team.ts";

// `--setting-sources` drops the user's settings.json wholesale; these UI preferences are always carried back via `--settings`.
const alwaysInherited: InheritSettings = {
	statusLine: true,
	theme: true,
	editorMode: true,
	outputStyle: true,
};

export type CacheTtl = "5m" | "1h";

/** What the user configures, as opposed to what the team needs. */
export interface TeamSettings {
	readonly inheritSettings: InheritSettings;
	readonly literalSettings: Readonly<Record<string, unknown>>;
	readonly cacheTtl: CacheTtl | undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildSettings(
	userSettings: Record<string, unknown>,
	inheritSettings: InheritSettings,
	literalSettings: Readonly<Record<string, unknown>>,
	cacheTtl: CacheTtl | undefined,
	teamPlugins: Readonly<Record<string, boolean>>,
): Record<string, unknown> {
	const inherited: Record<string, unknown> = {};
	for (const [key, spec] of Object.entries({ ...alwaysInherited, ...inheritSettings })) {
		if (!(key in userSettings)) continue;
		const value = userSettings[key];
		if (spec === true) {
			inherited[key] = value;
			continue;
		}
		if (!isObject(value)) {
			throw new Error(
				`cc.inheritSettings.${key} lists sub-keys, but the user's "${key}" is not an object.`,
			);
		}
		const picked = Object.fromEntries(
			spec.filter((sub) => sub in value).map((sub) => [sub, value[sub]]),
		);
		if (Object.keys(picked).length > 0) inherited[key] = picked;
	}
	const pluginsSources = [inherited.enabledPlugins, literalSettings.enabledPlugins];
	return {
		...inherited,
		...literalSettings,
		// `promptCacheTtl` covers the main thread, `subagentPromptCacheTtl` the subagents.
		...(cacheTtl === undefined
			? {}
			: { promptCacheTtl: cacheTtl, subagentPromptCacheTtl: cacheTtl }),
		enabledPlugins: Object.assign({}, ...pluginsSources.filter(isObject), teamPlugins),
	};
}

export function teamSettings(team: AgentTeam, settings: TeamSettings): Record<string, unknown> {
	const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
	const path = join(configDir, "settings.json");
	const userSettings: Record<string, unknown> = existsSync(path)
		? JSON.parse(readFileSync(path, "utf8"))
		: {};
	return buildSettings(
		userSettings,
		settings.inheritSettings,
		settings.literalSettings,
		settings.cacheTtl,
		team.enabledPlugins,
	);
}

export function loadTeamSettings(
	cacheTtl: CacheTtl | undefined,
): Effect.Effect<TeamSettings, AgentTeamConfigError> {
	return discoverAgentTeamConfig().pipe(
		Effect.map((config) => ({
			inheritSettings: config.cc?.inheritSettings ?? {},
			literalSettings: config.cc?.settings ?? {},
			cacheTtl,
		})),
	);
}
