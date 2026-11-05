import { expect, test } from "bun:test";

import { decodePluginConfig } from "#/plugin/config";

test("ignores the agent team's cc section, which lives in the same file", () => {
	const config = decodePluginConfig({
		plugins: ["icon"],
		cc: { inheritSettings: { model: true }, settings: { theme: "dark" } },
	});
	expect(config).toEqual({ plugins: ["icon"] });
});
