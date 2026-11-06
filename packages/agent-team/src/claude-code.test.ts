import { expect, test } from "bun:test";

import { buildClaudeArgs } from "./claude-code.ts";
import type { TeamSettings } from "./settings.ts";
import type { AgentTeam } from "./team.ts";

const team: AgentTeam = {
	agents: { lead: { description: "Leads", model: "opus", prompt: "Lead." } },
	main: "lead",
	mcpServers: {
		tools: { type: "stdio", command: "/bin/self", args: ["tools", "mcp"], alwaysLoad: true },
	},
	pluginDirs: ["/plugins/a"],
	addDirs: ["/work"],
	enabledPlugins: {},
	env: {},
};

const settings: TeamSettings = { inheritSettings: {}, literalSettings: {}, cacheTtl: undefined };
const options = { continue: false, resume: false, passthrough: [] };

function valueAfter(args: readonly string[], flag: string): string {
	const index = args.indexOf(flag);
	if (index === -1) throw new Error(`${flag} missing`);
	return args[index + 1] as string;
}

test("passes the team through as agents, main agent, MCP servers and directories", () => {
	const args = buildClaudeArgs(team, settings, options);
	expect(valueAfter(args, "--agent")).toBe("lead");
	expect(JSON.parse(valueAfter(args, "--agents"))).toEqual(team.agents);
	expect(JSON.parse(valueAfter(args, "--mcp-config"))).toEqual({ mcpServers: team.mcpServers });
	expect(valueAfter(args, "--plugin-dir")).toBe("/plugins/a");
	expect(valueAfter(args, "--add-dir")).toBe("/work");
	expect(valueAfter(args, "--setting-sources")).toBe("project,local");
	expect(args).toContain("--strict-mcp-config");
	expect(args).toContain("--dangerously-skip-permissions");
});

test("omits --plugin-dir and --add-dir for an empty team", () => {
	const args = buildClaudeArgs({ ...team, pluginDirs: [], addDirs: [] }, settings, options);
	expect(args).not.toContain("--plugin-dir");
	expect(args).not.toContain("--add-dir");
});

test("-c and -r land right before the passthrough", () => {
	const args = buildClaudeArgs(team, settings, {
		continue: true,
		resume: true,
		passthrough: ["abc", "--verbose"],
	});
	expect(args.slice(-4)).toEqual(["--continue", "--resume", "abc", "--verbose"]);
});

test("--cache-ttl lands in the --settings JSON", () => {
	const args = buildClaudeArgs(team, { ...settings, cacheTtl: "5m" }, options);
	const parsed = JSON.parse(valueAfter(args, "--settings")) as Record<string, unknown>;
	expect(parsed.promptCacheTtl).toBe("5m");
	expect(parsed.subagentPromptCacheTtl).toBe("5m");
});

test("the team's enabled plugins reach the --settings JSON", () => {
	const args = buildClaudeArgs({ ...team, enabledPlugins: { "x@y": true } }, settings, options);
	expect(JSON.parse(valueAfter(args, "--settings")).enabledPlugins).toEqual({ "x@y": true });
});
