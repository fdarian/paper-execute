import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Effect } from "effect";

import type { DesignBackend } from "#/backend";
import { paperBackend } from "#/backend/paper";
import { buildServerInstructions } from "#/mcp/instructions";
import { bootPluginRegistry } from "#/plugin/boot";
import type { InheritSettings } from "#/plugin/config";
import { readDesignerAssets } from "./assets.ts" with { type: "macro" };
import { buildSettings } from "./settings.ts";

const assets = readDesignerAssets();

function materializePluginDir(): string {
	const hash = Bun.hash(JSON.stringify(assets.pluginFiles)).toString(36);
	const root = join(tmpdir(), "designer");
	const target = join(root, `paper-refs-${hash}`);
	if (existsSync(target)) return target;

	mkdirSync(root, { recursive: true });
	const staging = join(root, `.staging-${process.pid}-${Date.now()}`);
	try {
		for (const [path, content] of Object.entries(assets.pluginFiles)) {
			const file = join(staging, path);
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, content);
		}
		try {
			renameSync(staging, target);
		} catch (cause) {
			// A concurrent launcher may have won the rename; its copy is identical.
			if (!existsSync(target)) throw cause;
		}
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}
	return target;
}

function mcpConfig(backend: DesignBackend): string {
	const compiled = Bun.main.startsWith("/$bunfs/");
	const args = [...backend.cliPath, "mcp"];
	return JSON.stringify({
		mcpServers: {
			[backend.slug]: {
				type: "stdio",
				command: process.execPath,
				args: compiled ? args : [Bun.main, ...args],
				alwaysLoad: true,
			},
		},
	});
}

// Agent prompts replace the system prompt and subagents don't receive MCP server instructions,
// so both agents carry the server instructions themselves.
function agentsConfig(backend: DesignBackend, serverInstructions: string): string {
	const fill = (template: string) =>
		template.replaceAll("{{name}}", backend.name).replaceAll("{{slug}}", backend.slug);
	return JSON.stringify({
		director: {
			description: `Directs design work in ${backend.name} through the designer subagent.`,
			model: "opus",
			prompt: `${fill(assets.agentPrompt)}\n\n${fill(assets.directorPrompt)}\n\n${serverInstructions}`,
		},
		designer: {
			description: `Executes a design brief in ${backend.name} and reports back with a screenshot path.`,
			model: "haiku",
			prompt: `${fill(assets.agentPrompt)}\n\n${fill(assets.designerPrompt)}\n\n${serverInstructions}`,
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

export interface DesignerClaudeOptions {
	readonly backend: DesignBackend;
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
		const agents = agentsConfig(
			options.backend,
			buildServerInstructions(booted.registry.instructionsText, options.backend),
		);
		const child = Bun.spawn(
			[
				claude,
				"--dangerously-skip-permissions",
				"--mcp-config",
				mcpConfig(options.backend),
				// Without this, user-scope MCP servers (e.g. Brilliant's native tools) would load next to ours.
				"--strict-mcp-config",
				...(options.backend === paperBackend ? ["--plugin-dir", materializePluginDir()] : []),
				// Scopes settings files only: ancestor-directory CLAUDE.md/rules (e.g. ~/.claude/CLAUDE.md) still load, so config `cc.settings.claudeMdExcludes` has to cover them.
				"--setting-sources",
				"project,local",
				...settingsArgs(booted.config.cc?.inheritSettings ?? {}, booted.config.cc?.settings ?? {}),
				"--agents",
				agents,
				"--agent",
				"director",
				...(options.continue ? ["--continue"] : []),
				// Placed right before the passthrough so a leading positional (`designer cc -r <id>`) becomes the session id.
				...(options.resume ? ["--resume"] : []),
				...options.passthrough,
			],
			{ stdin: "inherit", stdout: "inherit", stderr: "inherit" },
		);
		return yield* Effect.promise(() => child.exited);
	});
}
