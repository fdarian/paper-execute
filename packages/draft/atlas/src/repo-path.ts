import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { AtlasInvalid } from "./errors.ts";

export type RepoPath = {
	/** Repo-relative, POSIX separators: what the db stores. */
	readonly stored: string;
	readonly absolute: string;
};

/** Accepts a repo-relative or absolute path; rejects anything that lands outside `repo`. */
export function repoPath(repo: string, input: string, options: { mustExist: boolean }): RepoPath {
	const lexical = isAbsolute(input) ? resolve(input) : resolve(repo, input);
	const exists = existsSync(lexical);
	if (options.mustExist && !exists) {
		throw new AtlasInvalid({ reason: `${input} does not exist in the repo ${repo}` });
	}
	const absolute = exists ? realpathSync(lexical) : lexical;
	const rel = relative(repo, absolute);
	if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
		throw new AtlasInvalid({ reason: `${input} is outside the repo ${repo}` });
	}
	if (exists && options.mustExist && !statSync(absolute).isFile()) {
		throw new AtlasInvalid({ reason: `${input} is not a file` });
	}
	return { stored: rel.split(sep).join("/"), absolute };
}

export function assertContainsSymbol(file: RepoPath, symbol: string): void {
	const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const wholeWord = new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`);
	if (!wholeWord.test(readFileSync(file.absolute, "utf8"))) {
		throw new AtlasInvalid({ reason: `${file.stored} does not contain the symbol "${symbol}"` });
	}
}
