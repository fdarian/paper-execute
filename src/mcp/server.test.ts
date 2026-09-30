import { expect, test } from "bun:test";
import { createExecutionEngine } from "@executor-js/execution/core";
import { makeQuickJsExecutor } from "@executor-js/runtime-quickjs";
import { createExecutor, Tenant } from "@executor-js/sdk/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Effect } from "effect";

import { createPaperExecuteServer } from "#/mcp/server";

test("MCP client receives emitted content before returned text through QuickJS", async () => {
	const executor = await Effect.runPromise(
		createExecutor({ tenant: Tenant.make("test"), plugins: [], onElicitation: "accept-all" }),
	);
	const server = createPaperExecuteServer(
		createExecutionEngine({ executor, codeExecutor: makeQuickJsExecutor() }),
	);
	const client = new Client({ name: "test", version: "1.0.0" });
	const transports = InMemoryTransport.createLinkedPair();
	await server.connect(transports[0]);
	await client.connect(transports[1]);
	try {
		const image = { type: "image", data: "aGVsbG8=", mimeType: "image/png" };
		const text = { type: "text", text: "caption" };
		const result = await client.callTool({
			name: "paper_execute",
			arguments: { code: `emit(${JSON.stringify(image)}); return "caption";` },
		});
		expect(result.content).toEqual([image, text]);
		const logged = await client.callTool({
			name: "paper_execute",
			arguments: { code: `console.log("checkpoint"); emit(${JSON.stringify(image)});` },
		});
		expect(logged.content).toEqual([image, { type: "text", text: "Logs:\n[log] checkpoint" }]);
		const empty = await client.callTool({
			name: "paper_execute",
			arguments: { code: "return [];" },
		});
		expect(empty.content).toEqual([{ type: "text", text: "[]" }]);
		const returnedArray = await client.callTool({
			name: "paper_execute",
			arguments: { code: `return ${JSON.stringify([image, text])};` },
		});
		expect(returnedArray.content).toEqual([
			{ type: "text", text: JSON.stringify([image, text], null, 2) },
		]);
		const emittedAndReturned = await client.callTool({
			name: "paper_execute",
			arguments: { code: `emit(${JSON.stringify(image)}); return ${JSON.stringify([image])};` },
		});
		expect(emittedAndReturned.content).toEqual([
			image,
			{ type: "text", text: JSON.stringify([image], null, 2) },
		]);
		const emittedOnly = await client.callTool({
			name: "paper_execute",
			arguments: { code: `emit(${JSON.stringify(image)});` },
		});
		expect(emittedOnly.content).toEqual([image]);
		const plainEmission = await client.callTool({
			name: "paper_execute",
			arguments: { code: 'emit("first"); emit("second"); return "last";' },
		});
		expect(plainEmission.content).toEqual([
			{ type: "text", text: "first" },
			{ type: "text", text: "second" },
			{ type: "text", text: "last" },
		]);
		const plain = await client.callTool({
			name: "paper_execute",
			arguments: { code: 'return "guide text";' },
		});
		expect(plain.content).toEqual([{ type: "text", text: "guide text" }]);
		const ordinary = await client.callTool({
			name: "paper_execute",
			arguments: { code: 'return [{ type: "not-mcp", value: 1 }];' },
		});
		expect(ordinary.content).toEqual([
			{ type: "text", text: JSON.stringify([{ type: "not-mcp", value: 1 }], null, 2) },
		]);
	} finally {
		await client.close();
		await server.close();
	}
});
