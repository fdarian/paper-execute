import type { AtlasOptions } from "@paper-execute/draft-atlas";
import { type CartographerInputs, cartographerSubagent } from "@paper-execute/draft-cartographer";
import { dataDir } from "@paper-execute/draft-project";
import type { DesignerLaunch } from "#/designer/launch";
import { draftInstructions } from "./instructions.ts";

const atlasInstructions = (repo: string) => `## Atlas

This project has an atlas: a map of the product's features with code pointers into \`${repo}\`, kept by the \`cartographer\` subagent.

- Director: ask the cartographer about the product (what a feature does, its states, where its code is) instead of searching the repo yourself. When the user or a designer says the atlas is wrong or missing something, send the cartographer what they noticed and let it fix the entry.
- Designer: you don't use the atlas directly. When what you were told about the product contradicts the code you read, tell the director.`;

export function draftLaunch(
	project: AtlasOptions,
	atlas: CartographerInputs | undefined,
): DesignerLaunch {
	const dir = project.dir;
	const base = `${draftInstructions}\n\nProject folder (absolute): ${dir}`;
	return {
		name: "Draft",
		slug: "draft",
		tools: `HTML files in ${dir} rendered with mcp__draft__render`,
		mcpArgs: ["draft", "mcp", "--dir", dir],
		instructions: atlas === undefined ? base : `${base}\n\n${atlasInstructions(atlas.repo)}`,
		pluginDirs: [],
		addDirs: atlas === undefined ? [dir] : [dir, atlas.repo],
		agents: atlas === undefined ? {} : { cartographer: cartographerSubagent(atlas) },
		// Absolute, so a subagent that cds elsewhere still reaches the same atlas.
		env: atlas === undefined ? {} : { DRAFT_DATA_DIR: dataDir() },
		designerTools: ["Read", "Write", "Edit", "Glob", "Grep", "mcp__draft__render"],
	};
}
