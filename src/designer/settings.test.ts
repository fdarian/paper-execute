import { expect, test } from "bun:test";

import { buildSettings } from "./settings.ts";

const designer = { "frontend-design@claude-plugins-official": true };

test("always enables the designer plugin, even with no user settings", () => {
	expect(buildSettings({}, {})).toEqual({ enabledPlugins: designer });
});

test("carries the UI keys and ignores other user keys", () => {
	const settings = buildSettings(
		{ theme: "dark", model: "x", statusLine: { type: "command" } },
		{},
	);
	expect(settings).toEqual({
		theme: "dark",
		statusLine: { type: "command" },
		enabledPlugins: designer,
	});
});

test("inherits whole values and picked sub-keys, skipping missing ones", () => {
	const settings = buildSettings(
		{
			model: "opus",
			extraKnownMarketplaces: { dotfiles: { source: "x" }, other: { source: "y" } },
		},
		{
			model: true,
			extraKnownMarketplaces: ["dotfiles", "absent"],
			hooks: true,
			enabledPlugins: ["nope"],
		},
	);
	expect(settings).toEqual({
		model: "opus",
		extraKnownMarketplaces: { dotfiles: { source: "x" } },
		enabledPlugins: designer,
	});
});

test("merges inherited enabledPlugins with the designer's, which win on conflict", () => {
	const settings = buildSettings(
		{
			enabledPlugins: {
				"skill-mention@dotfiles": true,
				"frontend-design@claude-plugins-official": false,
				"unlisted@x": true,
			},
		},
		{ enabledPlugins: ["skill-mention@dotfiles", "frontend-design@claude-plugins-official"] },
	);
	expect(settings.enabledPlugins).toEqual({ "skill-mention@dotfiles": true, ...designer });
});

test("throws when sub-keys are listed for a non-object value", () => {
	expect(() => buildSettings({ model: "opus" }, { model: ["a"] })).toThrow();
});
