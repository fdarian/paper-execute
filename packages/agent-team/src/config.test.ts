import { expect, test } from "bun:test";

import { decodeAgentTeamConfig } from "./config.ts";

test("decodes cc.inheritSettings with whole-value and sub-key entries", () => {
	const config = decodeAgentTeamConfig({
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
	expect(decodeAgentTeamConfig({}).cc).toBeUndefined();
	expect(decodeAgentTeamConfig({ cc: {} }).cc?.inheritSettings).toBeUndefined();
});

test("ignores the host app's other keys", () => {
	const config = decodeAgentTeamConfig({ plugins: ["icon"], paperMcpUrl: "http://x", cc: {} });
	expect(config).toEqual({ cc: {} });
});

test("rejects inheritSettings values that are neither true nor a string array", () => {
	expect(() => decodeAgentTeamConfig({ cc: { inheritSettings: { theme: false } } })).toThrow();
	expect(() => decodeAgentTeamConfig({ cc: { inheritSettings: { theme: "dark" } } })).toThrow();
});

test("decodes arbitrary cc.settings", () => {
	const config = decodeAgentTeamConfig({
		cc: { settings: { claudeMdExcludes: ["/x/**"], nested: { a: 1 } } },
	});
	expect(config.cc?.settings).toEqual({ claudeMdExcludes: ["/x/**"], nested: { a: 1 } });
	expect(() => decodeAgentTeamConfig({ cc: { settings: "no" } })).toThrow();
});
