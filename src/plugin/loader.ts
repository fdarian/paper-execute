import { isAbsolute, resolve } from "node:path";

import { Effect } from "effect";

import { PaperPluginLoadError } from "#/errors";
import { iconPlugin } from "#/icons/plugin";
import { imagePlugin } from "#/image/plugin";
import type { PaperPluginEntry } from "#/plugin/config";
import type { PaperPlugin } from "#/plugin/define";

type PaperPluginFactory = (options: unknown) => PaperPlugin;

const builtInPlugins = new Map<string, PaperPlugin | PaperPluginFactory>([
	["icon", iconPlugin],
	["image", imagePlugin],
]);

export function loadPlugins(
	entries: readonly PaperPluginEntry[],
): Effect.Effect<readonly PaperPlugin[], never> {
	return Effect.forEach(
		entries,
		(entry) =>
			loadPluginEntry(entry).pipe(
				Effect.catch((error: PaperPluginLoadError) => logAndSkipPlugin(error)),
			),
		{
			concurrency: "unbounded",
		},
	).pipe(Effect.map((plugins) => plugins.flatMap((plugin) => (plugin === null ? [] : [plugin]))));
}

function loadPluginEntry(
	entry: PaperPluginEntry,
): Effect.Effect<PaperPlugin, PaperPluginLoadError> {
	return Effect.gen(function* () {
		const entryName = getPluginEntryName(entry);
		const options = getPluginEntryOptions(entry);
		const moduleValue = yield* resolvePluginModule(entryName).pipe(
			Effect.mapError(
				(cause) =>
					new PaperPluginLoadError({
						entry: entryName,
						reason: "Failed to resolve plugin module",
						cause,
					}),
			),
		);
		return normalizePluginModule(entryName, moduleValue, options);
	});
}

function resolvePluginModule(
	entryName: string,
): Effect.Effect<PaperPlugin | PaperPluginFactory, unknown> {
	const builtInPlugin = builtInPlugins.get(entryName);
	if (builtInPlugin !== undefined) {
		return Effect.succeed(builtInPlugin);
	}
	const importPath = toImportPath(entryName);
	return Effect.tryPromise({
		try: async () => {
			const imported = await import(importPath);
			return imported.default as PaperPlugin | PaperPluginFactory;
		},
		catch: (cause) => cause,
	});
}

function normalizePluginModule(
	entryName: string,
	moduleValue: PaperPlugin | PaperPluginFactory,
	options: unknown,
): PaperPlugin {
	const plugin = typeof moduleValue === "function" ? moduleValue(options) : moduleValue;
	if (typeof plugin !== "object" || plugin === null) {
		throw new PaperPluginLoadError({
			entry: entryName,
			reason: "Plugin default export must be an object or factory returning an object",
			cause: plugin,
		});
	}
	return plugin;
}

function getPluginEntryName(entry: PaperPluginEntry): string {
	if (typeof entry === "string") {
		return entry;
	}
	return entry[0];
}

function getPluginEntryOptions(entry: PaperPluginEntry): unknown {
	if (typeof entry === "string") {
		return undefined;
	}
	return entry[1];
}

function logAndSkipPlugin(error: PaperPluginLoadError): Effect.Effect<null, never> {
	return Effect.sync(() => {
		console.error(`[paper-execute] Skipping plugin ${error.entry}: ${error.reason}`);
		console.error(error.cause);
		return null;
	});
}

function toImportPath(entryName: string): string {
	if (entryName.startsWith(".") || entryName.startsWith("/")) {
		if (isAbsolute(entryName)) {
			return entryName;
		}
		return resolve(process.cwd(), entryName);
	}
	return entryName;
}
