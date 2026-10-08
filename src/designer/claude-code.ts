import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Effect } from "effect";

import { buildServerInstructions } from "#/mcp/instructions";
import { bootPluginRegistry } from "#/plugin/boot";
import { readDesignerAssets } from "./assets.ts" with { type: "macro" };

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

function mcpConfig(): string {
	const compiled = Bun.main.startsWith("/$bunfs/");
	return JSON.stringify({
		mcpServers: {
			paper: {
				type: "stdio",
				command: process.execPath,
				args: compiled ? ["mcp"] : [Bun.main, "mcp"],
				alwaysLoad: true,
			},
		},
	});
}

// Agent prompts replace the system prompt and subagents don't receive MCP server instructions,
// so both agents carry the server instructions themselves.
function agentsConfig(serverInstructions: string): string {
	return JSON.stringify({
		director: {
			description: "Directs design work in Paper through the designer subagent.",
			model: "opus",
			prompt: `${assets.agentPrompt}\n\n${assets.directorPrompt}\n\n${serverInstructions}`,
		},
		designer: {
			description: "Executes a design brief in Paper and reports back with a screenshot path.",
			model: "haiku",
			prompt: `${assets.agentPrompt}\n\n${assets.designerPrompt}\n\n${serverInstructions}`,
		},
	});
}

export function runDesignerClaude(passthrough: readonly string[]) {
	return Effect.gen(function* () {
		const claude = Bun.which("claude");
		if (claude === null) {
			return yield* Effect.fail(
				new Error("`claude` was not found on PATH; install Claude Code first."),
			);
		}
		const booted = yield* bootPluginRegistry();
		const agents = agentsConfig(buildServerInstructions(booted.registry.instructionsText));
		const child = Bun.spawn(
			[
				claude,
				"--dangerously-skip-permissions",
				"--mcp-config",
				mcpConfig(),
				"--plugin-dir",
				materializePluginDir(),
				// Skips the user's global CLAUDE.md, hooks, and settings so their orchestration rules don't leak in.
				"--setting-sources",
				"project,local",
				"--agents",
				agents,
				"--agent",
				"director",
				...passthrough,
			],
			{ stdin: "inherit", stdout: "inherit", stderr: "inherit" },
		);
		return yield* Effect.promise(() => child.exited);
	});
}
