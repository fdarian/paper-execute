import { expect, test } from "bun:test";

import { buildSettings } from "./settings.ts";

const designer = { "frontend-design@claude-plugins-official": true };

test("always enables the designer plugin, even with no user settings", () => {
	expect(buildSettings({}, {}, {})).toEqual({ enabledPlugins: designer });
});

test("carries the UI keys and ignores other user keys", () => {
	const settings = buildSettings(
		{ theme: "dark", model: "x", statusLine: { type: "command" } },
		{},
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
		{},
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
		{},
	);
	expect(settings.enabledPlugins).toEqual({ "skill-mention@dotfiles": true, ...designer });
});

test("throws when sub-keys are listed for a non-object value", () => {
	expect(() => buildSettings({ model: "opus" }, { model: ["a"] }, {})).toThrow();
});

test("cc.settings shallow-merges over inherited settings", () => {
	const settings = buildSettings(
		{ theme: "dark", model: "opus" },
		{ model: true },
		{ model: "haiku", claudeMdExcludes: ["/x/**"] },
	);
	expect(settings).toEqual({
		theme: "dark",
		model: "haiku",
		claudeMdExcludes: ["/x/**"],
		enabledPlugins: designer,
	});
});

test("enabledPlugins combines inherited, cc.settings and designer entries; designer wins", () => {
	const settings = buildSettings(
		{ enabledPlugins: { "a@x": true, "b@x": true } },
		{ enabledPlugins: ["a@x", "b@x"] },
		{
			enabledPlugins: {
				"b@x": false,
				"c@x": true,
				"frontend-design@claude-plugins-official": false,
			},
		},
	);
	expect(settings.enabledPlugins).toEqual({
		"a@x": true,
		"b@x": false,
		"c@x": true,
		...designer,
	});
});
