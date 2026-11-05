import { type AgentTeam, selfMcpServer } from "@paper-execute/agent-team";

import { designerAssets } from "./embedded.ts";
import type { DesignerLaunch } from "./launch.ts";

// Agent prompts replace the system prompt and subagents don't receive MCP server instructions,
// so both agents carry the server instructions themselves.
export function designerTeam(launch: DesignerLaunch): AgentTeam {
	const fill = (template: string) =>
		template
			.replaceAll("{{name}}", launch.name)
			.replaceAll("{{slug}}", launch.slug)
			.replaceAll("{{tools}}", launch.tools);
	const collision = Object.keys(launch.agents).find(
		(name) => name === "director" || name === "designer",
	);
	if (collision !== undefined)
		throw new Error(`Launch agent "${collision}" collides with a built-in agent`);
	return {
		agents: {
			director: {
				description: `Directs design work in ${launch.name} through the designer subagent.`,
				model: "opus",
				prompt: `${fill(designerAssets.agentPrompt)}\n\n${fill(designerAssets.directorPrompt)}\n\n${launch.instructions}`,
			},
			designer: {
				description: `Executes a design brief in ${launch.name} and reports back with a screenshot path.`,
				model: "haiku",
				// The minimum the CLI accepts; keeps a long-lived designer's context small.
				autoCompactWindow: 100_000,
				prompt: `${fill(designerAssets.agentPrompt)}\n\n${fill(designerAssets.designerPrompt)}\n\n${launch.instructions}`,
				...(launch.designerTools === undefined ? {} : { tools: [...launch.designerTools] }),
			},
			...launch.agents,
		},
		main: "director",
		mcpServers: { [launch.slug]: selfMcpServer(launch.mcpArgs) },
		pluginDirs: launch.pluginDirs,
		addDirs: launch.addDirs,
		enabledPlugins: { "frontend-design@claude-plugins-official": true },
		env: launch.env,
	};
}
