import { expect, test } from "bun:test";

import { selfCommand, selfMcpServer } from "./self-command.ts";

test("from a checkout the script is passed to the runtime", () => {
	expect(selfCommand(["draft", "mcp"])).toEqual([process.execPath, Bun.main, "draft", "mcp"]);
});

test("selfMcpServer splits the command from its arguments", () => {
	expect(selfMcpServer(["draft", "mcp"])).toEqual({
		type: "stdio",
		command: process.execPath,
		args: [Bun.main, "draft", "mcp"],
		alwaysLoad: true,
	});
});
