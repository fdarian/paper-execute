import { expect, test } from "bun:test";

import { buildSettings } from "./settings.ts";

const team = { "team-plugin@x": true };

test("always enables the team plugin, even with no user settings", () => {
	expect(buildSettings({}, {}, {}, undefined, team)).toEqual({ enabledPlugins: team });
});

test("carries the UI keys and ignores other user keys", () => {
	const settings = buildSettings(
		{ theme: "dark", model: "x", statusLine: { type: "command" } },
		{},
		{},
		undefined,
		team,
	);
	expect(settings).toEqual({
		theme: "dark",
		statusLine: { type: "command" },
		enabledPlugins: team,
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
		undefined,
		team,
	);
	expect(settings).toEqual({
		model: "opus",
		extraKnownMarketplaces: { dotfiles: { source: "x" } },
		enabledPlugins: team,
	});
});

test("merges inherited enabledPlugins with the team's, which win on conflict", () => {
	const settings = buildSettings(
		{
			enabledPlugins: {
				"skill-mention@dotfiles": true,
				"team-plugin@x": false,
				"unlisted@x": true,
			},
		},
		{ enabledPlugins: ["skill-mention@dotfiles", "team-plugin@x"] },
		{},
		undefined,
		team,
	);
	expect(settings.enabledPlugins).toEqual({ "skill-mention@dotfiles": true, ...team });
});

test("throws when sub-keys are listed for a non-object value", () => {
	expect(() => buildSettings({ model: "opus" }, { model: ["a"] }, {}, undefined, team)).toThrow();
});

test("cc.settings shallow-merges over inherited settings", () => {
	const settings = buildSettings(
		{ theme: "dark", model: "opus" },
		{ model: true },
		{ model: "haiku", claudeMdExcludes: ["/x/**"] },
		undefined,
		team,
	);
	expect(settings).toEqual({
		theme: "dark",
		model: "haiku",
		claudeMdExcludes: ["/x/**"],
		enabledPlugins: team,
	});
});

test("enabledPlugins combines inherited, cc.settings and team entries; team wins", () => {
	const settings = buildSettings(
		{ enabledPlugins: { "a@x": true, "b@x": true } },
		{ enabledPlugins: ["a@x", "b@x"] },
		{
			enabledPlugins: {
				"b@x": false,
				"c@x": true,
				"team-plugin@x": false,
			},
		},
		undefined,
		team,
	);
	expect(settings.enabledPlugins).toEqual({
		"a@x": true,
		"b@x": false,
		"c@x": true,
		...team,
	});
});

test("cache TTL absent leaves both TTL keys unset", () => {
	const settings = buildSettings({}, {}, {}, undefined, team);
	expect(settings).not.toHaveProperty("promptCacheTtl");
	expect(settings).not.toHaveProperty("subagentPromptCacheTtl");
});

test("cache TTL sets both main and subagent keys", () => {
	const settings = buildSettings({}, {}, {}, "5m", team);
	expect(settings.promptCacheTtl).toBe("5m");
	expect(settings.subagentPromptCacheTtl).toBe("5m");
});

test("cache TTL flag overrides cc.settings", () => {
	const settings = buildSettings(
		{},
		{},
		{ promptCacheTtl: "5m", subagentPromptCacheTtl: "5m" },
		"1h",
		team,
	);
	expect(settings.promptCacheTtl).toBe("1h");
	expect(settings.subagentPromptCacheTtl).toBe("1h");
});

test("cc.settings TTL is kept when the flag is absent", () => {
	const settings = buildSettings({}, {}, { promptCacheTtl: "5m" }, undefined, team);
	expect(settings.promptCacheTtl).toBe("5m");
});
