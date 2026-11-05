import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAIN = join(import.meta.dir, "main.ts");

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(
		["git", "-c", "user.name=test", "-c", "user.email=test@example.com", ...args],
		{ cwd, stdout: "pipe", stderr: "pipe" },
	);
	if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
}

type Run = { readonly stdout: string; readonly stderr: string; readonly exitCode: number };

describe("draft atlas", () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "draft-cli-")));
	const repo = join(root, "repo");
	const data = join(root, "data");

	const draft = (...args: string[]): Run => {
		const result = Bun.spawnSync(["bun", MAIN, ...args], {
			cwd: repo,
			env: { ...process.env, DRAFT_DATA_DIR: data },
			stdout: "pipe",
			stderr: "pipe",
		});
		return {
			stdout: result.stdout.toString(),
			stderr: result.stderr.toString(),
			exitCode: result.exitCode,
		};
	};
	const atlas = (project: string, ...args: string[]) =>
		draft("atlas", "--project", project, ...args);

	beforeAll(() => {
		mkdirSync(join(repo, "src"), { recursive: true });
		writeFileSync(join(repo, "src", "widget.ts"), "export function renderWidget() {}\n");
		git(repo, "init", "-q");
		git(repo, "add", ".");
		git(repo, "commit", "-q", "-m", "init");
	});

	afterAll(() => rmSync(root, { recursive: true, force: true }));

	test("fails with the init hint and exit 1 before init", () => {
		const result = atlas("fresh", "list");
		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toBe(
			'error: No atlas for project "fresh". Run `draft atlas --project fresh init --repo <repo>` first.\n',
		);
	});

	test("init, write, show and list", () => {
		const init = atlas("demo", "init", "--repo", repo);
		expect(init.exitCode).toBe(0);
		expect(init.stdout).toBe(
			`atlas demo · repo ${repo} · ${join(data, "projects", "demo", "common", "atlas.db")}\n`,
		);

		const created = atlas("demo", "feature", "set", "lead-status", "--summary", "Track leads");
		expect(created.stdout).toBe("feature lead-status created\n");

		const added = atlas("demo", "feature", "add", "lead-source", "--summary", "Track lead sources");
		expect(added.stdout).toBe("feature lead-source created\n");
		const duplicate = atlas("demo", "feature", "add", "lead-source", "--summary", "Other");
		expect(duplicate.exitCode).toBe(1);
		expect(duplicate.stderr).toContain(
			'feature "lead-source" already exists (under root): Track lead sources.',
		);
		expect(atlas("demo", "feature", "rm", "lead-source").exitCode).toBe(0);

		const alias = atlas("demo", "alias", "add", "lead-status", "status pill", "--source", "ui");
		expect(alias.stdout).toBe('alias "status pill" → lead-status\n');

		const code = atlas(
			"demo",
			"code",
			"add",
			"lead-status",
			"src/widget.ts",
			"--symbol",
			"renderWidget",
		);
		expect(code.stdout).toBe("code src/widget.ts#renderWidget → lead-status\n");

		const text = atlas("demo", "show", "status pill");
		expect(text.exitCode).toBe(0);
		expect(text.stdout).toContain("lead-status · seeded");
		expect(text.stdout).toContain(`${join(repo, "src", "widget.ts")}#renderWidget`);

		const shown = JSON.parse(atlas("demo", "show", "lead-status", "--json").stdout);
		expect(shown.results[0].feature.name).toBe("lead-status");

		expect(atlas("demo", "list").stdout).toContain("lead-status");
		const listed = JSON.parse(atlas("demo", "list", "--json").stdout);
		expect(listed.rows.map((row: { name: string }) => row.name)).toEqual(["lead-status"]);
	});

	test("rejects --parent together with --root", () => {
		const result = atlas(
			"demo",
			"feature",
			"set",
			"x",
			"--summary",
			"s",
			"--parent",
			"a",
			"--root",
		);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe("error: --parent and --root cannot be used together\n");
	});

	test("sql reads but refuses writes", () => {
		const read = atlas("demo", "sql", "SELECT name FROM feature", "--json");
		expect(JSON.parse(read.stdout)).toEqual({ columns: ["name"], rows: [["lead-status"]] });

		const write = atlas("demo", "sql", "DELETE FROM feature");
		expect(write.exitCode).toBe(1);
		expect(write.stderr).toStartWith("error: ");
		expect(atlas("demo", "list", "--json").stdout).toContain("lead-status");
	});
});
