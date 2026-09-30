import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { Effect } from "effect";

import { buildPaperExecutorPreamble } from "#/executor/preamble";
import { iconPlugin } from "#/icons/plugin";
import { createPluginRegistry } from "#/plugin/registry";

const pluginRegistry = Effect.runSync(createPluginRegistry([iconPlugin]));
const paperExecutorPreamble = buildPaperExecutorPreamble(pluginRegistry.preambleSource);

function execute(result: unknown, code = "return await paper.example({});") {
	return runInNewContext(`(async () => { ${paperExecutorPreamble}\n${code} })()`, {
		tools: {
			paper: { org: { default: { example: async () => result } } },
			paperPluginTools: {
				plugin__icon__get: async () => ({ ok: true, data: "<svg/>" }),
				plugin__icon__search: async () => ({ ok: true, data: ["acorn"] }),
			},
		},
	});
}

test("a single JSON-object text item returns its parsed object", async () => {
	expect(
		await execute({ ok: true, data: { content: [{ type: "text", text: '{"x":1}' }] } }),
	).toEqual({ x: 1 });
	expect(await execute({ ok: true, data: { content: [{ type: "text", text: "{}" }] } })).toEqual(
		{},
	);
});

test("Paper metadata and payload objects merge shallowly", async () => {
	const content = [
		{ type: "text", text: '{"file":{"id":"file-id"},"contentHash":"hash"}' },
		{ type: "text", text: '{"nodes":[{"id":"node-id"}],"count":1}' },
		{ type: "text", text: "{}" },
	];
	expect(await execute({ ok: true, data: { content } })).toEqual({
		file: { id: "file-id" },
		contentHash: "hash",
		nodes: [{ id: "node-id" }],
		count: 1,
	});
	expect(
		await execute({ ok: true, data: { content } }, "return (await paper.example({})).nodes;"),
	).toEqual([{ id: "node-id" }]);
});

test("duplicate top-level keys fall back even when their values match", async () => {
	for (const text of ['{"x":1}', '{"x":2}']) {
		const content = [
			{ type: "text", text: '{"x":1}' },
			{ type: "text", text },
		];
		expect(await execute({ ok: true, data: { content } })).toBe(content);
	}
});

test("special object keys are preserved without changing the merged prototype", async () => {
	const content = [
		{ type: "text", text: '{"__proto__":{"polluted":true},"constructor":1}' },
		{ type: "text", text: '{"toString":2}' },
	];
	expect(
		await execute(
			{ ok: true, data: { content } },
			"const value = await paper.example({}); return [Object.keys(value), value.__proto__, value.polluted === undefined, Object.getPrototypeOf(value) === Object.prototype];",
		),
	).toEqual([["__proto__", "constructor", "toString"], { polluted: true }, true, true]);
	const collision = [content[0], { type: "text", text: '{"__proto__":0}' }];
	expect(await execute({ ok: true, data: { content: collision } })).toBe(collision);
});

test("non-object JSON and non-JSON text fall back to the existing rules", async () => {
	for (const text of ["[]", "null", "1", "true", '"text"', "not JSON", "{"]) {
		expect(await execute({ ok: true, data: { content: [{ type: "text", text }] } })).toBe(text);
		const content = [
			{ type: "text", text: '{"file":{}}' },
			{ type: "text", text },
		];
		expect(await execute({ ok: true, data: { content } })).toBe(content);
	}
});

test("unexpected parsing errors are not swallowed", async () => {
	await expect(
		execute(
			{ ok: true, data: { content: [{ type: "text", text: "{}" }] } },
			"JSON.parse = () => { throw new TypeError('unexpected'); }; return await paper.example({});",
		),
	).rejects.toThrow("unexpected");
});

test("multiple Paper text items remain an unchanged content array", async () => {
	const content = [
		{ type: "text", text: "metadata" },
		{ type: "text", text: "tree" },
	];
	expect(await execute({ ok: true, data: { content } })).toBe(content);
	expect(
		await execute({ ok: true, data: { content } }, "return (await paper.example({}))[1].text;"),
	).toBe("tree");
});

test("structuredContent takes precedence over text", async () => {
	expect(
		await execute({
			ok: true,
			data: { structuredContent: { x: 1 }, content: [{ type: "text", text: "ignored" }] },
		}),
	).toEqual({ x: 1 });
	expect(await execute({ ok: true, data: { structuredContent: {}, content: [] } })).toEqual({});
});

test("empty content remains an unchanged array", async () => {
	const content: unknown[] = [];
	expect(await execute({ ok: true, data: { content } })).toBe(content);
});

test("mixed JSON-object text and image content remains unchanged", async () => {
	const content = [
		{ type: "text", text: '{"file":{}}' },
		{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
	];
	expect(await execute({ ok: true, data: { content } })).toBe(content);
});

test("a single non-text item remains an unchanged content array", async () => {
	const content = [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }];
	expect(await execute({ ok: true, data: { content } })).toBe(content);
});

test("raw and plugin-normalized Paper failures use all text blocks", async () => {
	const content = [
		{ type: "text", text: "one" },
		{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
		{ type: "text", text: "two" },
	];
	await expect(
		execute({ ok: true, data: { isError: true, structuredContent: { ignored: true }, content } }),
	).rejects.toThrow("one\ntwo");
	await expect(
		execute({ ok: false, error: { message: "one", details: { content } } }),
	).rejects.toThrow("one\ntwo");
	await expect(execute({ ok: false, error: { message: "transport failed" } })).rejects.toThrow(
		"transport failed",
	);
});

test("icon helpers keep their existing unwrapping", async () => {
	expect(await execute(undefined, 'return await plugins.icon.get("acorn");')).toBe("<svg/>");
	expect(await execute(undefined, 'return await plugins.icon.search("acorn");')).toEqual(["acorn"]);
});
