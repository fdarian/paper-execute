Purpose: MCP server exposing one `paper_execute` codemode tool for Paper via executor QuickJS.
Stack: Bun, TypeScript, Effect v4 beta, executor core APIs, MCP SDK, Biome.
Commands: `bun install`, `bun run check:type`, `bun run check:lint`, `bun run src/index.ts`.
Architecture: `src/index.ts` boots stdio MCP, `src/mcp/server.ts` wraps the single tool, `src/executor/engine.ts` wires executor + Paper MCP + icon plugin, `src/icons/*` handles Phosphor search and SVG loading.
Notes: Use `@executor-js/*/core` imports (the bare `.` export is the promise façade), keep Effect at `4.0.0-beta.59`, and treat all sandbox tool calls as async.
Gotchas (non-obvious):
- `patches/@executor-js%2Fplugin-mcp@1.5.28.patch` fixes an upstream bug: plugin-mcp's `/core` build imports `tool`/elicitation types from the SDK root (promise façade, which lacks them) instead of `@executor-js/sdk/core`. Without the patch, importing `@executor-js/plugin-mcp/core` throws at load. Present in 1.5.28 and 2.0.0.
- `createExecutor` needs a writable credential provider (`providers: [...]`) — even the no-auth (`template: "none"`) Paper connection fails `connections.create` with `CredentialProviderNotRegisteredError` otherwise. `engine.ts` registers an in-memory one.
- Published `/core` types expose plugin extensions loosely (`executor.mcp` is `any`); `engine.ts` pins it to `McpPluginExtension` so the Effect error/requirement channels stay typed.
- The sandbox wraps every tool call in `{ ok, data }`; `src/executor/preamble.ts` unwraps it and Paper's CallToolResult (`icon_get("acorn")` → SVG string, `paper.*` → structuredContent, a string for exactly one text block, or the content array unchanged; throws on failure). Use `emit(block)` for native MCP content; returned arrays are JSON text.
