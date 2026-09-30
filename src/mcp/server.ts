import type { ExecutionEngine } from "@executor-js/execution/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type ContentBlock, ContentBlockSchema } from "@modelcontextprotocol/sdk/types.js";
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

const outputItemSchema = z.object({ type: z.literal("content"), content: ContentBlockSchema });

function renderExecuteResult(result: ExecuteResult): string {
	if (result.error !== undefined) {
		const parts = [`Error: ${result.error}`];
		if (result.logs !== undefined && result.logs.length > 0) {
			parts.push(`Logs:\n${result.logs.join("\n")}`);
		}
		return parts.join("\n\n");
	}

	const parts: string[] = [];
	if (result.result !== undefined) {
		const text =
			typeof result.result === "string" ? result.result : JSON.stringify(result.result, null, 2);
		if (text === undefined) {
			throw new Error("Execution result cannot be represented as JSON.");
		}
		parts.push(text);
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
				"`paper.<tool>(args)` throws on failure. It returns `structuredContent` when present; otherwise a string for exactly one text item (never JSON-parsed), or the content array unchanged for anything else. There is no `.content` wrapper. Common tools: `write_html`, `open_file`, `create_artboard`, `get_selection`, `find_nodes`, `finish_working_on_nodes`.",
				"Use `emit(c)` to send individual MCP content items to the client; emitted items come before returned text. For screenshots: `const s = await paper.get_screenshot({ fileId, nodeId }); for (const c of s) if (c.type === 'image') emit(c);`. Tree summaries keep both text blocks: `const t = await paper.get_tree_summary({ fileId, nodeId, depth: 2 }); return t[1].text;`.",
				"`icon_get(name)` returns embeddable Phosphor SVG markup as a string — e.g. `await paper.write_html({ html: await icon_get('acorn'), targetNodeId, mode: 'insert-children' })`. `icon_search(query)` returns candidate matches.",
				"For `write_html`, use inline styles and flexbox; avoid margin, grid, and tables. Call `finish_working_on_nodes` when done. Returned strings are sent as text; other returned values (including content arrays) are JSON-stringified. Only `emit` sends native content.",
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

			const content: ContentBlock[] = [];
			if (result.output !== undefined) {
				for (const item of result.output) {
					content.push(outputItemSchema.parse(item).content);
				}
			}
			const text = renderExecuteResult(result);
			if (text.length > 0) {
				content.push({ type: "text", text });
			}
			return { content };
		},
	);

	return server;
}
