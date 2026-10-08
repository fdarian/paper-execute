import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Effect } from "effect";

import { buildExecutionEngine } from "#/executor/engine";
import { createPaperExecuteServer } from "#/mcp/server";

export const serveStdio = buildExecutionEngine().pipe(
	Effect.flatMap((runtime) =>
		Effect.tryPromise({
			try: async () => {
				const server = createPaperExecuteServer(
					runtime.engine,
					runtime.pluginRegistry.instructionsText,
					runtime.pluginRegistry.callsSummary,
					runtime.pluginRegistry.preambleSource,
				);
				const transport = new StdioServerTransport();
				await server.connect(transport);
				await Effect.runPromise(Effect.never);
			},
			catch: (cause) => cause,
		}),
	),
);
