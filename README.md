# paper-execute

MCP stdio server exposing one tool: `paper_execute`. The agent writes async TypeScript that runs in an [executor](https://github.com/RhysSullivan/executor) QuickJS sandbox wired to the [Paper](https://paper.design) MCP, plus Phosphor icon helpers — so it can drive Paper programmatically and drop in icons without hand-writing SVG.

## `paper_execute` — what the agent writes

The `code` you pass runs in the sandbox with these globals (all async):

- `paper.<tool>(args)` — every Paper MCP tool (`write_html`, `open_file`, `create_artboard`, `get_selection`, `find_nodes`, `finish_working_on_nodes`, …). Returns the tool's data; throws on failure.
- `icon_get(name)` — returns embeddable Phosphor SVG markup as a string.
- `icon_search(query)` — returns candidate icon matches.
- Whatever your code `return`s is sent back as the tool result.

```ts
// insert a Phosphor icon into the current Paper page, no raw SVG needed
const info = await paper.get_basic_info({});
await paper.write_html({
  html: `<div style="display:flex;padding:16px">${await icon_get("shopping-cart")}</div>`,
  targetNodeId: info.rootNodeId,
  mode: "insert-children",
});
await paper.finish_working_on_nodes({ nodeIds: [info.rootNodeId] });
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
  "args": ["run", "/Users/farreldarian/code/fdarian/paper-execute/src/index.ts"]
}
```

## Bin

`src/index.ts` has a Bun shebang, so it can also be used as an executable entrypoint.
