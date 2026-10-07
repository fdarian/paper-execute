import type { ExecutionEngine } from "@executor-js/execution/core";
import { isToolFile, type ToolFile } from "@executor-js/sdk/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type ContentBlock, ContentBlockSchema } from "@modelcontextprotocol/sdk/types.js";
import { Effect } from "effect";
import type * as Cause from "effect/Cause";
import { z } from "zod";

import { buildPaperExecutorPreamble } from "#/executor/preamble";

type ExecuteResult = {
	readonly result: unknown;
	readonly output?: readonly unknown[];
	readonly error?: string;
	readonly logs?: readonly string[];
};

const textFileContentMaxChars = 64_000;

const paperInstructions = [
	"Paper is a professional design tool for creating user interfaces. The user is working on a 2D canvas composing designs.",
	"The Paper MCP server gives you tools to be a talented designer for web and mobile apps and websites. You can read designs from the user's file, see what the user is doing, and write HTML back into the design as new nodes.",
	"",
	"Inside `execute`, call Paper APIs with `await paper.<tool>(args)`. Paper calls throw on failure and return structuredContent when present; otherwise, nonempty all-text content whose blocks each parse as JSON objects with no shared keys returns their shallow merge (including a single JSON-object block). Invalid JSON, arrays/null/primitives, key collisions, or non-text blocks fall back to a string for exactly one text item, otherwise the unchanged content array. There is no `.content` wrapper. Plugin calls return their bare data and throw on failure; use raw `tools.*` only for the executor workflow below.",
	"For screenshots: `const s = await paper.get_screenshot({ fileId, nodeId }); for (const c of s) if (c.type === 'image') emit(c);`. Tree summaries: `const t = await paper.get_tree_summary({ fileId, nodeId, depth: 2 }); return t.summary;`. Find nodes: `const f = await paper.find_nodes({ fileId, textValue: 'Submit' }); return f.nodes;`.",
	"",
	'You MUST load the full guide before other Paper tools: `await paper.get_guide({ topic: "paper-mcp-instructions" })`. Do this once per session; call again if a long thread may have dropped guide text.',
	"",
	"- Call `paper.get_basic_info` when starting on a file to learn artboards and dimensions; use `paper.get_selection` to see user focus. Only `get_basic_info` and `get_selection` may omit fileId (they use the file the user is looking at); every other Paper tool requires `fileId`, so pass `file.id` from `paper.get_basic_info`.",
	"- pageId defaults to the page the user is viewing; pass it to work on another page without disrupting them. You can't switch their page.",
	'- `paper.find_nodes` is a filtered search, not page enumeration: it requires textValue or a non-empty filters array. For example, use `{ fileId, pageId, textValue: "Submit" }` or `{ fileId, pageId, filters: [{ styleName: "background-color", styleValue: "#ff0000" }] }`; never call it with only fileId and pageId.',
	"- Typography: you MUST call `paper.get_font_family_info` before your first typographic styling in a session. Prefer font families listed in `paper.get_basic_info` unless the user specifies otherwise. Use px for font sizes, em for letter-spacing, px for line-height.",
	"- New designs: before writing HTML, generate a brief (palette, type scale, spacing, direction) unless given a design system.",
	"- Creating/editing: each `paper.write_html` call should add roughly one visual group; prefer `paper.duplicate_nodes` with `paper.update_styles` and `paper.set_text_content` when faster than rewriting HTML.",
	"- For `paper.write_html`, use inline styles and flexbox; avoid margin, grid, and tables.",
	'- Quality: use `paper.get_screenshot` to review after meaningful changes. Artboard height is a starting point — when content clips set height: "fit-content" via `paper.update_styles` rather than guessing a fixed height.',
	"- Repeated rows (lists, nav): use fixed-width slots for icons and trailing actions (flexShrink: 0); gap alone won't align columns across rows.",
	"- When done creating or editing, you MUST call `paper.finish_working_on_nodes`.",
	"- Never show raw node IDs to the user.",
	"- Export to the user's codebase: use `paper.get_jsx`, `paper.get_computed_styles`, `paper.get_fill_image`, etc. for exact values — never read sizes or colors from screenshots.",
].join("\n");

