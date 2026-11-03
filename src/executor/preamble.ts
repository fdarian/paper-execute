/**
 * Prepended to every agent snippet. Executor wraps each sandbox tool call in an
 * `{ ok, data } | { ok: false, error }` envelope; this preamble unwraps it so
 * agents get a thrown error on failure. Backend (Paper / Brilliant) calls return structuredContent
 * when present, otherwise merges nonempty text-only JSON objects with disjoint
 * keys. Fallback is a string for one text block or the unchanged content array.
 * Plugin helpers unwrap only the executor envelope, not MCP content.
 */
const mcpExecutorPreamble = [
	"const __unwrap = (res) => {",
	"  if (res && typeof res === 'object' && 'ok' in res) {",
	"    if (!res.ok) {",
	"      const e = res.error;",
	"      throw new Error(e && e.message ? e.message : typeof e === 'string' ? e : JSON.stringify(e));",
	"    }",
	"    return res.data;",
	"  }",
	"  return res;",
	"};",
	"const __mcpText = (content) => content.filter((item) => item.type === 'text').map((item) => item.text).join('\\n');",
	"const __parseMcpJson = (text) => {",
	"  try { return JSON.parse(text); } catch (error) {",
	"    if (error instanceof SyntaxError) return undefined;",
	"    throw error;",
	"  }",
	"};",
	"const __mergeMcpText = (content) => {",
	"  if (content.length === 0 || !content.every((item) => item.type === 'text')) return undefined;",
	"  const keys = new Set();",
	"  const entries = [];",
	"  for (const item of content) {",
	"    const object = __parseMcpJson(item.text);",
	"    if (typeof object !== 'object' || object === null || Array.isArray(object)) return undefined;",
	"    for (const entry of Object.entries(object)) {",
	"      if (keys.has(entry[0])) return undefined;",
	"      keys.add(entry[0]);",
	"      entries.push(entry);",
	"    }",
	"  }",
	"  return Object.fromEntries(entries);",
	"};",
	"const __unwrapMcp = (res) => {",
	"  if (res && res.ok === false && res.error && res.error.details && Array.isArray(res.error.details.content)) {",
	"    throw new Error(__mcpText(res.error.details.content));",
	"  }",
	"  const data = __unwrap(res);",
	"  if (data.isError === true) throw new Error(__mcpText(data.content));",
	"  if ('structuredContent' in data) return data.structuredContent;",
	"  const merged = __mergeMcpText(data.content);",
	"  if (merged !== undefined) return merged;",
	"  if (data.content.length === 1 && data.content[0].type === 'text') return data.content[0].text;",
	"  return data.content;",
	"};",
].join("\n");

export function buildExecutorPreamble(backendSlug: string, pluginPreambleSource: string): string {
	const backendProxy = `const ${backendSlug} = new Proxy({}, {
  get: (_t, name) => (...args) => Promise.resolve(tools.${backendSlug}.org.default[name](...args)).then(__unwrapMcp),
});`;
	return `${mcpExecutorPreamble}\n${backendProxy}\n${pluginPreambleSource}`;
}
