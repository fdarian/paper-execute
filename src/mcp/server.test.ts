import { expect, test } from "bun:test";
import { createExecutionEngine } from "@executor-js/execution/core";
import { makeQuickJsExecutor } from "@executor-js/runtime-quickjs";
import { createExecutor, Tenant } from "@executor-js/sdk/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Effect } from "effect";

import { iconPlugin } from "#/icons/plugin";
import { createPaperExecuteServer } from "#/mcp/server";
import { createPluginRegistry } from "#/plugin/registry";

test("MCP client receives emitted content before returned text through QuickJS", async () => {
	const registry = await Effect.runPromise(createPluginRegistry([iconPlugin]));
	const executor = await Effect.runPromise(
		createExecutor({
			tenant: Tenant.make("test"),
			plugins: [registry.executorPlugin()],
			onElicitation: "accept-all",
		}),
	);
	const server = createPaperExecuteServer(
		createExecutionEngine({ executor, codeExecutor: makeQuickJsExecutor() }),
		registry.docsText,
		registry.preambleSource,
	);
	const client = new Client({ name: "test", version: "1.0.0" });
	const transports = InMemoryTransport.createLinkedPair();
	await server.connect(transports[0]);
	await client.connect(transports[1]);
	try {
		const tools = await client.listTools();
		expect(tools.tools[0]?.description).toContain("return t.summary;");
		expect(tools.tools[0]?.description).toContain("return f.nodes;");
		const merged = await client.callTool({
			name: "execute",
			arguments: {
				code: 'return __unwrapPaper({ ok: true, data: { content: [{ type: "text", text: \'{"file":{},"contentHash":"hash"}\' }, { type: "text", text: \'{"summary":"tree","nodeId":"node","depth":2}\' }] } }).summary;',
			},
		});
		expect(merged.content).toEqual([{ type: "text", text: "tree" }]);
		const collision = await client.callTool({
			name: "execute",
			arguments: {
				code: 'return __unwrapPaper({ ok: true, data: { content: [{ type: "text", text: \'{"x":1}\' }, { type: "text", text: \'{"x":2}\' }] } })[1].text;',
			},
		});
		expect(collision.content).toEqual([{ type: "text", text: '{"x":2}' }]);
		const image = { type: "image", data: "aGVsbG8=", mimeType: "image/png" };
		const text = { type: "text", text: "caption" };
		const result = await client.callTool({
			name: "execute",
			arguments: { code: `emit(${JSON.stringify(image)}); return "caption";` },
		});
		expect(result.content).toEqual([image, text]);
		const logged = await client.callTool({
			name: "execute",
			arguments: { code: `console.log("checkpoint"); emit(${JSON.stringify(image)});` },
		});
		expect(logged.content).toEqual([image, { type: "text", text: "Logs:\n[log] checkpoint" }]);
		const empty = await client.callTool({
			name: "execute",
			arguments: { code: "return [];" },
		});
		expect(empty.content).toEqual([{ type: "text", text: "[]" }]);
		const returnedArray = await client.callTool({
			name: "execute",
			arguments: { code: `return ${JSON.stringify([image, text])};` },
		});
		expect(returnedArray.content).toEqual([
			{ type: "text", text: JSON.stringify([image, text], null, 2) },
		]);
		const emittedAndReturned = await client.callTool({
			name: "execute",
			arguments: { code: `emit(${JSON.stringify(image)}); return ${JSON.stringify([image])};` },
		});
		expect(emittedAndReturned.content).toEqual([
			image,
			{ type: "text", text: JSON.stringify([image], null, 2) },
		]);
		const emittedOnly = await client.callTool({
			name: "execute",
			arguments: { code: `emit(${JSON.stringify(image)});` },
		});
		expect(emittedOnly.content).toEqual([image]);
		const plainEmission = await client.callTool({
			name: "execute",
			arguments: { code: 'emit("first"); emit("second"); return "last";' },
		});
		expect(plainEmission.content).toEqual([
			{ type: "text", text: "first" },
			{ type: "text", text: "second" },
			{ type: "text", text: "last" },
		]);
		const plain = await client.callTool({
			name: "execute",
			arguments: { code: 'return "guide text";' },
		});
		expect(plain.content).toEqual([{ type: "text", text: "guide text" }]);
		const ordinary = await client.callTool({
			name: "execute",
			arguments: { code: 'return [{ type: "not-mcp", value: 1 }];' },
		});
		expect(ordinary.content).toEqual([
			{ type: "text", text: JSON.stringify([{ type: "not-mcp", value: 1 }], null, 2) },
		]);
		const file = await client.callTool({
			name: "execute",
			arguments: {
				code: 'emit({ _tag: "ToolFile", name: "test.png", mimeType: "image/png", encoding: "base64", data: "aGVsbG8=", byteLength: 5 });',
			},
		});
		expect(file.content).toEqual([
			{ type: "text", text: "File output: test.png (image/png, 5 bytes)" },
			image,
		]);
		const plugin = await client.callTool({
			name: "execute",
			arguments: { code: 'return (await plugins.icon.get("acorn")).includes("<svg");' },
		});
		expect(plugin.content).toEqual([{ type: "text", text: "true" }]);
	} finally {
		await client.close();
		await server.close();
	}
});
