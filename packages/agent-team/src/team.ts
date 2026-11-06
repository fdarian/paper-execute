export interface AgentDefinition {
	readonly description: string;
	readonly model: string;
	/** Already filled: the launcher does no templating. */
	readonly prompt: string;
	readonly tools?: string[];
	readonly skills?: string[];
	readonly autoCompactWindow?: number;
}

export interface StdioMcpServer {
	readonly type: "stdio";
	readonly command: string;
	readonly args: string[];
	readonly alwaysLoad: true;
}

export interface AgentTeam {
	readonly agents: Readonly<Record<string, AgentDefinition>>;
	/** Name of the agent passed to `--agent`; it must be a key of `agents`. */
	readonly main: string;
	readonly mcpServers: Readonly<Record<string, StdioMcpServer>>;
	readonly pluginDirs: readonly string[];
	readonly addDirs: readonly string[];
	/** Always enabled in the session; wins over the user's and `cc.settings` entries. */
	readonly enabledPlugins: Readonly<Record<string, boolean>>;
	/** Added to the environment of the Claude Code process. */
	readonly env: Readonly<Record<string, string>>;
}

export function mainAgent(team: AgentTeam): AgentDefinition {
	const agent = team.agents[team.main];
	if (agent === undefined) {
		throw new Error(`Main agent "${team.main}" is not defined in the team's agents.`);
	}
	return agent;
}
