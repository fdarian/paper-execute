# paper-execute

MCP stdio server exposing one tool: `paper_execute`. The agent writes async TypeScript that runs in an [executor](https://github.com/RhysSullivan/executor) QuickJS sandbox wired to the [Paper](https://paper.design) MCP, plus Phosphor icon helpers — so it can drive Paper programmatically and drop in icons without hand-writing SVG.

## `paper_execute` — what the agent writes

The `code` you pass runs in the sandbox with these globals (all async):

- `paper.<tool>(args)` — every Paper MCP tool (`write_html`, `open_file`, `create_artboard`, `get_selection`, `find_nodes`, `finish_working_on_nodes`, …). Throws on failure. Returns `structuredContent` when present; otherwise newline-joined text if every content item is text, or the content array unchanged for mixed/non-text items. Text is never JSON-parsed. There is no `.content` wrapper.
- `icon_get(name)` — returns embeddable Phosphor SVG markup as a string.
- `icon_search(query)` — returns candidate icon matches.
- Whatever your code `return`s is sent back as the tool result.
- `emit(item)` — collects an individual item in the executor's output. This server reports only the emitted-item count; it does not deliver emitted images. Return an MCP content array to deliver images to the client.

Given a known `targetNodeId`:

```ts
// insert a Phosphor icon into the current Paper page, no raw SVG needed
await paper.write_html({
  html: `<div style="display:flex;padding:16px">${await icon_get("shopping-cart")}</div>`,
  targetNodeId,
  mode: "insert-children",
});
await paper.finish_working_on_nodes({ nodeIds: [targetNodeId] });
```

### Tree text and screenshots

`get_tree_summary` returns two text blocks upstream: file metadata (`file`, `contentHash`) and the tree payload (`summary`, `nodeId`, `depth`). The helper joins both JSON strings with a newline. The result is a string, not an object with `.content`, and not a single JSON document.

Existing code that collects screenshot images with `emit` must iterate the returned array directly:

```ts
const t = await paper.get_tree_summary({ fileId, nodeId: "73N-0", depth: 2 });
const s = await paper.get_screenshot({ fileId, nodeId: "65V-0" });
for (const c of s) if (c.type === "image") emit(c);
return t;
```

This returns joined tree text plus an emitted-item count, **not the images**. To deliver the screenshot content to the client instead:

```ts
return await paper.get_screenshot({ fileId, nodeId: "65V-0" });
```

Requires the Paper desktop app running (its MCP defaults to `http://127.0.0.1:29979/mcp`; override with `PAPER_MCP_URL`).

## Run

```sh
bun install
bun run check:type
bun run check:lint
bun run src/index.ts
```

## MCP Client Config

```json
{
  "command": "bun",
  "args": ["run", <path-to-repo>/src/index.ts"]
}
```

## Bin

`src/index.ts` has a Bun shebang, so it can also be used as an executable entrypoint.
