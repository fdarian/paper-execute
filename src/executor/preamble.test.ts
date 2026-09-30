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

test("exactly one Paper text item returns its string without parsing JSON", async () => {
	expect(await execute({ ok: true, data: { content: [{ type: "text", text: '{"x":1}' }] } })).toBe(
		'{"x":1}',
	);
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

test("mixed content remains unchanged", async () => {
	const content = [
		{ type: "text", text: "screenshot" },
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
