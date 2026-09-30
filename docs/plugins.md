# paper-execute plugins — UX design

> Status: design sketch, not built. This describes the *experience* for the three
> people a plugin touches. APIs shown are illustrative, not final.

A plugin adds a **namespace under `plugins.<name>`** in the sandbox. `paper.*` stays
top-level (it's the primary surface); everything else lives under `plugins.` so two
plugins can never collide. Icons stop being special and become the reference plugin
(`plugins.icon.get`, `plugins.icon.search`).

**v1 scope: no credential subsystem in core.** Core stays keyless. A plugin that needs a key
(e.g. photo search on pexels/unsplash) reads it from the host env itself — plugins are
trusted host-side code, so this needs nothing from core. Live OAuth connectors
(sheets/notion/crm) are still deferred — an interactive auth flow is a separate, bigger design.

Three faces:

1. **Agent** — writes sandbox code, calls `plugins.<name>.…`.
2. **Operator** — turns plugins on via one JSON config file.
3. **Author** — declares a tool tree; the tree *is* the namespace.

---

## 1. The agent's view

`plugins.<name>` mirrors the plugin's tool tree exactly. Everything is `await` (host
round-trip), same as `paper.*`.

```ts
// qr — pure compute, returns SVG
await paper.write_html({ html: await plugins.qr.render("https://paper.design"), targetNodeId, mode: "insert-children" });

// svgl — brand logo by name, returns SVG (public API, no key)
await paper.write_html({ html: await plugins.svgl.logo("vercel"), targetNodeId, mode: "insert-children" });

// icon — now just a plugin
await paper.write_html({ html: await plugins.icon.get("acorn"), targetNodeId, mode: "insert-children" });
const matches = await plugins.icon.search("shopping cart");

// faker — curated generators, mirroring faker's shape
const info = await paper.get_basic_info({});
await paper.write_html({
  html: `<div>${await plugins.faker.internet.username()} — ${await plugins.faker.company.catchPhrase()}</div>`,
  targetNodeId: info.rootNodeId, mode: "insert-children",
});
```

**Every call takes zero or one argument** — `undefined | scalar | object`, decided by the
leaf's `input` schema:

- no `input` → no arg: `plugins.faker.internet.username()`
- scalar schema → positional value: `plugins.qr.render("…")`
- object schema → one object: `plugins.svgl.logo({ name, weight })`

An **array is one argument** (the array itself), never spread. A tool needing multiple
params takes an object (`{ query, count }`), never `(query, count)` — so there's no arity
ambiguity. The **`output` schema is the return value** — no "pick a field" step.

---

## 2. The operator's view — one JSON config

No `.ts` config: with secrets out of scope, a plugin entry is just a name (+ optional plain
options), so JSON is the right fit.

```jsonc
// ~/.config/paper-execute/config.json   (or ./paper-execute.config.json to override per-project)
{
  "$schema": "https://…/paper-execute.schema.json",   // editor autocomplete
  "paperMcpUrl": "http://127.0.0.1:29979/mcp",         // optional override
  "plugins": [
    "@paper-execute/faker",
    "@paper-execute/qr",
    "@paper-execute/svgl",
    ["@paper-execute/icon", { "defaultWeight": "regular" }],  // [name, options] for non-secret config
    "./plugins/brand-kit.ts"                                  // local file, no publishing needed
  ]
}
```

- **Entry forms**: `"pkg"`, `["pkg", options]` (plain config, never secrets), `"./local.ts"`
  (the loader `import()`s the path).
- **Discovery**: local `./paper-execute.config.json` if present, else
  `~/.config/paper-execute/config.json`, else a built-in default of `["icon"]` so the base
  experience works with zero config.
- **Failure is per-plugin and loud**: a plugin that fails to load is skipped with a logged
  warning (same posture as the Paper-MCP-unreachable warning in `engine.ts`); its namespace
  is simply absent rather than crashing the server.

---

## 3. The author's view — the tool tree *is* the shape

QuickJS has no network/fs, so a plugin's work runs **host-side** as executor tools (like
icons reading SVGs off disk today). The sandbox `plugins.<name>` proxy mirrors the tree and
auto-generates the `{ ok, data }` unwrap — the author never touches preamble strings or
envelopes.

