#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";
import { runDesignerClaude } from "#/designer/claude-code";
import { serveStdio } from "#/mcp/stdio";
import pkg from "../package.json" with { type: "json" };

const mcp = Command.make("mcp", {}, () => serveStdio).pipe(
	Command.withDescription("Run the Paper execute MCP server over stdio"),
);

// Effect CLI rejects unknown flags, so claude's own flags must follow `--`.
const cc = Command.make(
	"cc",
	{ args: Argument.String("args").pipe(Argument.variadic()) },
	(config) =>
		runDesignerClaude(config.args).pipe(
			Effect.flatMap((exitCode) => Effect.sync(() => process.exit(exitCode))),
		),
).pipe(
	Command.withDescription(
		"Launch Claude Code with the designer agent; pass claude args after `--` (designer cc -- --resume)",
	),
);

const designer = Command.make("designer").pipe(Command.withSubcommands([mcp, cc]));

// No top-level await: `--bytecode` compiles to CommonJS.
Command.run(designer, { version: pkg.version }).pipe(
	Effect.provide(BunServices.layer),
	BunRuntime.runMain,
);
