import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { designerAssets } from "./embedded.ts";

export function materializePaperRefsPlugin(): string {
	const hash = Bun.hash(JSON.stringify(designerAssets.pluginFiles)).toString(36);
	const root = join(tmpdir(), "designer");
	const target = join(root, `paper-refs-${hash}`);
	if (existsSync(target)) return target;

	mkdirSync(root, { recursive: true });
	const staging = join(root, `.staging-${process.pid}-${Date.now()}`);
	try {
		for (const [path, content] of Object.entries(designerAssets.pluginFiles)) {
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
