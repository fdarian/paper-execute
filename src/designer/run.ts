import {
	type CacheTtl,
	loadTeamSettings,
	redirectConsoleToStderr,
	runAcp,
	runClaude,
} from "@paper-execute/agent-team";
import { Effect } from "effect";

import { type BootedPlugins, bootPluginRegistry } from "#/plugin/boot";
import type { DesignerLaunch } from "./launch.ts";
import { designerTeam } from "./team.ts";

export interface DesignerClaudeOptions {
	readonly buildLaunch: (booted: BootedPlugins) => DesignerLaunch;
	readonly continue: boolean;
	readonly resume: boolean;
	readonly passthrough: readonly string[];
	readonly cacheTtl: CacheTtl | undefined;
}

export function runDesignerClaude(options: DesignerClaudeOptions) {
	return Effect.gen(function* () {
		const booted = yield* bootPluginRegistry();
		const settings = yield* loadTeamSettings(options.cacheTtl);
		return yield* runClaude(designerTeam(options.buildLaunch(booted)), settings, {
			continue: options.continue,
			resume: options.resume,
			passthrough: options.passthrough,
		});
	});
}

export interface DesignerAcpOptions {
	readonly buildLaunch: (booted: BootedPlugins) => DesignerLaunch;
	readonly cacheTtl: CacheTtl | undefined;
}

export function runDesignerAcp(options: DesignerAcpOptions) {
	return Effect.gen(function* () {
		redirectConsoleToStderr();
		const booted = yield* bootPluginRegistry();
		const settings = yield* loadTeamSettings(options.cacheTtl);
		yield* runAcp(designerTeam(options.buildLaunch(booted)), settings);
	});
}
