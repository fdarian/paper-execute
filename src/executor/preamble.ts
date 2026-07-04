/**
 * Prepended to every agent snippet. Executor wraps each sandbox tool call in an
 * `{ ok, data } | { ok: false, error }` envelope; this preamble unwraps it so
 * agents work with bare values and get a thrown error on failure — turning
 * `(await tools.paper.org.default.write_html(x)).data` into `await paper.write_html(x)`,
 * and `(await tools.iconTools.icon_get({query})).data.svg` into `await icon_get("acorn")`.
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
	"const paper = new Proxy({}, {",
	"  get: (_t, name) => (...args) => Promise.resolve(tools.paper.org.default[name](...args)).then(__unwrap),",
	"});",
	"const icon_search = (a) => Promise.resolve(tools.iconTools.icon_search(typeof a === 'string' ? { query: a } : a)).then(__unwrap).then((d) => d.results);",
	"const icon_get = (a) => Promise.resolve(tools.iconTools.icon_get(typeof a === 'string' ? { query: a } : a)).then(__unwrap).then((d) => d.svg);",
].join("\n");
