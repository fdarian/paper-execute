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

// Claude Code subagents don't receive MCP server instructions, so they are appended to the prompt.
function agentsConfig(serverInstructions: string): string {
	return JSON.stringify({
		designer: { description: ".", prompt: `${assets.agentPrompt}\n\n${serverInstructions}` },
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
				"--model",
				"opus",
				"--dangerously-skip-permissions",
				"--mcp-config",
				mcpConfig(),
				"--plugin-dir",
				materializePluginDir(),
				"--agents",
				agents,
				"--agent",
				"designer",
				...passthrough,
			],
			{ stdin: "inherit", stdout: "inherit", stderr: "inherit" },
		);
		return yield* Effect.promise(() => child.exited);
	});
}
