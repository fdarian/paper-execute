# paper-execute

MCP stdio server exposing one tool: `execute`. The agent writes async TypeScript that runs in an [executor](https://github.com/RhysSullivan/executor) QuickJS sandbox wired to the [Paper](https://paper.design) MCP plus host-side plugins. The built-in default plugin is `plugins.icon.*`, so it can drive Paper programmatically and drop in icons without hand-writing SVG.

## `execute` — what the agent writes

The `code` you pass runs in the sandbox with these globals (all async):

- `paper.<tool>(args)` — every Paper MCP tool (`write_html`, `open_file`, `create_artboard`, `get_selection`, `find_nodes`, `finish_working_on_nodes`, …). Throws on failure. Returns `structuredContent` when present; otherwise, if there is at least one block and every block is text parsing to a JSON object with no shared keys, returns their shallow merge. A single JSON-object block also returns its parsed object. Invalid JSON, arrays/null/primitives, key collisions, or non-text blocks fall back to a string for exactly one text item, or the unchanged content array otherwise. There is no `.content` wrapper.
- Start with `paper.get_basic_info({})` for file and page context. `find_nodes` is a filtered search, not page enumeration: pass `textValue` or a non-empty `filters` array; calling it with only `fileId` and `pageId` is invalid.
- `plugins.<name>.*` — plugin namespaces generated from the configured plugin tool trees.
- `plugins.icon.get(name)` — returns embeddable Phosphor SVG markup as a string.
- `plugins.icon.search(query)` — returns candidate icon matches.
- Returned strings are sent as text; other returned values, including content arrays, are JSON-stringified.
- `emit(item)` sends an individual MCP content block, a plain value rendered as text, or a `ToolFile` rendered by MIME. Emitted items come first, followed by returned text. Use this path to deliver images; returning an image content array does not deliver native images.

Given a known `targetNodeId`:

```ts
// insert a Phosphor icon into the current Paper page, no raw SVG needed
await paper.write_html({
	html: `<div style="display:flex;padding:16px">${await plugins.icon.get("shopping-cart")}</div>`,
	targetNodeId,
	mode: "insert-children",
});
await paper.finish_working_on_nodes({ nodeIds: [targetNodeId] });
```

### Read results and screenshots

`get_tree_summary` returns two JSON-object text blocks upstream: file metadata (`file`, `contentHash`) and the tree payload (`summary`, `nodeId`, `depth`). The helper merges them so you can read `t.summary` directly. Similarly, `find_nodes` exposes `f.nodes` and `f.count` alongside file metadata. Screenshots contain image blocks, so they remain content arrays.

```ts
const f = await paper.find_nodes({ fileId, textValue: "Submit" });
return f.nodes;
```

```ts
const t = await paper.get_tree_summary({ fileId, nodeId: "73N-0", depth: 2 });
const s = await paper.get_screenshot({ fileId, nodeId: "65V-0" });
for (const c of s) if (c.type === "image") emit(c);
return t.summary;
```

This delivers the screenshot image items followed by the readable tree summary with actual line breaks.

Requires the Paper desktop app running for `paper.*` calls. The Paper MCP defaults to `http://127.0.0.1:29979/mcp`; override it with config `paperMcpUrl` or `PAPER_MCP_URL`. If Paper is unreachable at boot, the server warns and continues so plugin-only calls like `plugins.icon.*` still work.

## Plugin config

Discovery order:

1. `./paper-execute.config.json`
2. `~/.config/paper-execute/config.json`
3. Built-in default `{ "plugins": ["icon"] }`

Config shape:

```json
{
  "paperMcpUrl": "http://127.0.0.1:29979/mcp",
  "plugins": [
    "icon",
    ["@paper-execute/faker", { "locale": "en" }],
    "./plugins/brand-kit.ts",
    "/absolute/path/to/plugin.ts"
  ]
}
```

Plugin entry forms:

- `"name"` for built-ins or package imports
- `["name", options]` for a package or built-in factory export
- `"./local.ts"` or `"/absolute/path.ts"` for direct file imports

Plugin load failures are warned to stderr and skipped one entry at a time.

## Plugin author contract

- Export `default` as either a `PaperPlugin` object or a factory `(options) => PaperPlugin`.
- Define plugins with `definePaperPlugin` from `paper-execute/plugin`.
- Each leaf call takes zero or one argument. No `input` means no arg. Scalar, object, and array schemas are each passed as one arg.
- `execute` may return an Effect, a Promise, or a plain value. paper-execute normalizes all three.
- `output` is the return value schema directly.
- Standard Schema validators are accepted. Effect Schema is converted to the executor's JSON-schema-backed form internally; zod Standard Schema works directly.

External plugin import line:

`import { definePaperPlugin } from "paper-execute/plugin";`

Reproducible external plugin resolution steps for a throwaway plugin under `~/.config/paper-execute/plugins/`:

1. In this repo: `bun link`
2. In `~/.config/paper-execute/plugins/`: `bun link paper-execute`
3. In `~/.config/paper-execute/plugins/`: `bun add zod` or `bun add effect` for the schema library the plugin imports

After verification, remove the throwaway plugin directory contents and unlink if you do not want the local package link to remain.

## Run

```sh
pnpm install
pnpm run check:type
pnpm run check:lint
bun test
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
