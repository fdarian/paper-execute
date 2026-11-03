import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";

import { type BootedPlugins, bootPluginRegistry } from "#/plugin/boot";
import type { InheritSettings } from "#/plugin/config";
import { designerAssets } from "./embedded.ts";
import type { DesignerLaunch } from "./launch.ts";
import { buildSettings } from "./settings.ts";

function mcpConfig(launch: DesignerLaunch): string {
	const compiled = Bun.main.startsWith("/$bunfs/");
	return JSON.stringify({
		mcpServers: {
			[launch.slug]: {
				type: "stdio",
				command: process.execPath,
				args: compiled ? [...launch.mcpArgs] : [Bun.main, ...launch.mcpArgs],
				alwaysLoad: true,
			},
		},
	});
}

// Agent prompts replace the system prompt and subagents don't receive MCP server instructions,
// so both agents carry the server instructions themselves.
function agentsConfig(launch: DesignerLaunch): string {
	const fill = (template: string) =>
		template
			.replaceAll("{{name}}", launch.name)
			.replaceAll("{{slug}}", launch.slug)
			.replaceAll("{{tools}}", launch.tools);
	return JSON.stringify({
		director: {
			description: `Directs design work in ${launch.name} through the designer subagent.`,
			model: "opus",
			prompt: `${fill(designerAssets.agentPrompt)}\n\n${fill(designerAssets.directorPrompt)}\n\n${launch.instructions}`,
		},
		designer: {
			description: `Executes a design brief in ${launch.name} and reports back with a screenshot path.`,
			model: "haiku",
			prompt: `${fill(designerAssets.agentPrompt)}\n\n${fill(designerAssets.designerPrompt)}\n\n${launch.instructions}`,
			...(launch.designerTools === undefined ? {} : { tools: launch.designerTools }),
		},
	});
}

function settingsArgs(
	inheritSettings: InheritSettings,
	literalSettings: Record<string, unknown>,
): string[] {
	const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
	const path = join(configDir, "settings.json");
	const userSettings: Record<string, unknown> = existsSync(path)
		? JSON.parse(readFileSync(path, "utf8"))
		: {};
	return [
		"--settings",
		JSON.stringify(buildSettings(userSettings, inheritSettings, literalSettings)),
	];
}

export interface ClaudeArgsOptions {
	readonly launch: DesignerLaunch;
	readonly inheritSettings: InheritSettings;
	readonly literalSettings: Record<string, unknown>;
	readonly continue: boolean;
	readonly resume: boolean;
	readonly passthrough: readonly string[];
}

export function buildClaudeArgs(options: ClaudeArgsOptions): string[] {
	return [
		"--dangerously-skip-permissions",
		"--mcp-config",
		mcpConfig(options.launch),
		// Without this, user-scope MCP servers (e.g. Brilliant's native tools) would load next to ours.
		"--strict-mcp-config",
		...options.launch.pluginDirs.flatMap((dir) => ["--plugin-dir", dir]),
		...options.launch.addDirs.flatMap((dir) => ["--add-dir", dir]),
		// Scopes settings files only: ancestor-directory CLAUDE.md/rules (e.g. ~/.claude/CLAUDE.md) still load, so config `cc.settings.claudeMdExcludes` has to cover them.
		"--setting-sources",
		"project,local",
		...settingsArgs(options.inheritSettings, options.literalSettings),
		"--agents",
		agentsConfig(options.launch),
		"--agent",
		"director",
		...(options.continue ? ["--continue"] : []),
		// Placed right before the passthrough so a leading positional (`designer cc -r <id>`) becomes the session id.
		...(options.resume ? ["--resume"] : []),
		...options.passthrough,
	];
}

export interface DesignerClaudeOptions {
	readonly buildLaunch: (booted: BootedPlugins) => DesignerLaunch;
	readonly continue: boolean;
	readonly resume: boolean;
	readonly passthrough: readonly string[];
}

export function runDesignerClaude(options: DesignerClaudeOptions) {
	return Effect.gen(function* () {
		const claude = Bun.which("claude");
		if (claude === null) {
			return yield* Effect.fail(
				new Error("`claude` was not found on PATH; install Claude Code first."),
			);
		}
		const booted = yield* bootPluginRegistry();
		const args = buildClaudeArgs({
			launch: options.buildLaunch(booted),
			inheritSettings: booted.config.cc?.inheritSettings ?? {},
			literalSettings: booted.config.cc?.settings ?? {},
			continue: options.continue,
			resume: options.resume,
			passthrough: options.passthrough,
		});
		const child = Bun.spawn([claude, ...args], {
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		});
		return yield* Effect.promise(() => child.exited);
	});
}
