import { callingInstructions, type DesignBackend } from "#/backend";

const identity = { name: "Brilliant", slug: "brilliant" };

const instructions = [
	"Brilliant is a professional design tool: a Figma-like 2D vector editor with auto layout, components, and design system tokens. Everything you create lands on the user's canvas and stays editable by hand.",
	"",
	callingInstructions(identity),
	"",
	"- Start here. Each `execute` call is a fresh sandbox, so carry the session id into later calls as a string literal.",
	'  1. `return await brilliant.init({ agentName: "Designer" });` returns one markdown string, not an object. Your session id is on its ``**Your session ID: `mcp:…`**`` line; pass it as `sessionId` on every later `edit`, `read`, `get_knowledge`, and `export` call. Call `init` once per task: every call starts a new session. The text also gives the bound project, the canvas (`sessionCanvasId`), the canvas blueprint, and the available knowledge keys. Ignore its "load 10-15 knowledge files" line; load only what step 2 says. If it warns that the project on screen differs from the bound one, pass `project: "<key it names>"` on your calls.',
	'  2. Knowledge (optional for html, required before bl): `await brilliant.get_knowledge({ sessionId, keys: ["design/foundations", "design/colors", "design/typography"], includeDependencies: false })` returns one markdown string. Request only keys listed by init. Without `includeDependencies: false`, prerequisite blueprint docs are bundled ahead of the keys you asked for.',
	"  3. Write with `edit`, building the fence by joining lines:",
	"~~~js",
	'const F = "```";',
	'const html = `<div style="position:absolute;left:1400px;top:0;width:390px;height:844px;display:flex;flex-direction:column">…</div>`;',
	'return await brilliant.edit({ sessionId: "mcp:…", requestId: "screen-v1", text: [F + "html", \'file("Projects/…")\', html, F].join("\\n") });',
	"~~~",
	"- One write door, `brilliant.edit({ sessionId, text })`: `text` holds fences, each with `file(path)` as its first row. An ```html fence (the default) takes standard HTML with inline CSS and needs no knowledge. A ```bl fence (Blueprint DSL, Brilliant's native format) needs `get_knowledge` first; use it to iterate on existing designs (edit properties, reparent, rename, delete, reorder) and for what CSS can't express (effects, components/instances, vectors, arcs/rings, shaders). Build with html, refine with bl.",
	"- An html fence takes an HTML fragment: no doctype/html/head/body. Put inline `style=` attributes on every element; no `<style>` blocks or classes. Give the root element an explicit width and height and place it clear of existing content (read the canvas first).",
	'- Icons in html: `<i data-icon="cloud-sun" style="width:24px;height:24px;color:#fff"></i>` uses Brilliant\'s bundled set; fall back to `plugins.icon.get` for names it lacks.',
	"- CSS `backdrop-filter` doesn't come through html. Glass/blur effects need a bl fence after loading `effects/glass` (`frost(N)` is the blur).",
	'- `edit` returns a string: a summary line like `Canvas: … N elements.`, then JSON with `status`, `applied`, and, on trouble, `diagnostics`; it throws (same text in the error) when nothing applied. The ids of what you created are the values of `refs` (its keys vary, so never hardcode `i1`). `autoCorrections` and `compositionNotes` are advice, not failures. Lines in `diagnostics` saying "NOT applied" were skipped. Return the string as is instead of regex-parsing it.',
	'- A bl fence edits in place: lead a row with an element id to modify it, `delete(<id>)` to remove it. To redo a frame, delete it in its own `edit` call, then write the new one. Find ids with `brilliant.read({ sessionId, paths: ["<canvas>"], depth: 1 })`.',
	"- Pass a stable `requestId` on `edit` and reuse it when retrying within 2 minutes, so a retry isn't applied twice.",
	"- Inspect with `brilliant.read` (`paths` for canvases, `ids` for elements or #refs, or filters like `query` / `textContent` / `type`), `brilliant.get_selection` for the user's focus, `brilliant.list_projects` to find projects.",
	'- Quality: export after meaningful changes and look at it: `const x = await brilliant.export({ sessionId, canvasId: "<canvas>", ids: [frameId], format: "png" }); for (const c of x) if (c.type === "image") emit(c);`.',
	"- When an execute result is too large it is saved to a file and you get the path: Read that file instead of re-running the call.",
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
