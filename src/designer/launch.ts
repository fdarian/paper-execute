export interface DesignerLaunch {
	readonly name: string;
	readonly slug: string;
	/** Fills `{{tools}}` in the shared agent prompt: where and how the designer works. */
	readonly tools: string;
	/** Arguments of this program that start the surface's MCP server. */
	readonly mcpArgs: readonly string[];
	/** Appended to both agent prompts, because subagents don't receive MCP server instructions. */
	readonly instructions: string;
	readonly pluginDirs: readonly string[];
	readonly addDirs: readonly string[];
	/** Restricts the designer subagent; the director is never restricted. */
	readonly designerTools?: readonly string[];
}
