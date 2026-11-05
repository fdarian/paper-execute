import {
	type CacheTtl,
	loadTeamSettings,
	redirectConsoleToStderr,
	runAcp,
	runClaude,
} from "@paper-execute/agent-team";
import { Effect } from "effect";

import { type CartographerInputs, cartographerTeam } from "./team.ts";

export interface CartographerClaudeOptions {
	readonly inputs: CartographerInputs;
	readonly continue: boolean;
	readonly resume: boolean;
	readonly passthrough: readonly string[];
	readonly cacheTtl: CacheTtl | undefined;
}

export function runCartographerClaude(options: CartographerClaudeOptions) {
	return Effect.gen(function* () {
		const settings = yield* loadTeamSettings(options.cacheTtl);
		return yield* runClaude(cartographerTeam(options.inputs), settings, {
			continue: options.continue,
			resume: options.resume,
			passthrough: options.passthrough,
		});
	});
}

export interface CartographerAcpOptions {
	readonly inputs: CartographerInputs;
	readonly cacheTtl: CacheTtl | undefined;
}

export function runCartographerAcp(options: CartographerAcpOptions) {
	return Effect.gen(function* () {
		redirectConsoleToStderr();
		const settings = yield* loadTeamSettings(options.cacheTtl);
		yield* runAcp(cartographerTeam(options.inputs), settings);
	});
}
