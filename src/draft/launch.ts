import type { DesignerLaunch } from "#/designer/launch";
import { draftInstructions } from "./instructions.ts";
import { defaultProjectName, projectDir } from "./project.ts";

export function draftLaunch(project: string | undefined): DesignerLaunch {
	const dir = projectDir(project ?? defaultProjectName(process.cwd()));
	return {
		name: "Draft",
		slug: "draft",
		tools: `HTML files in ${dir} rendered with mcp__draft__render`,
		mcpArgs: ["draft", "mcp", "--dir", dir],
		instructions: `${draftInstructions}\n\nProject folder (absolute): ${dir}`,
		pluginDirs: [],
		addDirs: [dir],
		designerTools: ["Read", "Write", "Edit", "Glob", "Grep", "mcp__draft__render"],
	};
}
