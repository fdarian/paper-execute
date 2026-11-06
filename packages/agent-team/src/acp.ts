import { runAcp as runClaudeAgentAcp } from "@agentclientprotocol/claude-agent-acp";
import { Effect } from "effect";

import { type TeamSettings, teamSettings } from "./settings.ts";
import { type AgentTeam, mainAgent } from "./team.ts";

type SessionOptions = NonNullable<
	NonNullable<Parameters<typeof runClaudeAgentAcp>[1]>["sessionOptions"]
>;

/** stdout carries the JSON-RPC stream, so nothing else may write to it; call before anything that might log. */
export function redirectConsoleToStderr() {
	console.log = console.error;
	console.info = console.error;
	console.warn = console.error;
	console.debug = console.error;
}

export function runAcp(team: AgentTeam, settings: TeamSettings) {
	return Effect.gen(function* () {
		if (process.env.CLAUDE_CODE_EXECUTABLE === undefined) {
			const claude = Bun.which("claude");
			if (claude === null) {
				return yield* Effect.fail(
					new Error("`claude` was not found on PATH; install Claude Code first."),
				);
			}
			process.env.CLAUDE_CODE_EXECUTABLE = claude;
		}
		Object.assign(process.env, team.env);
		const model = mainAgent(team).model;
		// The adapter resolves the model for its `model` config option and for resume from ANTHROPIC_MODEL or on-disk settings files only,
		// never from the inline `settings` below, so without this it reports Sonnet and switches resumed sessions to it.
		// Subagents pin their own model, so inheriting this in the claude child doesn't affect them.
		process.env.ANTHROPIC_MODEL = model;

		// Computed once: the adapter calls the hook for every new/load/resume/fork and expects the same options each time.
		const plugins = team.pluginDirs.map((path) => ({ type: "local", path }) as const);
		const sessionSettings = { ...teamSettings(team, settings), model };
		const sessionOptions: SessionOptions = (provided) => ({
			...provided,
			agents: team.agents,
			agent: team.main,
			plugins,
			additionalDirectories: [...(provided?.additionalDirectories ?? []), ...team.addDirs],
			// Only scopes settings files: ancestor-directory CLAUDE.md/rules still load, see `cc.settings.claudeMdExcludes`.
			settingSources: ["project", "local"],
			settings: sessionSettings,
			mcpServers: { ...provided?.mcpServers, ...team.mcpServers },
		});

		const acp = runClaudeAgentAcp({ log: console.error, error: console.error }, { sessionOptions });
		yield* Effect.promise(() => acp.connection.closed);
		yield* Effect.promise(() => acp.agent.dispose());
	});
}
