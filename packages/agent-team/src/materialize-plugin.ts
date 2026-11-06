import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Writes an embedded plugin to `$TMPDIR/<name>-<content hash>` once and returns that directory. */
export function materializePlugin(name: string, files: Readonly<Record<string, string>>): string {
	const hash = Bun.hash(JSON.stringify(files)).toString(36);
	const root = tmpdir();
	const target = join(root, `${name}-${hash}`);
	if (existsSync(target)) return target;

	mkdirSync(root, { recursive: true });
	const staging = join(root, `.staging-${name}-${process.pid}-${Date.now()}`);
	try {
		for (const [path, content] of Object.entries(files)) {
			const file = join(staging, path);
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, content);
		}
		try {
			renameSync(staging, target);
		} catch (cause) {
			// A concurrent launcher may have won the rename; its copy is identical.
			if (!existsSync(target)) throw cause;
		}
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}
	return target;
}
