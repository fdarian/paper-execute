import { expect, test } from "bun:test";
import { buildClaudeArgs } from "@paper-execute/agent-team";

import { executorLaunch } from "#/backend/launch";
import { paperBackend } from "#/backend/paper";
import type { DesignerLaunch } from "./launch.ts";
import { designerTeam } from "./team.ts";

const settings = { inheritSettings: {}, literalSettings: {}, cacheTtl: undefined };
const options = { continue: false, resume: false, passthrough: [] };

function claudeArgs(launch: DesignerLaunch) {
	return buildClaudeArgs(designerTeam(launch), settings, options);
}

const emptyBoot = { registry: { instructionsText: "" } } as Parameters<typeof executorLaunch>[1];

function valueAfter(args: readonly string[], flag: string): string {
	const index = args.indexOf(flag);
	if (index === -1) throw new Error(`${flag} missing`);
	return args[index + 1] as string;
}

function agents(launch: DesignerLaunch) {
	return JSON.parse(valueAfter(claudeArgs(launch), "--agents")) as Record<
		string,
		{ prompt: string; tools?: string[] }
	>;
}

test("paper launch keeps the plugin dir, executor MCP args, and unrestricted agents", () => {
	const launch = executorLaunch(paperBackend, emptyBoot);
	const args = claudeArgs(launch);

	expect(valueAfter(args, "--plugin-dir")).toContain("paper-refs-");
	expect(args).not.toContain("--add-dir");
	expect(JSON.parse(valueAfter(args, "--mcp-config")).mcpServers.paper.args.slice(-2)).toEqual([
		"paper",
		"mcp",
	]);

	const config = agents(launch);
	expect(config.designer?.tools).toBeUndefined();
	expect(config.designer?.prompt).toContain("You design in Paper via mcp__paper__execute.");
	expect(config.designer?.prompt).not.toContain("{{");
});

test("a launch agent that collides with a built-in agent throws", () => {
	const launch = executorLaunch(paperBackend, emptyBoot);

	expect(() =>
		designerTeam({
			...launch,
			agents: { designer: { description: "x", model: "sonnet", prompt: "x" } },
		}),
	).toThrow('Launch agent "designer" collides');
});
