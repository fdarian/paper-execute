import {
	type CacheTtl,
	loadTeamSettings,
	redirectConsoleToStderr,
	runAcp,
	runClaude,
	selfCommand,
} from "@paper-execute/agent-team";
import { type CartographerInputs, cartographerTeam } from "@paper-execute/draft-cartographer";
import { Effect } from "effect";

import type { OpenedAtlas } from "../run.ts";

function cartographerInputs(opened: OpenedAtlas): CartographerInputs {
	return { ...opened, atlas: selfCommand(["atlas", "--project", opened.project]) };
}

export interface CartographerClaudeOptions {
	readonly inputs: OpenedAtlas;
	readonly continue: boolean;
	readonly resume: boolean;
	readonly passthrough: readonly string[];
	readonly cacheTtl: CacheTtl | undefined;
}

export function runCartographerClaude(options: CartographerClaudeOptions) {
	return Effect.gen(function* () {
		const settings = yield* loadTeamSettings(options.cacheTtl);
		return yield* runClaude(cartographerTeam(cartographerInputs(options.inputs)), settings, {
			continue: options.continue,
			resume: options.resume,
			passthrough: options.passthrough,
		});
	});
}

export interface CartographerAcpOptions {
	readonly inputs: OpenedAtlas;
	readonly cacheTtl: CacheTtl | undefined;
}

export function runCartographerAcp(options: CartographerAcpOptions) {
	return Effect.gen(function* () {
		redirectConsoleToStderr();
		const settings = yield* loadTeamSettings(options.cacheTtl);
		yield* runAcp(cartographerTeam(cartographerInputs(options.inputs)), settings);
	});
}
