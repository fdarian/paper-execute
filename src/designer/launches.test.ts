import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildClaudeArgs } from "@paper-execute/agent-team";
import { Effect } from "effect";
import { brilliantBackend } from "#/backend/brilliant";
import { executorLaunch } from "#/backend/launch";
import { paperBackend } from "#/backend/paper";
import { draftLaunch } from "#/draft/launch";
import type { BootedPlugins } from "#/plugin/boot";
import type { DesignerLaunch } from "./launch.ts";
import { designerTeam } from "./team.ts";

// Pins the full claude argv and ACP session options of every launch, so the launcher can move between packages untouched.

const sandbox = mkdtempSync(join(tmpdir(), "designer-launches-"));
const draftRoot = join(sandbox, "draft");
const claudeConfigDir = join(sandbox, "claude");
const previousCwd = process.cwd();
const previousEnv = {
	DRAFT_DATA_DIR: process.env.DRAFT_DATA_DIR,
	CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
	CLAUDE_CODE_EXECUTABLE: process.env.CLAUDE_CODE_EXECUTABLE,
	ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
};

beforeAll(() => {
	mkdirSync(claudeConfigDir, { recursive: true });
	mkdirSync(sandbox, { recursive: true });
	writeFileSync(
		join(claudeConfigDir, "settings.json"),
		JSON.stringify({
			theme: "dark",
			editorMode: "vim",
			model: "sonnet",
			extraKnownMarketplaces: { dotfiles: { source: "x" }, other: { source: "y" } },
			enabledPlugins: { "skill-mention@dotfiles": true, "unlisted@x": true },
		}),
	);
	writeFileSync(
		join(sandbox, "paper-execute.config.json"),
		JSON.stringify({
			plugins: [],
			cc: {
				inheritSettings: {
					extraKnownMarketplaces: ["dotfiles"],
					enabledPlugins: ["skill-mention@dotfiles"],
				},
				settings: { claudeMdExcludes: ["/x/**"] },
			},
		}),
	);
	process.env.DRAFT_DATA_DIR = draftRoot;
	process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;
	// The local config wins over ~/.config, so the real user config can't leak in.
	process.chdir(sandbox);
	process.env.CLAUDE_CODE_EXECUTABLE = "/fake/claude";
});

afterAll(() => {
	process.chdir(previousCwd);
	for (const [key, value] of Object.entries(previousEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(sandbox, { recursive: true, force: true });
});

const emptyBoot = { registry: { instructionsText: "" } } as unknown as BootedPlugins;

const launches: Record<string, (booted: BootedPlugins) => DesignerLaunch> = {
	"paper cc": (booted) => executorLaunch(paperBackend, booted),
	"brilliant cc": (booted) => executorLaunch(brilliantBackend, booted),
	"draft cc": () => draftLaunch("demo"),
};

function promptDigest(prompt: string) {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(prompt);
	return `sha256:${hasher.digest("hex").slice(0, 16)} length:${prompt.length}`;
}

function normalizeString(value: string): string {
	return value
		.replaceAll(draftRoot, "<draft-root>")
		.replaceAll(claudeConfigDir, "<claude-config>")
		.replaceAll(process.execPath, "<exec>")
		.replaceAll(Bun.main, "<main>")
		.replace(/\S*?(paper-refs-[0-9a-z]+)/g, "<tmp>/$1");
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

function normalizeArgs(args: readonly string[]) {
	const jsonFlags = ["--mcp-config", "--settings", "--agents"];
	return args.map((arg, index) =>
		jsonFlags.includes(args[index - 1] ?? "") ? normalize(JSON.parse(arg)) : normalizeString(arg),
	);
}

const claudeInputs = {
	inheritSettings: {
		extraKnownMarketplaces: ["dotfiles"],
		enabledPlugins: ["skill-mention@dotfiles"],
	},
	literalSettings: { claudeMdExcludes: ["/x/**"] },
	cacheTtl: "5m",
} as const;

const claudeOptions = { continue: true, resume: true, passthrough: ["abc", "--verbose"] };

let capturedSessionOptions: unknown;
// The adapter is a dependency of agent-team only, so it has to be resolved from there for the mock to match.
const acpAdapter = Bun.resolveSync(
	"@agentclientprotocol/claude-agent-acp",
	join(import.meta.dir, "../../packages/agent-team"),
);
mock.module(acpAdapter, () => ({
	runAcp: (_logger: unknown, options: { sessionOptions: unknown }) => {
		capturedSessionOptions = options.sessionOptions;
		return { connection: { closed: Promise.resolve() }, agent: { dispose: async () => {} } };
	},
}));

async function acpSessionOptions(name: string) {
	const { runDesignerAcp } = await import("./run.ts");
	const savedConsole = { ...console };
	try {
		await Effect.runPromise(
			runDesignerAcp({ buildLaunch: launches[name] as never, cacheTtl: "1h" }),
		);
	} finally {
		Object.assign(console, savedConsole);
	}
	const sessionOptions = capturedSessionOptions as (provided: unknown) => unknown;
	return {
		model: process.env.ANTHROPIC_MODEL,
		fresh: normalize(sessionOptions(undefined)),
		provided: normalize(
			sessionOptions({
				additionalDirectories: ["/extra"],
				mcpServers: { other: { type: "http" } },
			}),
		),
	};
}

for (const name of Object.keys(launches)) {
	test(`${name}: claude argv`, () => {
		const launch = (launches[name] as (booted: BootedPlugins) => DesignerLaunch)(emptyBoot);
		expect(
			normalizeArgs(buildClaudeArgs(designerTeam(launch), claudeInputs, claudeOptions)),
		).toMatchSnapshot();
	});

	test(`${name}: ACP session options`, async () => {
		expect(await acpSessionOptions(name)).toMatchSnapshot();
	});
}
