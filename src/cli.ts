#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { runDesignerClaude } from "#/designer/claude-code";
import { serveStdio } from "#/mcp/stdio";
import pkg from "../package.json" with { type: "json" };

const mcp = Command.make("mcp", {}, () => serveStdio).pipe(
	Command.withDescription("Run the Paper execute MCP server over stdio"),
);

// Effect CLI rejects unknown flags, so claude's own flags (other than -c / -r) must follow `--`.
// Effect CLI has no optional-value flags, so `-r` is boolean and its session id arrives as the first positional.
const cc = Command.make(
	"cc",
	{
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
	},
	(config) =>
		runDesignerClaude({
			continue: config.continue,
			resume: config.resume,
			passthrough: config.args,
		}).pipe(Effect.flatMap((exitCode) => Effect.sync(() => process.exit(exitCode)))),
).pipe(
	Command.withDescription(
		"Launch Claude Code with the designer agent; pass other claude args after `--` (designer cc -- --verbose)",
	),
);

const designer = Command.make("designer").pipe(Command.withSubcommands([mcp, cc]));

// No top-level await: `--bytecode` compiles to CommonJS.
Command.run(designer, { version: pkg.version }).pipe(
	Effect.provide(BunServices.layer),
	BunRuntime.runMain,
);
