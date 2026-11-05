import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// Bun macro: runs at bundle/load time so the compiled binary carries the file contents.
const assetsDir = join(import.meta.dir, "../../assets/cartographer");

export function readCartographerAssets(): {
	shared: string;
	cartographer: string;
	surveyor: string;
	survey: string;
	pluginFiles: Record<string, string>;
} {
	const pluginDir = join(assetsDir, "plugin");
	const pluginFiles: Record<string, string> = {};
	for (const entry of readdirSync(pluginDir, { recursive: true, withFileTypes: true })) {
		if (!entry.isFile()) continue;
		const path = join(entry.parentPath, entry.name);
		pluginFiles[relative(pluginDir, path)] = readFileSync(path, "utf8");
	}
	return {
		shared: readFileSync(join(assetsDir, "shared.md"), "utf8"),
		cartographer: readFileSync(join(assetsDir, "cartographer.md"), "utf8"),
		surveyor: readFileSync(join(assetsDir, "surveyor.md"), "utf8"),
		survey: readFileSync(join(assetsDir, "survey.md"), "utf8"),
		pluginFiles,
	};
}
