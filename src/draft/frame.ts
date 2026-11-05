import { realpathSync, statSync } from "node:fs";
import { relative, sep } from "node:path";

import { resolveInside } from "@paper-execute/draft-project";

export const defaultViewportWidth = 1440;

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
