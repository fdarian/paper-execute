#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { type CacheTtl, cacheTtlFlag, ccFlags } from "@paper-execute/agent-team";
import { defaultProjectName, projectDir } from "@paper-execute/draft-project";
import { Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import type { DesignBackend } from "#/backend";
import { brilliantBackend } from "#/backend/brilliant";
import { executorLaunch } from "#/backend/launch";
import { paperBackend } from "#/backend/paper";
import {
	type DesignerAcpOptions,
	type DesignerClaudeOptions,
	runDesignerAcp,
	runDesignerClaude,
} from "#/designer/run";
import { openProjectAtlas } from "#/draft/atlas";
import { draftLaunch } from "#/draft/launch";
import { serveDraftStdio } from "#/draft/mcp";
import { serveDraftView } from "#/draft/view";
import { serveStdio } from "#/mcp/stdio";
import pkg from "../package.json" with { type: "json" };

const mcpCommand = (backend: DesignBackend) =>
	Command.make("mcp", {}, () => serveStdio(backend)).pipe(
		Command.withDescription(`Run the ${backend.name} execute MCP server over stdio`),
	);

const launchClaude = (
	config: {
		readonly continue: boolean;
		readonly resume: boolean;
		readonly args: readonly string[];
		readonly cacheTtl: Option.Option<CacheTtl>;
	},
	buildLaunch: DesignerClaudeOptions["buildLaunch"],
) =>
	runDesignerClaude({
		buildLaunch,
		continue: config.continue,
		resume: config.resume,
		passthrough: config.args,
		cacheTtl: Option.getOrUndefined(config.cacheTtl),
	}).pipe(Effect.flatMap((exitCode) => Effect.sync(() => process.exit(exitCode))));

const ccDescription = (group: string) =>
	`Launch Claude Code with the designer agent; pass other claude args after \`--\` (designer ${group} cc -- --verbose)`;

const ccCommand = (backend: DesignBackend) =>
	Command.make("cc", { ...ccFlags, cacheTtl: cacheTtlFlag }, (config) =>
		launchClaude(config, (booted) => executorLaunch(backend, booted)),
	).pipe(Command.withDescription(ccDescription(backend.cliPath.join(" "))));

const acpDescription = "Run the designer agent as an ACP server over stdio (claude-agent-acp)";

const runAcp = (
	config: { readonly cacheTtl: Option.Option<CacheTtl> },
	buildLaunch: DesignerAcpOptions["buildLaunch"],
) =>
	runDesignerAcp({ buildLaunch, cacheTtl: Option.getOrUndefined(config.cacheTtl) }).pipe(
		Effect.flatMap(() => Effect.sync(() => process.exit(0))),
	);

const acpCommand = (backend: DesignBackend) =>
	Command.make("acp", { cacheTtl: cacheTtlFlag }, (config) =>
		runAcp(config, (booted) => executorLaunch(backend, booted)),
	).pipe(Command.withDescription(acpDescription));

const paper = Command.make("paper").pipe(
	Command.withDescription("Design in Paper"),
	Command.withSubcommands([
		mcpCommand(paperBackend),
		ccCommand(paperBackend),
		acpCommand(paperBackend),
	]),
);

const brilliant = Command.make("brilliant").pipe(
	Command.withDescription("Design in Brilliant"),
	Command.withSubcommands([
		mcpCommand(brilliantBackend),
		ccCommand(brilliantBackend),
		acpCommand(brilliantBackend),
	]),
);

const draftMcp = Command.make(
	"mcp",
	{
		dir: Flag.String("dir").pipe(Flag.withDescription("Absolute path of the project folder")),
	},
	(config) => Effect.tryPromise(() => serveDraftStdio(config.dir)),
).pipe(Command.withDescription("Run the draft render MCP server over stdio"));

const draftView = Command.make(
	"view",
	{
		project: Flag.optional(Flag.String("project")).pipe(
			Flag.withDescription("Project name (default: git repo or folder name of the cwd)"),
		),
		port: Flag.optional(Flag.Int("port")).pipe(Flag.withDescription("Port to listen on")),
	},
	(config) =>
		Effect.tryPromise(() =>
			serveDraftView(Option.getOrUndefined(config.project), Option.getOrUndefined(config.port)),
		),
).pipe(Command.withDescription("Serve a live gallery of the project's frames"));

const resolveDraftLaunch = (projectFlag: Option.Option<string>) =>
	Effect.gen(function* () {
		const name = Option.getOrElse(projectFlag, () => defaultProjectName(process.cwd()));
		const project = { project: name, dir: projectDir(name) };
		return draftLaunch(project, yield* openProjectAtlas(project));
	});

const draftCc = Command.make(
	"cc",
	{
		...ccFlags,
		cacheTtl: cacheTtlFlag,
		project: Flag.optional(Flag.String("project")).pipe(
			Flag.withDescription("Project name (default: git repo or folder name of the cwd)"),
		),
	},
	(config) =>
		resolveDraftLaunch(config.project).pipe(
			Effect.flatMap((launch) => launchClaude(config, () => launch)),
		),
).pipe(Command.withDescription(ccDescription("draft")));

const draftAcp = Command.make(
	"acp",
	{
		cacheTtl: cacheTtlFlag,
		project: Flag.optional(Flag.String("project")).pipe(
			Flag.withDescription("Project name (default: git repo or folder name of the cwd)"),
		),
	},
	(config) =>
		resolveDraftLaunch(config.project).pipe(
			Effect.flatMap((launch) => runAcp(config, () => launch)),
		),
).pipe(Command.withDescription(acpDescription));

const draft = Command.make("draft").pipe(
	Command.withDescription("Design with plain HTML files and a headless Chrome renderer"),
	Command.withSubcommands([draftMcp, draftCc, draftView, draftAcp]),
);

const designer = Command.make("designer").pipe(Command.withSubcommands([paper, brilliant, draft]));

// No top-level await: `--bytecode` compiles to CommonJS.
Command.run(designer, { version: pkg.version }).pipe(
	Effect.provide(BunServices.layer),
	BunRuntime.runMain,
);