`input`/`output` accept **any Standard Schema** — zod, Effect Schema, Valibot, ArkType. The
author only ever provides a validator; nothing about JSON Schema is authored. (Executor's
internal `tool()` contract happens to want a JSON-schema *form* of the validator too, which
paper-execute derives — the only per-library part, and the reason support ships for zod +
Effect first; other libs validate but need a converter added.) Mix libraries across plugins.

```ts
// @paper-execute/qr — Effect Schema, single scalar in / string out
import { definePaperPlugin } from "paper-execute/plugin";
import { Effect, Schema } from "effect";
import QRCode from "qrcode";

export default definePaperPlugin({
  name: "qr",
  docs: "`plugins.qr.render(text)` → SVG string of a QR code.",

  // this tree IS plugins.qr.* — a node is a leaf (has execute) or a branch (nested).
  // execute may return an Effect, a Promise, or a plain value — all normalized.
  tools: {
    render: {
      input: Schema.String,          // plugins.qr.render("…")
      output: Schema.String,         // returns the svg string directly
      execute: (text) => QRCode.toString(text, { type: "svg" }),   // Promise — fine
    },
    batch: {
      svg: {                          // nesting → plugins.qr.batch.svg([...])
        input: Schema.Array(Schema.String),   // the array is the single arg
        output: Schema.Array(Schema.String),
        execute: (texts) => Effect.forEach(texts, (t) => /* … */),
      },
    },
  },
});
```

No `globals`/`fn`/`args`/`returns` mapping layer — the tree name, the `input` schema, and
the `output` schema fully define the sandbox call.

### faker — an explicit, curated map (not a live-object passthrough)

Rather than proxy the whole faker object (unsafe — a deep proxy could hand back host
references — and unbounded), map the methods worth exposing. Nesting mirrors faker's shape
exactly while keeping the surface intentional; a one-line helper keeps it terse. Uses zod
here to show schema libraries are free to mix:

```ts
// @paper-execute/faker
import { definePaperPlugin } from "paper-execute/plugin";
import { faker } from "@faker-js/faker";
import { z } from "zod";

// no-arg generator returning a string
const gen = (fn: () => string) => ({ output: z.string(), execute: () => fn() });

export default definePaperPlugin({
  name: "faker",
  docs: "Curated faker generators, e.g. `plugins.faker.internet.username()`.",
  tools: {
    internet: { username: gen(() => faker.internet.username()), email: gen(() => faker.internet.email()) },
    company:  { name: gen(() => faker.company.name()), catchPhrase: gen(() => faker.company.catchPhrase()) },
    person:   { fullName: gen(() => faker.person.fullName()) },
  },  // → plugins.faker.internet.username(), plugins.faker.company.catchPhrase(), …
});
```

So `plugins.faker.internet.username()` still calls the real `faker.internet.username()`
host-side and reads identically to faker — you just curate which leaves exist. Chattiness
(each call = one sandbox↔host round-trip) is unchanged and harmless; `Promise.all` if you
ever fill many fields at once.

---

## Decisions locked

- **Namespacing** — `plugins.<name>.*`; `paper.*` stays top-level. Collisions impossible.
- **No mapping layer** — the `tools` tree (leaf `= { input?, output?, execute }`, branch `=`
  nested) is the sandbox shape; multi-level falls out for free.
- **Call arity** — zero or one arg (`undefined | scalar | object`); array counts as one arg.
- **No passthrough** — faker and friends are explicit curated maps, resolving proxy safety.
- **Config** — JSON at `~/.config/paper-execute/config.json` or local override; JSON `$schema`
  for autocomplete; `["icon"]` default.
- **Schemas** — the author provides any Standard Schema (zod/Effect at launch). JSON Schema is
  never authored; paper-execute derives the form executor needs internally.
- **`execute` return** — Effect, Promise, or plain value; all normalized.
- **Trust** — plugins are trusted code, same as a dependency you `bun add`. No allowlist/
  capability system in v1; document it, don't build it.
