import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Bun macro: runs at bundle/load time so the compiled binary carries the files and works offline.
export function readAtlasViewAssets(): { page: string; cytoscape: string } {
	// cytoscape's `exports` map hides dist/cytoscape.min.js from resolution, so go through package.json.
	const cytoscapeDir = dirname(Bun.resolveSync("cytoscape/package.json", import.meta.dir));
	return {
		page: readFileSync(join(import.meta.dir, "../../assets/atlas-view/index.html"), "utf8"),
		cytoscape: readFileSync(join(cytoscapeDir, "dist/cytoscape.min.js"), "utf8"),
	};
}
