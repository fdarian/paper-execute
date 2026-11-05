import { Effect } from "effect";

import { type TeamSettings, teamSettings } from "./settings.ts";
import type { AgentTeam } from "./team.ts";

export interface ClaudeArgsOptions {
	readonly continue: boolean;
	readonly resume: boolean;
	readonly passthrough: readonly string[];
}

export function buildClaudeArgs(
	team: AgentTeam,
	settings: TeamSettings,
	options: ClaudeArgsOptions,
): string[] {
	return [
		"--dangerously-skip-permissions",
		"--mcp-config",
		JSON.stringify({ mcpServers: team.mcpServers }),
		// Without this, user-scope MCP servers (e.g. Brilliant's native tools) would load next to ours.
		"--strict-mcp-config",
		...team.pluginDirs.flatMap((dir) => ["--plugin-dir", dir]),
		...team.addDirs.flatMap((dir) => ["--add-dir", dir]),
		// Scopes settings files only: ancestor-directory CLAUDE.md/rules (e.g. ~/.claude/CLAUDE.md) still load, so config `cc.settings.claudeMdExcludes` has to cover them.
		"--setting-sources",
		"project,local",
		"--settings",
		JSON.stringify(teamSettings(team, settings)),
		"--agents",
		JSON.stringify(team.agents),
		"--agent",
		team.main,
		...(options.continue ? ["--continue"] : []),
		// Placed right before the passthrough so a leading positional (`designer cc -r <id>`) becomes the session id.
		...(options.resume ? ["--resume"] : []),
		...options.passthrough,
	];
}

export function runClaude(team: AgentTeam, settings: TeamSettings, options: ClaudeArgsOptions) {
	return Effect.gen(function* () {
		const claude = Bun.which("claude");
		if (claude === null) {
			return yield* Effect.fail(
				new Error("`claude` was not found on PATH; install Claude Code first."),
			);
		}
		const child = Bun.spawn([claude, ...buildClaudeArgs(team, settings, options)], {
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
			env: { ...process.env, ...team.env },
		});
		return yield* Effect.promise(() => child.exited);
	});
}
