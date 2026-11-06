import { expect, test } from "bun:test";

import { selfCommand, selfMcpServer } from "./self-command.ts";

test("from a checkout the script is passed to the runtime", () => {
	expect(selfCommand(["paper", "mcp"])).toEqual([process.execPath, Bun.main, "paper", "mcp"]);
});

test("selfMcpServer splits the command from its arguments", () => {
	expect(selfMcpServer(["paper", "mcp"])).toEqual({
		type: "stdio",
		command: process.execPath,
		args: [Bun.main, "paper", "mcp"],
		alwaysLoad: true,
	});
});
