import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// Bun macro: runs at bundle/load time so the compiled binary carries the file contents.
const assetsDir = join(import.meta.dir, "../../assets/designer");

export function readDesignerAssets(): {
	agentPrompt: string;
	designerPrompt: string;
	directorPrompt: string;
	pluginFiles: Record<string, string>;
} {
	const pluginDir = join(assetsDir, "paper-refs");
	const pluginFiles: Record<string, string> = {};
	for (const entry of readdirSync(pluginDir, { recursive: true, withFileTypes: true })) {
		if (!entry.isFile()) continue;
		const path = join(entry.parentPath, entry.name);
		pluginFiles[relative(pluginDir, path)] = readFileSync(path, "utf8");
	}
	return {
		agentPrompt: readFileSync(join(assetsDir, "agent.md"), "utf8"),
		designerPrompt: readFileSync(join(assetsDir, "designer.md"), "utf8"),
		directorPrompt: readFileSync(join(assetsDir, "director.md"), "utf8"),
		pluginFiles,
	};
}
