import { expect, test } from "bun:test";

import { decodePluginConfig } from "#/plugin/config";

test("decodes cc.inheritSettings with whole-value and sub-key entries", () => {
	const config = decodePluginConfig({
		plugins: ["icon"],
		cc: {
			inheritSettings: {
				extraKnownMarketplaces: ["dotfiles"],
				model: true,
			},
		},
	});
	expect(config.cc?.inheritSettings).toEqual({
		extraKnownMarketplaces: ["dotfiles"],
		model: true,
	});
});

test("cc section is optional", () => {
	expect(decodePluginConfig({ plugins: [] }).cc).toBeUndefined();
	expect(decodePluginConfig({ plugins: [], cc: {} }).cc?.inheritSettings).toBeUndefined();
});

test("rejects inheritSettings values that are neither true nor a string array", () => {
	expect(() =>
		decodePluginConfig({ plugins: [], cc: { inheritSettings: { theme: false } } }),
	).toThrow();
	expect(() =>
		decodePluginConfig({ plugins: [], cc: { inheritSettings: { theme: "dark" } } }),
	).toThrow();
});
