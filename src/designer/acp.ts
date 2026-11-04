import { runAcp } from "@agentclientprotocol/claude-agent-acp";
import { Effect } from "effect";

import { type BootedPlugins, bootPluginRegistry } from "#/plugin/boot";
import { designerAgents, designerMcpServer, designerSettings } from "./claude-code.ts";
import type { DesignerLaunch } from "./launch.ts";

type SessionOptions = NonNullable<NonNullable<Parameters<typeof runAcp>[1]>["sessionOptions"]>;

const designerModel = "opus";

export function runDesignerAcp(buildLaunch: (booted: BootedPlugins) => DesignerLaunch) {
	return Effect.gen(function* () {
		// stdout carries the JSON-RPC stream, so nothing else may write to it.
		console.log = console.error;
		console.info = console.error;
		console.warn = console.error;
		console.debug = console.error;

		if (process.env.CLAUDE_CODE_EXECUTABLE === undefined) {
			const claude = Bun.which("claude");
			if (claude === null) {
				return yield* Effect.fail(
					new Error("`claude` was not found on PATH; install Claude Code first."),
				);
			}
			process.env.CLAUDE_CODE_EXECUTABLE = claude;
		}
		// The adapter resolves the model for its `model` config option and for resume from ANTHROPIC_MODEL or on-disk settings files only,
		// never from the inline `settings` below, so without this it reports Sonnet and switches resumed sessions to it.
		// The designer subagent pins its own model, so inheriting this in the claude child doesn't affect it.
		process.env.ANTHROPIC_MODEL = designerModel;
		const booted = yield* bootPluginRegistry();

		// Computed once: the adapter calls the hook for every new/load/resume/fork and expects the same options each time.
		const launch = buildLaunch(booted);
		const agents = designerAgents(launch);
		const plugins = launch.pluginDirs.map((path) => ({ type: "local", path }) as const);
		const settings = {
			...designerSettings(
				booted.config.cc?.inheritSettings ?? {},
				booted.config.cc?.settings ?? {},
			),
			model: designerModel,
		};
		const designerServer = designerMcpServer(launch);
		const sessionOptions: SessionOptions = (provided) => ({
			...provided,
			agents,
			agent: "director",
			plugins,
			additionalDirectories: [...(provided?.additionalDirectories ?? []), ...launch.addDirs],
			// Only scopes settings files: ancestor-directory CLAUDE.md/rules still load, see `cc.settings.claudeMdExcludes`.
			settingSources: ["project", "local"],
			settings,
			mcpServers: { ...provided?.mcpServers, [launch.slug]: designerServer },
		});

		const acp = runAcp({ log: console.error, error: console.error }, { sessionOptions });
		yield* Effect.promise(() => acp.connection.closed);
		yield* Effect.promise(() => acp.agent.dispose());
	});
}
