import { Effect } from "effect";

import { discoverPluginConfig } from "#/plugin/config";
import { loadPlugins } from "#/plugin/loader";
import { createPluginRegistry } from "#/plugin/registry";

// Config discovery + plugin loading + registry, with no executor or Paper connection,
// so `designer cc` can read the same plugin instructions the MCP server will serve.
export function bootPluginRegistry() {
	return Effect.gen(function* () {
		const discovered = yield* discoverPluginConfig();
		const plugins = yield* loadPlugins(discovered.config.plugins);
		const registry = yield* createPluginRegistry(plugins);
		return { config: discovered.config, registry };
	});
}
