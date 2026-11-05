import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildClaudeArgs, selfCommand } from "@paper-execute/agent-team";
import { dataDir, projectLayout } from "@paper-execute/draft-project";

import { cartographerSubagent, cartographerTeam } from "./team.ts";

const sandbox = realpathSync(mkdtempSync(join(tmpdir(), "cartographer-team-")));
const dataRoot = join(sandbox, "data");
const repo = join(sandbox, "repo");
const dir = join(dataRoot, "projects", "demo");
const claudeConfigDir = join(sandbox, "claude");
const previousEnv = {
	DRAFT_DATA_DIR: process.env.DRAFT_DATA_DIR,
	CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
};
const previousExecPath = process.execPath;

beforeAll(() => {
	mkdirSync(claudeConfigDir, { recursive: true });
	writeFileSync(
		join(claudeConfigDir, "settings.json"),
		JSON.stringify({ theme: "dark", editorMode: "vim" }),
	);
	process.env.DRAFT_DATA_DIR = dataRoot;
	process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;
});

afterAll(() => {
	for (const [key, value] of Object.entries(previousEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	process.execPath = previousExecPath;
	rmSync(sandbox, { recursive: true, force: true });
});

const inputs = { project: "demo", dir, repo, atlas: selfCommand(["atlas", "--project", "demo"]) };

function prompts(team: ReturnType<typeof cartographerTeam>) {
	return Object.values(team.agents).map((agent) => agent.prompt);
}

function skillFiles(pluginDir: string) {
	return ["seed", "refresh", "correct"].map((name) =>
		readFileSync(join(pluginDir, "skills", name, "SKILL.md"), "utf8"),
	);
}

test("defines the cartographer on sonnet and a context-capped surveyor on haiku", () => {
	const team = cartographerTeam(inputs);

	expect(team.main).toBe("cartographer");
	expect(Object.keys(team.agents)).toEqual(["cartographer", "surveyor"]);
	expect(team.agents.cartographer?.model).toBe("sonnet");
	expect(team.agents.cartographer?.tools).toEqual([
		"Bash",
		"Read",
		"Grep",
		"Glob",
		"Write",
		"Agent",
		"Skill",
	]);
	expect(team.agents.cartographer?.autoCompactWindow).toBeUndefined();
	expect(team.agents.surveyor?.model).toBe("haiku");
	expect(team.agents.surveyor?.tools).toEqual(["Bash", "Read", "Grep", "Glob"]);
	expect(team.agents.surveyor?.autoCompactWindow).toBe(100_000);
	expect(team.mcpServers).toEqual({});
	expect(team.enabledPlugins).toEqual({});
});

test("grants the project dir and the repo, and pins the data dir for agents that cd", () => {
	const team = cartographerTeam(inputs);

	expect(team.addDirs).toEqual([dir, repo]);
	expect(team.env).toEqual({ DRAFT_DATA_DIR: dataDir() });
	expect(team.env.DRAFT_DATA_DIR).toBe(dataRoot);
});

test("fills every placeholder in the prompts and the materialized skills", () => {
	const team = cartographerTeam(inputs);
	const atlas = selfCommand(["atlas", "--project", "demo"]).join(" ");
	const tokens = projectLayout(dir).tokens;
	const [pluginDir] = team.pluginDirs;
	if (pluginDir === undefined) throw new Error("no plugin dir");

	const texts = [...prompts(team), ...skillFiles(pluginDir)];
	for (const text of texts) expect(text).not.toMatch(/\{\{[^}]*\}\}/);
	for (const prompt of prompts(team)) {
		expect(prompt).toContain(`\`${atlas} <command>\``);
		expect(prompt).toContain(
			`The atlas is the product map for \`demo\`, whose code is in \`${repo}\``,
		);
	}
	expect(team.agents.cartographer?.prompt).toContain(`Write \`${tokens}\``);
	expect(skillFiles(pluginDir)[0]).toContain(`${atlas} list`);
	expect(skillFiles(pluginDir)[0]).toContain(`git -C ${repo} ls-tree -r --name-only main`);
	expect(skillFiles(pluginDir)[0]).toContain(`write \`${tokens}\``);
	expect(readFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), "utf8")).toContain(
		'"cartographer"',
	);
	expect(team.agents.surveyor?.prompt).toContain(`git -C ${repo} log main --format=%s -n 150`);
});

