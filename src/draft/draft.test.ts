import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { rewriteIcons } from "./icons.ts";
import {
	defaultViewportWidth,
	parseViewportWidth,
	resolveFrame,
	resolveInside,
} from "./project.ts";
import { ChromeRenderer, findChrome } from "./renderer.ts";
import { type DraftServer, startDraftServer } from "./server.ts";

let root: string;
let outside: string;
let server: DraftServer;

beforeAll(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "draft-test-")));
	outside = realpathSync(mkdtempSync(join(tmpdir(), "draft-outside-")));
	writeFileSync(join(outside, "secret.txt"), "secret");
	writeFileSync(join(root, "a.html"), "<i data-icon='heart'></i>");
	writeFileSync(join(root, "style.css"), "body{color:red}");
	mkdirSync(join(root, ".renders"));
	writeFileSync(join(root, ".renders", "a.html.png"), "x");
	symlinkSync(outside, join(root, "link"));
	server = startDraftServer({ dir: root, view: false });
});

afterAll(async () => {
	await server.stop();
	rmSync(root, { recursive: true, force: true });
	rmSync(outside, { recursive: true, force: true });
});

describe("icon rewrite", () => {
	test("expands to an inline 1em svg and keeps other attributes", async () => {
		const result = await rewriteIcons(
			`<p><i data-icon="heart" data-weight="fill" class="big" style="color:red"></i></p>`,
		);
		expect(result.warnings).toEqual([]);
		expect(result.html).not.toContain("<i ");
		expect(result.html).toContain('width="1em" height="1em" fill="currentColor"');
		expect(result.html).toContain('class="big"');
		expect(result.html).toContain('style="color:red"');
		expect(result.html).not.toContain("data-icon");
		const regular = await rewriteIcons(`<i data-icon="heart"></i>`);
		expect(regular.html).not.toBe(
			(await rewriteIcons(`<i data-icon="heart" data-weight="bold"></i>`)).html,
		);
	});

	test("reports unknown icons and weights and leaves the element", async () => {
		const result = await rewriteIcons(
			`<i data-icon="no-such-icon"></i><i data-icon="heart" data-weight="neon"></i>`,
		);
		expect(result.warnings).toHaveLength(2);
		expect(result.warnings[0]).toContain("no-such-icon");
		expect(result.warnings[1]).toContain("neon");
		expect(result.html).toContain("<i ");
	});
});

describe("viewport width", () => {
	test("reads width from the viewport meta", () => {
		expect(parseViewportWidth(`<meta name="viewport" content="width=390, initial-scale=1">`)).toBe(
			390,
		);
		expect(parseViewportWidth(`<meta content='width=768' name='viewport'>`)).toBe(768);
	});

	test("defaults when absent, device-width, or on another meta", () => {
		expect(parseViewportWidth("<html></html>")).toBe(defaultViewportWidth);
		expect(parseViewportWidth(`<meta name="viewport" content="width=device-width">`)).toBe(
			defaultViewportWidth,
		);
		expect(parseViewportWidth(`<meta name="description" content="width=500">`)).toBe(
			defaultViewportWidth,
		);
	});
});

describe("path escape", () => {
	test("resolveInside rejects paths outside the project", () => {
		expect(resolveInside(root, "a.html")).toBe(join(root, "a.html"));
		expect(() => resolveInside(root, "../etc/passwd")).toThrow("outside");
		expect(() => resolveInside(root, join(outside, "secret.txt"))).toThrow("outside");
		expect(() => resolveInside(root, "link/secret.txt")).toThrow("outside");
		expect(() => resolveInside(root, ".")).toThrow("outside");
	});

	test("resolveFrame returns the relative path", () => {
		expect(resolveFrame(root, join(root, "a.html")).path).toBe("a.html");
		expect(() => resolveFrame(root, "missing.html")).toThrow("No such frame");
	});

	test("server serves project files only", async () => {
		const html = await (await fetch(`${server.url}/a.html`)).text();
		expect(html).toContain("<svg");
		expect(await (await fetch(`${server.url}/style.css`)).text()).toBe("body{color:red}");
		const escapes = [
			"/link/secret.txt",
			"/..%2Fsecret.txt",
			"/%2e%2e/secret.txt",
			"/.renders/a.html.png",
		];
		for (const path of escapes) {
			expect((await fetch(`${server.url}${path}`)).status).toBe(404);
		}
		expect((await fetch(`${server.url}/`)).status).toBe(404);
	});
});

const chrome = findChrome();

describe.skipIf(chrome === undefined)("render", () => {
	const renderer = new ChromeRenderer();
	afterAll(async () => {
		await renderer.close();
	});

	test("renders a frame at its viewport width with full height", async () => {
		writeFileSync(
			join(root, "frame.html"),
			`<!doctype html><meta name="viewport" content="width=400">
			<body style="margin:0"><div id="box" style="height:700px;background:#39f;font-size:40px">
			<i data-icon="heart" data-weight="fill"></i><i data-icon="nope"></i>
			<img src="missing.png"></div></body>`,
		);
		const result = await renderer.render({ url: `${server.url}/frame.html`, width: 400 });
		expect(result.png.subarray(1, 4).toString()).toBe("PNG");
		expect(result.frame).toEqual({ width: 400, height: 700 });
		expect(result.output).toEqual({ width: 400, height: 700 });
		expect(result.warnings.some((w) => w.includes("404") && w.includes("missing.png"))).toBe(true);
		expect(server.takeWarnings("frame.html")).toEqual([expect.stringContaining("nope")]);

		const element = await renderer.render({
			url: `${server.url}/frame.html`,
			width: 400,
			selector: "#box",
		});
		expect(element.frame).toEqual({ width: 400, height: 700 });
		await expect(
			renderer.render({ url: `${server.url}/frame.html`, width: 400, selector: "#nope" }),
		).rejects.toThrow("No element");
	}, 60_000);
});
