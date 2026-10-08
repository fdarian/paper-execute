import { createExecutionEngine } from "@executor-js/execution/core";
import { type McpPluginExtension, mcpPlugin } from "@executor-js/plugin-mcp/core";
import { makeQuickJsExecutor } from "@executor-js/runtime-quickjs";
import {
	AuthTemplateSlug,
	ConnectionName,
	type CredentialProvider,
	createExecutor,
	IntegrationSlug,
	type ProviderItemId,
	ProviderKey,
	Tenant,
} from "@executor-js/sdk/core";
import { Effect } from "effect";

import { PaperExecutorError } from "#/errors";
import { bootPluginRegistry } from "#/plugin/boot";
import type { PaperPluginRegistry } from "#/plugin/registry";

const defaultPaperMcpUrl = "http://127.0.0.1:29979/mcp";

/**
 * A connection stores its value in a writable credential provider — even a
 * no-auth ("none" template) connection needs one registered, or
 * `connections.create` fails with CredentialProviderNotRegisteredError. This
 * in-memory store is enough for a local MCP process (each build owns its Map).
 */
function makeMemoryCredentialProvider(): CredentialProvider {
	const store = new Map<string, string>();
	return {
		key: ProviderKey.make("memory"),
		writable: true,
		get: (id: ProviderItemId) => Effect.sync(() => store.get(String(id)) ?? null),
		set: (id: ProviderItemId, value: string) =>
			Effect.sync(() => {
				store.set(String(id), value);
			}),
	};
}

export type PaperExecutionRuntime = {
	readonly engine: ReturnType<typeof createExecutionEngine>;
	readonly pluginRegistry: PaperPluginRegistry;
};

export function buildExecutionEngine() {
	return Effect.gen(function* () {
		const booted = yield* bootPluginRegistry();
		const pluginConfig = booted.config;
		const pluginRegistry = booted.registry;
		const paperMcpUrl = pluginConfig.paperMcpUrl ?? process.env.PAPER_MCP_URL ?? defaultPaperMcpUrl;
		const executor = yield* createExecutor({
			tenant: Tenant.make("paper-execute"),
			plugins: [mcpPlugin(), pluginRegistry.executorPlugin()],
			providers: [makeMemoryCredentialProvider()],
			onElicitation: "accept-all",
		});

		// The published `/core` types expose plugin extensions loosely (`executor.mcp` is `any`),
		// which would poison the generator's error/requirement channels. Pin the real extension type.
		const mcp: McpPluginExtension = executor.mcp;

		yield* Effect.gen(function* () {
			const paper = yield* mcp.addServer({
				transport: "remote",
				name: "Paper",
				endpoint: paperMcpUrl,
				slug: "paper",
			});
			yield* executor.connections.create({
				owner: "org",
				name: ConnectionName.make("default"),
				integration: IntegrationSlug.make(paper.slug),
				template: AuthTemplateSlug.make("none"),
				inputs: {},
			});
		}).pipe(
			Effect.catchCause((cause) =>
				Effect.logWarning(
					"Paper MCP wiring failed at boot; paper.* calls will fail until Paper is reachable",
					cause,
				),
			),
		);

		return {
			engine: createExecutionEngine({
				executor,
				codeExecutor: makeQuickJsExecutor({ timeoutMs: 30_000 }),
			}),
			pluginRegistry,
		};
	}).pipe(
		Effect.mapError(
			(cause) => new PaperExecutorError({ reason: "Failed to build execution engine", cause }),
		),
	);
}
