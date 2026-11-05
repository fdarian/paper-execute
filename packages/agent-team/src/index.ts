export { redirectConsoleToStderr, runAcp } from "./acp.ts";
export { buildClaudeArgs, type ClaudeArgsOptions, runClaude } from "./claude-code.ts";
export {
	type AgentTeamConfig,
	decodeAgentTeamConfig,
	discoverAgentTeamConfig,
	type InheritSettings,
} from "./config.ts";
export { AgentTeamConfigError } from "./errors.ts";
export { cacheTtlFlag, ccFlags } from "./flags.ts";
export { materializePlugin } from "./materialize-plugin.ts";
export { selfCommand, selfMcpServer } from "./self-command.ts";
export {
	buildSettings,
	type CacheTtl,
	loadTeamSettings,
	type TeamSettings,
	teamSettings,
} from "./settings.ts";
export {
	type AgentDefinition,
	type AgentTeam,
	mainAgent,
	type StdioMcpServer,
} from "./team.ts";
