import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executorLaunch } from "#/backend/launch";
import { paperBackend } from "#/backend/paper";
import { draftLaunch } from "#/draft/launch";
import { buildClaudeArgs } from "./claude-code.ts";
import type { DesignerLaunch } from "./launch.ts";

const base = {
	inheritSettings: {},
	literalSettings: {},
	cacheTtl: undefined,
	continue: false,
	resume: false,
	passthrough: [],
};

const emptyBoot = { registry: { instructionsText: "" } } as Parameters<typeof executorLaunch>[1];

const projectsRoot = mkdtempSync(join(tmpdir(), "draft-launch-test-"));
process.env.DRAFT_PROJECTS_DIR = projectsRoot;
afterAll(() => rmSync(projectsRoot, { recursive: true, force: true }));

function valueAfter(args: readonly string[], flag: string): string {
	const index = args.indexOf(flag);
	if (index === -1) throw new Error(`${flag} missing`);
	return args[index + 1] as string;
}

function agents(launch: DesignerLaunch) {
	return JSON.parse(valueAfter(buildClaudeArgs({ ...base, launch }), "--agents")) as Record<
		string,
		{ prompt: string; tools?: string[] }
	>;
}

test("draft launch adds the project dir, its MCP server, and limits only the designer's tools", () => {
	const launch = draftLaunch("demo");
	const dir = join(projectsRoot, "demo");
	const args = buildClaudeArgs({ ...base, launch });

	expect(valueAfter(args, "--add-dir")).toBe(dir);
	expect(args).not.toContain("--plugin-dir");
	expect(args).toContain("--strict-mcp-config");

	const mcp = JSON.parse(valueAfter(args, "--mcp-config")).mcpServers;
	expect(Object.keys(mcp)).toEqual(["draft"]);
	expect(mcp.draft.args.slice(-4)).toEqual(["draft", "mcp", "--dir", dir]);

	const config = agents(launch);
	expect(config.designer?.tools).toEqual([
		"Read",
		"Write",
		"Edit",
		"Glob",
		"Grep",
		"mcp__draft__render",
	]);
	expect(config.director?.tools).toBeUndefined();
	for (const agent of [config.director, config.designer]) {
		expect(agent?.prompt).toContain(
			`You design in Draft via HTML files in ${dir} rendered with mcp__draft__render.`,
		);
		expect(agent?.prompt).toContain(`Project folder (absolute): ${dir}`);
		expect(agent?.prompt).not.toContain("{{");
	}
});

test("paper launch keeps the plugin dir, executor MCP args, and unrestricted agents", () => {
	const launch = executorLaunch(paperBackend, emptyBoot);
	const args = buildClaudeArgs({ ...base, launch });

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

test("-c and -r land right before the passthrough", () => {
	const launch = executorLaunch(paperBackend, emptyBoot);
	const args = buildClaudeArgs({
		...base,
		launch,
		continue: true,
		resume: true,
		passthrough: ["abc", "--verbose"],
	});
	expect(args.slice(-4)).toEqual(["--continue", "--resume", "abc", "--verbose"]);
});

test("--cache-ttl lands in the --settings JSON", () => {
	const launch = executorLaunch(paperBackend, emptyBoot);
	const settings = JSON.parse(
		valueAfter(buildClaudeArgs({ ...base, launch, cacheTtl: "5m" }), "--settings"),
	) as Record<string, unknown>;
	expect(settings.promptCacheTtl).toBe("5m");
	expect(settings.subagentPromptCacheTtl).toBe("5m");
});
