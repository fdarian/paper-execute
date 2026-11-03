import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Effect } from "effect";

import type { DesignBackend } from "#/backend";
import { buildExecutionEngine } from "#/executor/engine";
import { createPaperExecuteServer } from "#/mcp/server";

export const serveStdio = (backend: DesignBackend) =>
	buildExecutionEngine(backend).pipe(
		Effect.flatMap((runtime) =>
			Effect.tryPromise({
				try: async () => {
					const server = createPaperExecuteServer(
						backend,
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
