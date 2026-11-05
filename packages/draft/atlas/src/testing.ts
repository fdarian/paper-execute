import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";

import { Atlas, initAtlas } from "./atlas.ts";

const SOURCE = "export function renderWidget() {\n\treturn 1;\n}\n";

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(
		[
			"git",
			"-c",
			"user.name=test",
			"-c",
			"user.email=test@example.com",
			"-c",
			"commit.gpgsign=false",
			...args,
		],
		{ cwd, stdout: "pipe", stderr: "pipe" },
	);
	if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
}

export type TestEnv = {
	readonly root: string;
	readonly repo: string;
	readonly dir: string;
	readonly options: { readonly project: string; readonly dir: string };
	readonly cleanup: () => void;
};

/** A temp git repo with one commit (`src/widget.ts`, symbol `renderWidget`) plus an empty project dir. */
export function createTestEnv(): TestEnv {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "draft-atlas-")));
	const repo = join(root, "repo");
	const dir = join(root, "data", "projects", "demo");
	mkdirSync(join(repo, "src"), { recursive: true });
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(repo, "src", "widget.ts"), SOURCE);
	writeFileSync(join(repo, "README.md"), "# demo\n");
	git(repo, "init", "-q");
	git(repo, "add", ".");
	git(repo, "commit", "-q", "-m", "init");
	return {
		root,
		repo,
		dir,
		options: { project: "demo", dir },
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

export function headOf(repo: string): string {
	return Bun.spawnSync(["git", "-C", repo, "rev-parse", "HEAD"]).stdout.toString().trim();
}

export function initTestAtlas(env: TestEnv): Promise<void> {
	return Effect.runPromise(
		Effect.scoped(initAtlas({ ...env.options, repo: env.repo })).pipe(Effect.asVoid),
	);
}

export function withAtlas<A, E>(env: TestEnv, effect: Effect.Effect<A, E, Atlas>): Promise<A> {
	return Effect.runPromise(effect.pipe(Effect.provide(Atlas.layer(env.options))));
}

export function withReadonlyAtlas<A, E>(
	env: TestEnv,
	effect: Effect.Effect<A, E, Atlas>,
): Promise<A> {
	return Effect.runPromise(effect.pipe(Effect.provide(Atlas.layerReadonly(env.options))));
}

export function failureOf<A, E>(env: TestEnv, effect: Effect.Effect<A, E, Atlas>): Promise<E> {
	return Effect.runPromise(Effect.flip(effect).pipe(Effect.provide(Atlas.layer(env.options))));
}
