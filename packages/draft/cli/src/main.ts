#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import pkg from "../package.json" with { type: "json" };
import { atlasCommand } from "./atlas.ts";

const draft = Command.make("draft").pipe(
	Command.withDescription("Query and edit the product atlas of a draft project"),
	Command.withSubcommands([atlasCommand]),
);

// No top-level await: `--bytecode` compiles to CommonJS.
Command.run(draft, { version: pkg.version }).pipe(
	Effect.provide(BunServices.layer),
	BunRuntime.runMain,
);
