import { callingInstructions, type DesignBackend } from "#/backend";

const identity = { name: "Paper", slug: "paper" };

const instructions = [
	"Paper is a professional design tool for creating user interfaces. The user is working on a 2D canvas composing designs.",
	"The Paper MCP server gives you tools to be a talented designer for web and mobile apps and websites. You can read designs from the user's file, see what the user is doing, and write HTML back into the design as new nodes.",
	"",
	callingInstructions(identity),
	"For screenshots: `const s = await paper.get_screenshot({ fileId, nodeId }); for (const c of s) if (c.type === 'image') emit(c);`. Tree summaries: `const t = await paper.get_tree_summary({ fileId, nodeId, depth: 2 }); return t.summary;`. Find nodes: `const f = await paper.find_nodes({ fileId, textValue: 'Submit' }); return f.nodes;`.",
	"",
	'You MUST load the full guide before other Paper tools: `await paper.get_guide({ topic: "paper-mcp-instructions" })`. Do this once per session; call again if a long thread may have dropped guide text.',
	"",
	"- Call `paper.get_basic_info` when starting on a file to learn artboards and dimensions; use `paper.get_selection` to see user focus. Only `get_basic_info` and `get_selection` may omit fileId (they use the file the user is looking at); every other Paper tool requires `fileId`, so pass `file.id` from `paper.get_basic_info`.",
	"- pageId defaults to the page the user is viewing; pass it to work on another page without disrupting them. You can't switch their page.",
	'- `paper.find_nodes` is a filtered search, not page enumeration: it requires textValue or a non-empty filters array. For example, use `{ fileId, pageId, textValue: "Submit" }` or `{ fileId, pageId, filters: [{ styleName: "background-color", styleValue: "#ff0000" }] }`; never call it with only fileId and pageId.',
	"- Typography: you MUST call `paper.get_font_family_info` before your first typographic styling in a session. Prefer font families listed in `paper.get_basic_info` unless the user specifies otherwise. Use px for font sizes, em for letter-spacing, px for line-height.",
	"- New designs: before writing HTML, generate a brief (palette, type scale, spacing, direction) unless given a design system.",
	"- Creating/editing: each `paper.write_html` call should add roughly one visual group; prefer `paper.duplicate_nodes` with `paper.update_styles` and `paper.set_text_content` when faster than rewriting HTML.",
	"- For `paper.write_html`, use inline styles and flexbox; avoid margin, grid, and tables.",
	'- Quality: use `paper.get_screenshot` to review after meaningful changes. Artboard height is a starting point — when content clips set height: "fit-content" via `paper.update_styles` rather than guessing a fixed height.',
	"- Repeated rows (lists, nav): use fixed-width slots for icons and trailing actions (flexShrink: 0); gap alone won't align columns across rows.",
	"- When done creating or editing, you MUST call `paper.finish_working_on_nodes`.",
	"- Never show raw node IDs to the user.",
	"- Export to the user's codebase: use `paper.get_jsx`, `paper.get_computed_styles`, `paper.get_fill_image`, etc. for exact values — never read sizes or colors from screenshots.",
].join("\n");

export const paperBackend: DesignBackend = {
	...identity,
	defaultMcpUrl: "http://127.0.0.1:29979/mcp",
	mcpUrlEnv: "PAPER_MCP_URL",
	mcpUrl: (config) => config.paperMcpUrl,
	cliPath: [],
	instructions,
};
