/**
 * Prepended to every agent snippet. Executor wraps each sandbox tool call in an
 * `{ ok, data } | { ok: false, error }` envelope; this preamble unwraps it so
 * agents get a thrown error on failure. Paper calls return structuredContent
 * when present, otherwise a string (without JSON parsing) for exactly one text
 * block, otherwise the content array without a `.content` wrapper.
 * Icon helpers return SVG strings or search results, not MCP content.
 */
export const paperExecutorPreamble = [
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
	"const __paperText = (content) => content.filter((item) => item.type === 'text').map((item) => item.text).join('\\n');",
	"const __unwrapPaper = (res) => {",
	"  if (res && res.ok === false && res.error && res.error.details && Array.isArray(res.error.details.content)) {",
	"    throw new Error(__paperText(res.error.details.content));",
	"  }",
	"  const data = __unwrap(res);",
	"  if (data.isError === true) throw new Error(__paperText(data.content));",
	"  if ('structuredContent' in data) return data.structuredContent;",
	"  if (data.content.length === 1 && data.content[0].type === 'text') return data.content[0].text;",
	"  return data.content;",
	"};",
	"const paper = new Proxy({}, {",
	"  get: (_t, name) => (...args) => Promise.resolve(tools.paper.org.default[name](...args)).then(__unwrapPaper),",
	"});",
	"const icon_search = (a) => Promise.resolve(tools.iconTools.icon_search(typeof a === 'string' ? { query: a } : a)).then(__unwrap).then((d) => d.results);",
	"const icon_get = (a) => Promise.resolve(tools.iconTools.icon_get(typeof a === 'string' ? { query: a } : a)).then(__unwrap).then((d) => d.svg);",
].join("\n");
