import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

export const defaultViewportWidth = 1440;

function dataDir(): string {
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

/** Resolves a frame to its project-relative POSIX path and absolute path; the file must exist. */
export function resolveFrame(
	root: string,
	requested: string,
): { readonly path: string; readonly absolute: string } {
	const absolute = resolveInside(root, requested);
	if (!statSync(absolute, { throwIfNoEntry: false })?.isFile()) {
		throw new Error(`No such frame: ${requested}`);
	}
	return { path: relative(realpathSync(root), absolute).split(sep).join("/"), absolute };
}

export function parseViewportWidth(html: string): number {
	for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
		const attrs = tag[0];
		if (!/\bname\s*=\s*["']?viewport["']?/i.test(attrs)) continue;
		const content = /\bcontent\s*=\s*(["'])(.*?)\1/i.exec(attrs);
		const value = content?.[2];
		if (value === undefined) continue;
		const width = /(?:^|[,;\s])width\s*=\s*(\d+)/i.exec(value);
		if (width !== null) return Number(width[1]);
	}
	return defaultViewportWidth;
}
