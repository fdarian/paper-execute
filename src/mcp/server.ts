import type { ExecutionEngine } from "@executor-js/execution/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ContentBlockSchema } from "@modelcontextprotocol/sdk/types.js";
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

const contentArraySchema = z.array(ContentBlockSchema);

function renderExecuteMetadata(result: ExecuteResult): string[] {
	const parts: string[] = [];
	if (result.output !== undefined && result.output.length > 0) {
		parts.push(`Output items: ${result.output.length}`);
	}
	if (result.logs !== undefined && result.logs.length > 0) {
		parts.push(`Logs:\n${result.logs.join("\n")}`);
	}
	return parts;
}

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
	return [resultText, ...renderExecuteMetadata(result)].join("\n\n");
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
				"`paper.<tool>(args)` throws on failure. It returns `structuredContent` when present; otherwise a newline-joined string for all-text content (never JSON-parsed), or an MCP content array for mixed/non-text content. There is no `.content` wrapper. Common tools: `write_html`, `open_file`, `create_artboard`, `get_selection`, `find_nodes`, `finish_working_on_nodes`.",
				"To send screenshot images to the client, return the content array: `return await paper.get_screenshot({ fileId, nodeId })`. `emit(c)` collects individual items, but this server only reports their count, not their content. Iterate screenshots directly (`for (const c of s)`), not `s.content`.",
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

			const content = contentArraySchema.safeParse(result.result);
			if (content.success) {
				const metadata = renderExecuteMetadata(result);
				return {
					content: [
						...content.data,
						...(metadata.length > 0
							? [{ type: "text" as const, text: metadata.join("\n\n") }]
							: []),
					],
				};
			}

			return {
				content: [{ type: "text", text: renderExecuteResult(result) }],
			};
		},
	);

	return server;
}
