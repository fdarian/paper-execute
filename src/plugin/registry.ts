import { definePlugin, tool } from "@executor-js/sdk/core";
import { Effect } from "effect";

import { PaperPluginRegistryError } from "#/errors";
import type { PaperPlugin, PaperPluginLeaf, PaperPluginToolNode } from "#/plugin/define";
import { makeInputSchema, makeOutputSchema } from "#/plugin/schema";

type PaperPluginLeafRegistration = {
	readonly pluginName: string;
	readonly path: readonly string[];
	readonly internalName: string;
	readonly inputSchema: ReturnType<typeof makeInputSchema>;
	readonly outputSchema: ReturnType<typeof makeOutputSchema>;
	readonly execute: PaperPluginLeaf["execute"];
};

export type PaperPluginRegistry = {
	readonly instructionsText: string;
	readonly callsSummary: string;
	readonly preambleSource: string;
	readonly executorPlugin: ReturnType<typeof buildRegistryExecutorPlugin>;
};

export function createPluginRegistry(
	plugins: readonly PaperPlugin[],
): Effect.Effect<PaperPluginRegistry, PaperPluginRegistryError> {
	return Effect.gen(function* () {
		const leaves = yield* collectLeaves(plugins);
		return {
			instructionsText: buildInstructionsText(plugins, leaves),
			callsSummary: buildCallsSummary(leaves),
			preambleSource: buildPreambleSource(leaves),
			executorPlugin: buildRegistryExecutorPlugin(leaves),
		};
	});
}

function collectLeaves(
	plugins: readonly PaperPlugin[],
): Effect.Effect<readonly PaperPluginLeafRegistration[], PaperPluginRegistryError> {
	return Effect.forEach(plugins, (plugin) => collectPluginLeaves(plugin)).pipe(
		Effect.map((groups) => groups.flat()),
	);
}

function collectPluginLeaves(
	plugin: PaperPlugin,
): Effect.Effect<readonly PaperPluginLeafRegistration[], PaperPluginRegistryError> {
	return walkToolNode(plugin, [], plugin.tools);
}

function walkToolNode(
	plugin: PaperPlugin,
	path: readonly string[],
	node: Record<string, PaperPluginToolNode> | PaperPluginToolNode,
): Effect.Effect<readonly PaperPluginLeafRegistration[], PaperPluginRegistryError> {
	if (isLeaf(node)) {
		if (path.length === 0) {
			return Effect.fail(
				new PaperPluginRegistryError({
					plugin: plugin.name,
					path: [],
					reason: "Leaf tools must live under a named path",
				}),
			);
		}
		return Effect.succeed([
			{
				pluginName: plugin.name,
				path,
				internalName: makeInternalName(plugin.name, path),
				inputSchema: makeInputSchema(node.input),
				outputSchema: makeOutputSchema(node.output),
				execute: node.execute,
			},
		]);
	}
	return Effect.forEach(Object.entries(node), (entry) =>
		walkToolNode(plugin, [...path, entry[0]], entry[1]),
	).pipe(Effect.map((groups) => groups.flat()));
}

function buildRegistryExecutorPlugin(leaves: readonly PaperPluginLeafRegistration[]) {
	return definePlugin(() => ({
		id: "paper-plugin-tools" as const,
		packageName: "paper-execute",
		storage: () => ({}),
		extension: () => ({}),
		staticIntegrations: () => [
			{
				id: "paperPluginTools",
				kind: "custom",
				name: "Paper Plugin Tools",
				tools: leaves.map((leaf) =>
					tool({
						name: leaf.internalName,
						description: `Plugin tool plugins.${leaf.pluginName}.${leaf.path.join(".")}`,
						inputSchema: leaf.inputSchema,
						outputSchema: leaf.outputSchema,
						execute: (input: unknown) => normalizeExecute(leaf.execute, input),
					}),
				),
			},
		],
	}));
}

function buildPreambleSource(leaves: readonly PaperPluginLeafRegistration[]): string {
	const lines = ["const plugins = globalThis.plugins ?? (globalThis.plugins = {});"];
	for (const leaf of leaves) {
		lines.push(...buildLeafPreambleLines(leaf));
	}
	return lines.join("\n");
}

function buildLeafPreambleLines(leaf: PaperPluginLeafRegistration): readonly string[] {
	const rootAccessor = `plugins.${leaf.pluginName}`;
	const lines = [`${rootAccessor} = ${rootAccessor} ?? {};`];
	let currentAccessor = rootAccessor;
	for (let index = 0; index < leaf.path.length - 1; index += 1) {
		const segment = leaf.path[index];
		currentAccessor = `${currentAccessor}.${segment}`;
		lines.push(`${currentAccessor} = ${currentAccessor} ?? {};`);
	}
	const leafName = leaf.path[leaf.path.length - 1];
	lines.push(
		`${currentAccessor}.${leafName} = (arg) => Promise.resolve(tools.paperPluginTools.${leaf.internalName}(arg === undefined ? {} : arg)).then(__unwrap);`,
	);
	return lines;
}

const maxFullyListedCalls = 4;

function buildCallsSummary(leaves: readonly PaperPluginLeafRegistration[]): string {
	return uniquePluginNames(leaves)
		.map((name) => summarizePluginCalls(name, leaves))
		.join(", ");
}

function uniquePluginNames(leaves: readonly PaperPluginLeafRegistration[]): readonly string[] {
	return [...new Set(leaves.map((leaf) => leaf.pluginName))];
}

// Large plugins collapse to their top-level groups so the summary fits client truncation limits.
function summarizePluginCalls(
	pluginName: string,
	leaves: readonly PaperPluginLeafRegistration[],
): string {
	const own = leaves.filter((leaf) => leaf.pluginName === pluginName);
	if (own.length <= maxFullyListedCalls) {
		return own.map((leaf) => `plugins.${pluginName}.${leaf.path.join(".")}(...)`).join(", ");
	}
	const groups = [...new Set(own.map((leaf) => leaf.path[0]))];
	return `plugins.${pluginName}.{${groups.join(",")}}`;
}

function buildInstructionsText(
	plugins: readonly PaperPlugin[],
	leaves: readonly PaperPluginLeafRegistration[],
): string {
	return plugins
		.map(
			(plugin) =>
				`${plugin.instructions}\nAvailable calls: ${summarizePluginCalls(plugin.name, leaves)}`,
		)
		.join("\n");
}

function normalizeExecute(
	execute: PaperPluginLeaf["execute"],
	input: unknown,
): Effect.Effect<unknown, unknown> {
	// execute may return an Effect, a Promise, or a plain value; normalize to Effect here.
	const arg = isEmptyObject(input) ? undefined : input;
	const result = execute(arg);
	if (Effect.isEffect(result)) {
		return result as Effect.Effect<unknown, unknown>;
	}
	if (isThenable(result)) {
		return Effect.promise(() => result);
	}
	return Effect.succeed(result);
}

function isLeaf(node: PaperPluginToolNode): node is PaperPluginLeaf {
	return typeof node === "object" && node !== null && "execute" in node;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		"then" in value &&
		typeof value.then === "function"
	);
}

function isEmptyObject(value: unknown): boolean {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	return Object.keys(value).length === 0;
}

function makeInternalName(pluginName: string, path: readonly string[]): string {
	return `plugin__${pluginName}__${path.join("__")}`;
}