const executeInstructions = [
	"# execute",
	"",
	"Execute TypeScript in a sandboxed runtime with access to configured API tools.",
	"",
	"## Workflow",
	"",
	'1. `const search = await tools.search({ query: "<intent + key nouns>", limit: 12 }); const matches = search.items;`',
	'2. `const path = matches[0]?.path; if (path === undefined) throw new Error("No matching tools found.");`',
	"3. `const details = await tools.describe.tool({ path });`",
	"4. Use `details.inputTypeScript` / `details.outputTypeScript` and `details.typeScriptDefinitions` for compact shapes.",
	"5. Call the tool: `const result = await tools.<path>(input);`",
	"",
	"## Rules",
	"",
	"- `tools.search()` returns paginated, ranked matches: `{ items, total, hasMore, nextOffset }`. Best-first. Use short intent phrases like `github issues`, `repo details`, or `create calendar event`.",
	'- When you already know the namespace, narrow with `tools.search({ namespace: "github", query: "issues" })`.',
	"- For configured integration inventory, call `tools.executor.integrations.list({})` and read `result.items` directly; this discovery call has no `{ ok, data }` envelope.",
	"- Tool calls return a value union: `{ ok: true, data }` for success or `{ ok: false, error: { code, message, status?, details?, retryable? } }` for expected tool/domain failures. Branch on `result.ok`.",
	"- `data` is the upstream payload itself. HTTP-backed tools (OpenAPI) also set `http: { status, headers }` beside `data` — read `result.http?.headers` for pagination (Link) or rate-limit headers.",
	"- Use `emit(value)` to append user-visible output. Plain values become MCP text content. MCP content blocks are forwarded as-is. `ToolFile` values are rendered by MIME. Emitted items come first in the tool result, followed by the returned value.",
	'- File-returning tools may return `ToolFile` values: `{ _tag: "ToolFile", name?, mimeType, encoding: "base64", data, byteLength }`. A "file-returning tool" includes APIs that return file bytes inside a JSON field, such as Base64-encoded `content`; wrap those payloads in a `ToolFile` and `emit()` them. Emit any attachment with `emit(result.data)`.',
	"- Never decode or transcode bytes yourself — the sandbox has no `Buffer`, `atob`, `btoa`, `TextDecoder`, or `TextEncoder`. For base64-encoded bytes in a JSON field, wrap the payload in a `ToolFile` with its `mimeType` and `emit()` it; to forward them to an upload tool, pass the `ToolFile`'s base64 `data` as that tool's `bodyBase64` (both sides speak base64, so nothing is decoded).",
	'- To emit MCP-native content directly, pass an MCP content block to `emit(...)`, such as `{ type: "image", data, mimeType }`, `{ type: "audio", data, mimeType }`, `{ type: "text", text }`, `{ type: "resource", resource }`, or `{ type: "resource_link", uri, name, ... }`.',
	"- `emit(ToolFile)` is MIME-based: `image/*` becomes MCP image content, `audio/*` becomes MCP audio content, text-like files become decoded text, and other binary files become embedded MCP resources.",
	"- Returned values, including content arrays, are serialized as text. For `paper.*` content arrays, use `for (const block of result) { emit(block); }`. Raw MCP CallToolResults use `result.content`; emit a `ToolFile` directly.",
	"- Some providers, including Gmail, return attachment bytes as a `ToolFile` with no public URL to hand off — the bytes themselves are the payload, so `emit(result.data)` to display it, or pass its base64 `data` as another tool's `bodyBase64` to forward it.",
	"- If `tools.search()` returns `hasMore: true` and you didn't find what you need, fetch the next page: `tools.search({ query, offset: nextOffset, limit })`.",
	"- Always use the full address when calling tools: `tools.<integration>.<owner>.<connection>.<tool>(args)`. The `path` returned by `tools.search()` / `tools.describe.tool()` is already the exact path under `tools` — call `tools[path]` rather than guessing segments.",
	'- The `tools` object is a lazy proxy — enumerating it (`Object.keys(tools)`, spread, `for...in`) throws. Use `tools.search({ namespace: "paper", query: "" })` to enumerate an integration\'s tools instead.',
	'- Pass an object to system tools, e.g. `tools.search({ query: "..." })`, `tools.executor.integrations.list({})`, and `tools.describe.tool({ path })`.',
	'- `tools.describe.tool()` returns compact TypeScript shapes. Use `inputTypeScript`, `outputTypeScript`, and `typeScriptDefinitions`. If the path doesn\'t resolve, the result carries `error: { code: "tool_not_found", suggestions }` — use a suggestion instead of retrying the same path.',
	"- When `outputTypeScriptNote` is present, the `data` type was observed from live responses rather than declared by the provider: the listed fields are reliable, but the shape may be incomplete — prefer optional access for anything not listed.",
	"- For tools that return large collections (e.g. `getStates`, `getAll`), filter results in code rather than calling per-item tools.",
	"- Do not use `fetch` — all API calls go through `tools.*`.",
	"- If execution pauses for interaction, resume it with the returned `resumePayload`.",
	"- TypeScript type syntax (`: T`, `as T`, generics, interfaces, type aliases) is stripped before execution — feel free to write idiomatic TypeScript using the shapes from `tools.describe.tool()`. Decorators and `enum` are not supported.",
].join("\n");

// Clients truncate server instructions, so plugin instructions come first and the generic executor workflow last.
function buildServerInstructions(pluginInstructionsText: string): string {
	const sections =
		pluginInstructionsText.length === 0 ? [] : [`## Plugins\n\n${pluginInstructionsText}`];
	return [...sections, paperInstructions, executeInstructions].join("\n\n");
}

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
