import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

export function dataDir(): string {
	const override = process.env.DRAFT_DATA_DIR;
	if (override !== undefined && override.length > 0) return resolve(override);
	return join(homedir(), ".config", "draft");
}

export function projectsRoot(): string {
	return join(dataDir(), "projects");
}

export function defaultProjectName(cwd: string): string {
	const git = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
		cwd,
		stdout: "pipe",
		stderr: "ignore",
	});
	if (git.exitCode === 0) return basename(git.stdout.toString().trim());
	return basename(cwd);
}

export function projectDir(name: string): string {
	if (name.length === 0 || name.includes("/") || name.startsWith(".")) {
		throw new Error(`Invalid project name "${name}"`);
	}
	const dir = join(projectsRoot(), name);
	mkdirSync(dir, { recursive: true });
	return dir;
}

export type ProjectLayout = {
	readonly common: string;
	readonly atlasDb: string;
	readonly refs: string;
	readonly tokens: string;
};

export function projectLayout(dir: string): ProjectLayout {
	return {
		common: join(dir, "common"),
		atlasDb: join(dir, "common", "atlas.db"),
		refs: join(dir, "common", "refs"),
		tokens: join(dir, "common", "styles", "tokens.css"),
	};
}

/**
 * Resolves `requested` (relative to `root`, or absolute) to a path inside `root`.
 * Throws when it escapes, including through symlinks that already exist on disk.
 */
export function resolveInside(root: string, requested: string): string {
	const realRoot = realpathSync(root);
	const lexical = isAbsolute(requested) ? resolve(requested) : resolve(realRoot, requested);
	const target = existsSync(lexical) ? realpathSync(lexical) : lexical;
	const rel = relative(realRoot, target);
	if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
		throw new Error(`Path "${requested}" is outside the project folder`);
	}
	return target;
}
