import type { InheritSettings } from "#/plugin/config";

// `--setting-sources` drops the user's settings.json wholesale; these UI preferences are always carried back via `--settings`.
const alwaysInherited: InheritSettings = {
	statusLine: true,
	theme: true,
	editorMode: true,
	outputStyle: true,
};

export type CacheTtl = "5m" | "1h";

const designerPlugins = { "frontend-design@claude-plugins-official": true };

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildSettings(
	userSettings: Record<string, unknown>,
	inheritSettings: InheritSettings,
	literalSettings: Record<string, unknown>,
	cacheTtl: CacheTtl | undefined,
): Record<string, unknown> {
	const inherited: Record<string, unknown> = {};
	for (const [key, spec] of Object.entries({ ...alwaysInherited, ...inheritSettings })) {
		if (!(key in userSettings)) continue;
		const value = userSettings[key];
		if (spec === true) {
			inherited[key] = value;
			continue;
		}
		if (!isObject(value)) {
			throw new Error(
				`cc.inheritSettings.${key} lists sub-keys, but the user's "${key}" is not an object.`,
			);
		}
		const picked = Object.fromEntries(
			spec.filter((sub) => sub in value).map((sub) => [sub, value[sub]]),
		);
		if (Object.keys(picked).length > 0) inherited[key] = picked;
	}
	const pluginsSources = [inherited.enabledPlugins, literalSettings.enabledPlugins];
	return {
		...inherited,
		...literalSettings,
		// `promptCacheTtl` covers the main thread (director), `subagentPromptCacheTtl` the subagents (designer).
		...(cacheTtl === undefined
			? {}
			: { promptCacheTtl: cacheTtl, subagentPromptCacheTtl: cacheTtl }),
		enabledPlugins: Object.assign({}, ...pluginsSources.filter(isObject), designerPlugins),
	};
}
