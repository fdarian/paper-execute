#!/usr/bin/env bun

import { BunRuntime } from "@effect/platform-bun";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Effect } from "effect";

import { buildExecutionEngine } from "#/executor/engine";
import { createPaperExecuteServer } from "#/mcp/server";

const paperMcpUrl = process.env.PAPER_MCP_URL ?? "http://127.0.0.1:29979/mcp";

const program = buildExecutionEngine(paperMcpUrl).pipe(
	Effect.flatMap((engine) =>
		Effect.tryPromise({
			try: async () => {
				const server = createPaperExecuteServer(engine);
				const transport = new StdioServerTransport();
				await server.connect(transport);
				await Effect.runPromise(Effect.never);
			},
			catch: (cause) => cause,
		}),
	),
);

BunRuntime.runMain(program);