test("the on-call subagent fills every placeholder and uses the given atlas command", () => {
	const agent = cartographerSubagent({
		...inputs,
		atlas: ["/opt/draft bin/draft", "atlas", "--project", "demo"],
	});

	expect(agent.model).toBe("sonnet");
	expect(agent.tools).toEqual(["Bash", "Read", "Grep", "Glob"]);
	expect(agent.prompt).not.toMatch(/\{\{[^}]*\}\}/);
	expect(agent.prompt).toContain("`'/opt/draft bin/draft' atlas --project demo <command>`");
	expect(agent.prompt).toContain(
		"`'/opt/draft bin/draft' atlas --project demo feature set <name> --verified`",
	);
	expect(agent.prompt).toContain(`whose code is in \`${repo}\``);
	expect(agent.prompt).toContain(
		"You are the cartographer, on call in a design session for `demo`.",
	);
});

test("shell-quotes the atlas command per argument when a path or the project has a space", () => {
	process.execPath = "/tmp/with space/bun";
	const team = cartographerTeam({
		...inputs,
		project: "my project",
		atlas: selfCommand(["atlas", "--project", "my project"]),
	});
	const prompt = team.agents.cartographer?.prompt ?? "";

	const compiled = Bun.main.startsWith("/$bunfs/");
	const entry = compiled ? "" : ` ${Bun.main}`;
	expect(prompt).toContain(`'/tmp/with space/bun'${entry} atlas --project 'my project' <command>`);
	process.execPath = previousExecPath;
});

test("escapes single quotes inside a quoted argument", () => {
	const team = cartographerTeam({
		...inputs,
		project: "it's",
		atlas: selfCommand(["atlas", "--project", "it's"]),
	});

	expect(team.agents.cartographer?.prompt).toContain(`--project 'it'\\''s' <command>`);
});

function normalizeString(value: string): string {
	return value
		.replaceAll(dataRoot, "<draft-root>")
		.replaceAll(repo, "<repo>")
		.replaceAll(process.execPath, "<exec>")
		.replaceAll(Bun.main, "<main>")
		.replace(/\S*?cartographer-demo-[0-9a-z]+/g, "<tmp>/cartographer-demo-<hash>");
}

function promptDigest(prompt: string) {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(prompt);
	return `sha256:${hasher.digest("hex").slice(0, 16)} length:${prompt.length}`;
}

function normalize(value: unknown, key?: string): unknown {
	if (typeof value === "string") {
		return key === "prompt" ? promptDigest(normalizeString(value)) : normalizeString(value);
	}
	if (Array.isArray(value)) return value.map((item) => normalize(item));
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(
			Object.entries(value).map(([name, item]) => [name, normalize(item, name)]),
		);
	}
	return value;
}

test("claude argv", () => {
	const settings = {
		inheritSettings: { enabledPlugins: ["skill-mention@dotfiles"] },
		literalSettings: { claudeMdExcludes: ["/x/**"] },
		cacheTtl: "5m",
	} as const;
	const args = buildClaudeArgs(cartographerTeam(inputs), settings, {
		continue: true,
		resume: true,
		passthrough: ["abc", "--verbose"],
	});
	const jsonFlags = ["--mcp-config", "--settings", "--agents"];
	const normalized = args.map((arg, index) =>
		jsonFlags.includes(args[index - 1] ?? "") ? normalize(JSON.parse(arg)) : normalizeString(arg),
	);

	expect(normalized).toMatchSnapshot();
});
