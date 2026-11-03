#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import type { DesignBackend } from "#/backend";
import { brilliantBackend } from "#/backend/brilliant";
import { executorLaunch } from "#/backend/launch";
import { paperBackend } from "#/backend/paper";
import { runDesignerAcp } from "#/designer/acp";
import { type DesignerClaudeOptions, runDesignerClaude } from "#/designer/claude-code";
import { draftLaunch } from "#/draft/launch";
import { serveDraftStdio } from "#/draft/mcp";
import { serveDraftView } from "#/draft/view";
import { serveStdio } from "#/mcp/stdio";
import pkg from "../package.json" with { type: "json" };

const mcpCommand = (backend: DesignBackend) =>
	Command.make("mcp", {}, () => serveStdio(backend)).pipe(
		Command.withDescription(`Run the ${backend.name} execute MCP server over stdio`),
	);

// Effect CLI rejects unknown flags, so claude's own flags (other than -c / -r) must follow `--`.
// Effect CLI has no optional-value flags, so `-r` is boolean and its session id arrives as the first positional.
const ccFlags = {
	continue: Flag.Boolean("continue").pipe(
		Flag.withAlias("c"),
		Flag.withDefault(false),
		Flag.withDescription("Continue the most recent conversation"),
	),
	resume: Flag.Boolean("resume").pipe(
		Flag.withAlias("r"),
		Flag.withDefault(false),
		Flag.withDescription("Resume a conversation: `-r <id>`, or `-r` alone for the picker"),
	),
	args: Argument.String("args").pipe(Argument.variadic()),
};

const launchClaude = (
	config: {
		readonly continue: boolean;
		readonly resume: boolean;
		readonly args: readonly string[];
	},
	buildLaunch: DesignerClaudeOptions["buildLaunch"],
) =>
	runDesignerClaude({
		buildLaunch,
		continue: config.continue,
		resume: config.resume,
		passthrough: config.args,
	}).pipe(Effect.flatMap((exitCode) => Effect.sync(() => process.exit(exitCode))));

const ccDescription =
	"Launch Claude Code with the designer agent; pass other claude args after `--` (designer cc -- --verbose)";

const ccCommand = (backend: DesignBackend) =>
	Command.make("cc", ccFlags, (config) =>
		launchClaude(config, (booted) => executorLaunch(backend, booted)),
	).pipe(Command.withDescription(ccDescription));

const brilliant = Command.make("brilliant").pipe(
	Command.withDescription("Run against Brilliant instead of Paper"),
	Command.withSubcommands([mcpCommand(brilliantBackend), ccCommand(brilliantBackend)]),
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

const draftCc = Command.make(
	"cc",
	{
		...ccFlags,
		project: Flag.optional(Flag.String("project")).pipe(
			Flag.withDescription("Project name (default: git repo or folder name of the cwd)"),
		),
	},
	(config) => launchClaude(config, () => draftLaunch(Option.getOrUndefined(config.project))),
).pipe(Command.withDescription(ccDescription));

const draft = Command.make("draft").pipe(
	Command.withDescription("Design with plain HTML files and a headless Chrome renderer"),
	Command.withSubcommands([draftMcp, draftCc, draftView]),
);

const acp = Command.make("acp", {}, () =>
	runDesignerAcp().pipe(Effect.flatMap(() => Effect.sync(() => process.exit(0)))),
).pipe(
	Command.withDescription("Run the designer agent as an ACP server over stdio (claude-agent-acp)"),
);

const designer = Command.make("designer").pipe(
	Command.withSubcommands([
		mcpCommand(paperBackend),
		ccCommand(paperBackend),
		acp,
		brilliant,
		draft,
	]),
);

// No top-level await: `--bytecode` compiles to CommonJS.
Command.run(designer, { version: pkg.version }).pipe(
	Effect.provide(BunServices.layer),
	BunRuntime.runMain,
);
