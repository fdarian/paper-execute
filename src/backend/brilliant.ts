import { callingInstructions, type DesignBackend } from "#/backend";

const identity = { name: "Brilliant", slug: "brilliant" };

const instructions = [
	"Brilliant is a professional design tool: a Figma-like 2D vector editor with auto layout, components, and design system tokens. Everything you create lands on the user's canvas and stays editable by hand.",
	"",
	callingInstructions(identity),
	"",
	'- Start with `const s = await brilliant.init({ agentName: "Designer" })`. It returns markdown with your session id (`mcp:…`), the bound project and canvas, and the available knowledge keys. Pass that exact `sessionId` on every later `edit`, `read`, `get_knowledge`, and `export` call; without it calls fall back to a shared stateless session.',
	"- One write door, `brilliant.edit({ sessionId, text })`: `text` holds fences, each with `file(path)` as its first row. An ```html fence (the default) takes standard HTML with inline CSS and needs no knowledge. A ```bl fence (Blueprint DSL, Brilliant's native format) needs `brilliant.get_knowledge({ sessionId, keys })` first; use it to iterate on existing designs (edit properties, reparent, rename, delete, reorder) and for what CSS can't express (effects, components/instances, vectors, arcs/rings, shaders). Build with html, refine with bl.",
	"- For better design quality, load `design/*` knowledge (colors, typography, composition) before designing.",
	"- Pass a stable `requestId` on `edit` and reuse it when retrying within 2 minutes, so a retry isn't applied twice.",
	"- Inspect with `brilliant.read` (`paths` for canvases, `ids` for elements or #refs, or filters like `query` / `textContent` / `type`), `brilliant.get_selection` for the user's focus, `brilliant.list_projects` to find projects.",
	'- Quality: export after meaningful changes and look at it: `const x = await brilliant.export({ sessionId, canvasId, ids: [frameId], format: "png" }); for (const c of x) if (c.type === "image") emit(c);`.',
	"- Never show raw element IDs to the user.",
].join("\n");

export const brilliantBackend: DesignBackend = {
	...identity,
	defaultMcpUrl: "http://127.0.0.1:3333/mcp",
	mcpUrlEnv: "BRILLIANT_MCP_URL",
	mcpUrl: (config) => config.brilliantMcpUrl,
	cliPath: ["brilliant"],
	instructions,
};
