import type { StdioMcpServer } from "./team.ts";

// Compiled binaries ($bunfs) are their own entry point; from a checkout the script has to be passed to bun.
export function selfCommand(args: readonly string[]): string[] {
	const compiled = Bun.main.startsWith("/$bunfs/");
	return compiled ? [process.execPath, ...args] : [process.execPath, Bun.main, ...args];
}

export function selfMcpServer(args: readonly string[]): StdioMcpServer {
	const command = selfCommand(args);
	return { type: "stdio", command: command[0] as string, args: command.slice(1), alwaysLoad: true };
}
