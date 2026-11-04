import { mkdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { draftInstructions } from "./instructions.ts";
import { parseViewportWidth, resolveFrame } from "./project.ts";
import { ChromeRenderer } from "./renderer.ts";
import { type DraftServer, startDraftServer } from "./server.ts";

const rendersDir = ".renders";

function pngPathFor(dir: string, file: string, selector: string | undefined): string {
	const suffix = selector === undefined ? "" : `@${Bun.hash(selector).toString(36)}`;
	return join(dir, rendersDir, `${file}${suffix}.png`);
}

export function createDraftMcpServer(
	dir: string,
	httpServer: DraftServer,
	renderer: ChromeRenderer,
): McpServer {
	const server = new McpServer(
		{ name: "draft", version: "1.0.0" },
		{ instructions: draftInstructions },
	);

	server.registerTool(
		"render",
		{
			description:
				"Render an HTML frame in the project folder to a PNG and return the image, its size, and any warnings (console errors, failed requests, unknown icons).",
			inputSchema: {
				file: z.string().min(1).describe("Frame path, relative to the project folder or absolute"),
				selector: z
					.string()
					.min(1)
					.optional()
					.describe("CSS selector; captures just that element at full size"),
				maxWidth: z
					.number()
					.int()
					.positive()
					.optional()
					.describe("Maximum PNG width in pixels for a full-frame capture (default 960)"),
			},
		},
		async (input) => {
			const frame = resolveFrame(dir, input.file);
			return await renderFrame(dir, httpServer, renderer, frame, input.selector, input.maxWidth);
		},
	);

	return server;
}

async function renderFrame(
	dir: string,
	httpServer: DraftServer,
	renderer: ChromeRenderer,
	frame: { readonly path: string; readonly absolute: string },
	selector: string | undefined,
	maxWidth: number | undefined,
) {
	const html = await Bun.file(frame.absolute).text();
	const width = parseViewportWidth(html);
	const url = `${httpServer.url}/${frame.path.split("/").map(encodeURIComponent).join("/")}`;
	httpServer.takeWarnings(frame.path);
	const result = await renderer.render({ url, width, selector, maxWidth });

	const png = pngPathFor(dir, frame.path, selector);
	mkdirSync(dirname(png), { recursive: true });
	await Bun.write(png, result.png);

	const warnings = [...httpServer.takeWarnings(frame.path), ...result.warnings];
	const lines = [
		`PNG: ${png}`,
		`Frame: ${result.frame.width}x${result.frame.height}px, image ${result.output.width}x${result.output.height}`,
		...(warnings.length === 0 ? ["No warnings."] : ["Warnings:", ...warnings.map((w) => `- ${w}`)]),
	];
	return {
		content: [
			{ type: "image" as const, data: result.png.toString("base64"), mimeType: "image/png" },
			{ type: "text" as const, text: lines.join("\n") },
		],
	};
}

export async function serveDraftStdio(dir: string): Promise<void> {
	if (!isAbsolute(dir) || !statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
		throw new Error(`--dir must be an existing absolute directory, got "${dir}"`);
	}
	const httpServer = startDraftServer({ dir, view: false });
	const renderer = new ChromeRenderer();
	const server = createDraftMcpServer(dir, httpServer, renderer);
	const transport = new StdioServerTransport();

	const closed = new Promise<void>((resolve) => {
		const shutdown = () => resolve();
		transport.onclose = shutdown;
		// The SDK's stdio transport only reports close() calls, not the host hanging up.
		process.stdin.on("end", shutdown);
		process.stdin.on("close", shutdown);
	});
	await server.connect(transport);
	await closed;
	await renderer.close();
	await httpServer.stop();
}
