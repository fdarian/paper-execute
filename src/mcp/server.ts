import type { ExecutionEngine } from "@executor-js/execution/core";
import { isToolFile, type ToolFile } from "@executor-js/sdk/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type ContentBlock, ContentBlockSchema } from "@modelcontextprotocol/sdk/types.js";
import { Effect } from "effect";
import type * as Cause from "effect/Cause";
import { z } from "zod";

import { buildPaperExecutorPreamble } from "#/executor/preamble";
import { buildServerInstructions } from "#/mcp/instructions";

type ExecuteResult = {
	readonly result: unknown;
	readonly output?: readonly unknown[];
	readonly error?: string;
	readonly logs?: readonly string[];
};

const textFileContentMaxChars = 64_000;

function buildExecuteDescription(pluginCallsSummary: string): string {
	const lines = [
		"Execute TypeScript in a sandbox with Paper APIs and configured plugins. Await tool calls. `return` serializes values as text; `emit(value)` sends native MCP content or files. See server instructions for the workflow.",
		"`paper.<tool>(args)` throws on failure and returns structuredContent when present; otherwise, nonempty all-text content whose blocks each parse as JSON objects with no shared keys returns their shallow merge (including a single JSON-object block). Invalid JSON, arrays/null/primitives, key collisions, or non-text blocks fall back to a string for exactly one text item, otherwise the unchanged content array. There is no `.content` wrapper. Plugins return their bare data.",
		"Screenshots: `const s = await paper.get_screenshot({ fileId, nodeId }); for (const c of s) if (c.type === 'image') emit(c);`. Tree summaries: `const t = await paper.get_tree_summary({ fileId, nodeId, depth: 2 }); return t.summary;`. Find nodes: `const f = await paper.find_nodes({ fileId, textValue: 'Submit' }); return f.nodes;`.",
	];
	if (pluginCallsSummary.length > 0) {
		lines.splice(
			1,
			0,
			`Plugins: ${pluginCallsSummary} — see server instructions "Plugins" for when and how to use each.`,
		);
	}
	return lines.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolFileName(file: ToolFile): string {
	if (file.name !== undefined) {
		return file.name;
	}
	return "tool-output";
}

function normalizedMimeType(file: ToolFile): string {
	return file.mimeType.replace(/;.*/, "").trim().toLowerCase();
}

function toolFileKind(file: ToolFile): "image" | "audio" | "text" | "resource" {
	const mimeType = normalizedMimeType(file);
	if (mimeType.startsWith("image/")) {
		return "image";
	}
	if (mimeType.startsWith("audio/")) {
		return "audio";
	}
	if (
		mimeType.startsWith("text/") ||
		mimeType === "application/json" ||
		mimeType.endsWith("+json") ||
		mimeType === "application/xml" ||
		mimeType.endsWith("+xml") ||
		mimeType === "application/javascript" ||
		mimeType === "application/x-javascript" ||
		mimeType === "application/yaml" ||
		mimeType === "application/x-yaml"
	) {
		return "text";
	}
	return "resource";
}

function bytesFromBase64(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

function decodeTextFile(file: ToolFile): string {
	const text = new TextDecoder("utf-8", { fatal: false }).decode(bytesFromBase64(file.data));
	if (text.length <= textFileContentMaxChars) {
		return text;
	}
	return `${text.slice(0, textFileContentMaxChars)}\n\n[truncated ${text.length - textFileContentMaxChars} characters]`;
}

function toolFileContent(file: ToolFile): ContentBlock[] {
	const kind = toolFileKind(file);
	if (kind === "image") {
		return [{ type: "image", data: file.data, mimeType: file.mimeType }];
	}
	if (kind === "audio") {
		return [{ type: "audio", data: file.data, mimeType: file.mimeType }];
	}
	if (kind === "text") {
		return [{ type: "text", text: decodeTextFile(file) }];
	}
	return [
		{
			type: "resource",
			resource: {
				uri: `executor-file:///${encodeURIComponent(toolFileName(file))}`,
				mimeType: file.mimeType,
				blob: file.data,
			},
		},
	];
}

function outputItemContent(item: unknown): ContentBlock[] {
	if (!isRecord(item)) {
		return [{ type: "text", text: "Invalid execution output item omitted." }];
	}
	if (item.type === "file" && isToolFile(item.file)) {
		return [
			{
				type: "text",
				text: `File output: ${toolFileName(item.file)} (${item.file.mimeType}, ${item.file.byteLength} bytes)`,
			},
			...toolFileContent(item.file),
		];
	}
	if (item.type === "content") {
		const content = ContentBlockSchema.safeParse(item.content);
		if (content.success) {
			return [content.data];
		}
	}
	return [{ type: "text", text: "Invalid execution output item omitted." }];
}

function stringifyExecuteResult(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	const text = JSON.stringify(value, null, 2);
	if (text === undefined) {
		throw new Error("Execution result cannot be represented as JSON.");
	}
	return text;
}

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
		parts.push(stringifyExecuteResult(result.result));
	}
	if (result.logs !== undefined && result.logs.length > 0) {
		parts.push(`Logs:\n${result.logs.join("\n")}`);
	}
	return parts.join("\n\n");
}

function executionContent(result: ExecuteResult): ContentBlock[] {
	const content: ContentBlock[] = [];
	if (result.output !== undefined) {
		for (const item of result.output) {
			content.push(...outputItemContent(item));
		}
	}
	const resultText = renderExecuteResult(result);
	if (resultText.length > 0) {
		content.push({ type: "text", text: resultText });
	}
	return content;
}

export function createPaperExecuteServer<E extends Cause.YieldableError>(
	engine: ExecutionEngine<E>,
	pluginInstructionsText: string,
	pluginCallsSummary: string,
	pluginPreambleSource: string,
): McpServer {
	const server = new McpServer(
		{ name: "paper-execute", version: "1.0.0" },
		{
			instructions: buildServerInstructions(pluginInstructionsText),
		},
	);

	server.registerTool(
		"execute",
		{
			description: buildExecuteDescription(pluginCallsSummary),
			inputSchema: { code: z.string().min(1) },
		},
		async (input) => {
			const code = `${buildPaperExecutorPreamble(pluginPreambleSource)}\n${input.code}`;
			const result = (await Effect.runPromise(
				engine.execute(code, {
					onElicitation: () => Effect.succeed({ action: "accept" }),
				}),
			)) as ExecuteResult;

			if (result.error !== undefined) {
				throw new Error(renderExecuteResult(result));
			}

			return { content: executionContent(result) };
		},
	);

	return server;
}
