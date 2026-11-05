import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAIN = join(import.meta.dir, "../main.ts");

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(
		["git", "-c", "user.name=test", "-c", "user.email=test@example.com", ...args],
		{ cwd, stdout: "pipe", stderr: "pipe" },
	);
	if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
}

describe("draft atlas view", () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "draft-view-")));
	const repo = join(root, "repo");
	const env = { ...process.env, DRAFT_DATA_DIR: join(root, "data") };
	let viewer: Bun.Subprocess<"ignore", "pipe", "pipe">;
	let url: string;

	const atlas = (...args: string[]) => {
		const result = Bun.spawnSync(["bun", MAIN, "atlas", "--project", "demo", ...args], {
			cwd: repo,
			env,
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0) throw new Error(`atlas ${args.join(" ")}: ${result.stderr}`);
	};

	beforeAll(async () => {
		mkdirSync(join(repo, "src"), { recursive: true });
		writeFileSync(join(repo, "src", "widget.ts"), "export function renderWidget() {}\n");
		git(repo, "init", "-q");
		git(repo, "add", ".");
		git(repo, "commit", "-q", "-m", "init");
		atlas("init", "--repo", repo);
		atlas("feature", "add", "scout", "--summary", "Find leads");
		atlas("feature", "add", "lead-status", "--summary", "Track leads", "--parent", "scout");
		atlas("code", "add", "lead-status", "src/widget.ts", "--symbol", "renderWidget");

		viewer = Bun.spawn(["bun", MAIN, "atlas", "--project", "demo", "view", "--port", "0"], {
			cwd: repo,
			env,
			stdout: "pipe",
			stderr: "pipe",
		});
		const reader = viewer.stdout.getReader();
		const first = await reader.read();
		reader.releaseLock();
		url = new TextDecoder().decode(first.value).trim();
	});

	afterAll(() => {
		viewer.kill();
		rmSync(root, { recursive: true, force: true });
	});

	test("serves the atlas export, the page and cytoscape", async () => {
		expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

		const atlasResponse = await fetch(`${url}/api/atlas`);
		expect(atlasResponse.status).toBe(200);
		const exported = await atlasResponse.json();
		expect(exported.project).toBe("demo");
		expect(exported.repo).toBe(repo);
		expect(exported.features.map((feature: { name: string }) => feature.name)).toEqual([
			"lead-status",
			"scout",
		]);
		expect(exported.features[0].code).toEqual([
			{ path: "src/widget.ts", absolute: join(repo, "src/widget.ts"), symbol: "renderWidget" },
		]);

		const page = await fetch(url);
		expect(page.headers.get("content-type")).toContain("text/html");
		expect(await page.text()).toContain("<title>Atlas</title>");

		const cytoscape = await fetch(`${url}/cytoscape.js`);
		expect(cytoscape.headers.get("content-type")).toContain("javascript");
		expect((await cytoscape.text()).length).toBeGreaterThan(100_000);

		expect((await fetch(`${url}/nope`)).status).toBe(404);
	});

	test("announces atlas writes on the event stream", async () => {
		const events = await fetch(`${url}/__events`);
		const reader = events.body?.getReader();
		if (reader === undefined) throw new Error("no event stream body");
		const decoder = new TextDecoder();

		atlas("feature", "add", "thumbs-feedback", "--summary", "Rate leads");

		let received = "";
		const deadline = Date.now() + 5000;
		while (!received.includes("event: change") && Date.now() < deadline) {
			const chunk = await reader.read();
			if (chunk.done) break;
			received += decoder.decode(chunk.value);
		}
		await reader.cancel();
		expect(received).toContain("event: change");

		const exported = await (await fetch(`${url}/api/atlas`)).json();
		expect(exported.features).toHaveLength(3);
	});
});

describe("draft atlas view without an atlas", () => {
	test("fails with the init hint", () => {
		const root = realpathSync(mkdtempSync(join(tmpdir(), "draft-view-")));
		try {
			const result = Bun.spawnSync(["bun", MAIN, "atlas", "--project", "fresh", "view"], {
				cwd: root,
				env: { ...process.env, DRAFT_DATA_DIR: root },
				stdout: "pipe",
				stderr: "pipe",
			});
			expect(result.exitCode).toBe(1);
			expect(result.stderr.toString()).toBe(
				'error: No atlas for project "fresh". Run `draft atlas --project fresh init --repo <repo>` first.\n',
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
