import { selfMcpServer } from "@paper-execute/agent-team";
import type { DesignBackend } from "#/backend";
import { paperBackend } from "#/backend/paper";
import type { DesignerLaunch } from "#/designer/launch";
import { materializePaperRefsPlugin } from "#/designer/paper-refs";
import { buildServerInstructions } from "#/mcp/instructions";
import type { BootedPlugins } from "#/plugin/boot";

export function executorLaunch(backend: DesignBackend, booted: BootedPlugins): DesignerLaunch {
	return {
		name: backend.name,
		slug: backend.slug,
		tools: `mcp__${backend.slug}__execute`,
		mcpServer: selfMcpServer([...backend.cliPath, "mcp"]),
		instructions: buildServerInstructions(booted.registry.instructionsText, backend),
		pluginDirs: backend === paperBackend ? [materializePaperRefsPlugin()] : [],
		addDirs: [],
		agents: {},
		env: {},
	};
}
