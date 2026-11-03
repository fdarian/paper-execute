import type { PaperPluginConfig } from "#/plugin/config";

export interface DesignBackend {
	readonly name: string;
	/** Executor integration slug and the sandbox global (`paper.<tool>(args)`). */
	readonly slug: string;
	readonly defaultMcpUrl: string;
	readonly mcpUrlEnv: string;
	readonly mcpUrl: (config: PaperPluginConfig) => string | undefined;
	/** CLI subcommands that lead to this backend's `mcp` command. */
	readonly cliPath: readonly string[];
	readonly instructions: string;
}

export function resolveMcpUrl(backend: DesignBackend, config: PaperPluginConfig): string {
	return backend.mcpUrl(config) ?? process.env[backend.mcpUrlEnv] ?? backend.defaultMcpUrl;
}

export function callingInstructions(backend: Pick<DesignBackend, "name" | "slug">): string {
	return `Inside \`execute\`, call ${backend.name} APIs with \`await ${backend.slug}.<tool>(args)\`. ${backend.name} calls throw on failure and return structuredContent when present; otherwise, nonempty all-text content whose blocks each parse as JSON objects with no shared keys returns their shallow merge (including a single JSON-object block). Invalid JSON, arrays/null/primitives, key collisions, or non-text blocks fall back to a string for exactly one text item, otherwise the unchanged content array. There is no \`.content\` wrapper. Plugin calls return their bare data and throw on failure; use raw \`tools.*\` only for the executor workflow below.`;
}
