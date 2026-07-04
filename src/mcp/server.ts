import type { ExecutionEngine } from "@executor-js/execution/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Effect } from "effect";
import type * as Cause from "effect/Cause";
import { z } from "zod";

import { paperExecutorPreamble } from "#/executor/preamble";

type ExecuteResult = {
	readonly result: unknown;
	readonly output?: readonly unknown[];
	readonly error?: string;
	readonly logs?: readonly string[];
};

function renderExecuteResult(result: ExecuteResult): string {
	if (result.error !== undefined) {
		const parts = [`Error: ${result.error}`];
		if (result.logs !== undefined && result.logs.length > 0) {
			parts.push(`Logs:\n${result.logs.join("\n")}`);
		}
		return parts.join("\n\n");
	}

	const resultText =
		typeof result.result === "string" ? result.result : JSON.stringify(result.result, null, 2);
	const parts = [resultText];
	if (result.output !== undefined && result.output.length > 0) {
		parts.push(`Output items: ${result.output.length}`);
	}
	if (result.logs !== undefined && result.logs.length > 0) {
		parts.push(`Logs:\n${result.logs.join("\n")}`);
	}
	return parts.join("\n\n");
}

export function createPaperExecuteServer<E extends Cause.YieldableError>(
	engine: ExecutionEngine<E>,
): McpServer {
	const server = new McpServer({ name: "paper-execute", version: "1.0.0" });

	server.registerTool(
		"paper_execute",
		{
			description: [
				"Execute async TypeScript inside an executor QuickJS sandbox wired to the Paper MCP plus Phosphor icon helpers. Everything is async — always `await`.",
				"`paper.<tool>(args)` drives Paper and returns the tool's data (throws on failure). Common tools: `write_html`, `open_file`, `create_artboard`, `get_selection`, `find_nodes`, `finish_working_on_nodes`.",
				"`icon_get(name)` returns embeddable Phosphor SVG markup as a string — e.g. `await paper.write_html({ html: await icon_get('acorn'), targetNodeId, mode: 'insert-children' })`. `icon_search(query)` returns candidate matches.",
				"For `write_html`, use inline styles and flexbox; avoid margin, grid, and tables. Call `finish_working_on_nodes` when done. Whatever your code `return`s comes back as the result.",
			].join("\n"),
			inputSchema: { code: z.string().min(1) },
		},
		async (input) => {
			const code = `${paperExecutorPreamble}\n${input.code}`;
			const result = (await Effect.runPromise(
				engine.execute(code, {
					onElicitation: () => Effect.succeed({ action: "accept" }),
				}),
			)) as ExecuteResult;

			if (result.error !== undefined) {
				throw new Error(renderExecuteResult(result));
			}

			return {
				content: [{ type: "text", text: renderExecuteResult(result) }],
			};
		},
	);

	return server;
}
