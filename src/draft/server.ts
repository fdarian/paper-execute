import { type FSWatcher, statSync, watch } from "node:fs";
import { extname } from "node:path";
import { resolveInside } from "@paper-execute/draft-project";
import { parseViewportWidth } from "./frame.ts";
import { galleryHtml } from "./gallery.ts";
import { rewriteIcons } from "./icons.ts";

export type DraftServerOptions = {
	readonly dir: string;
	readonly port?: number;
	/** Adds the gallery index at `/` and live reload for the human watching. */
	readonly view: boolean;
};

export type DraftServer = {
	readonly url: string;
	/** Icon warnings from the most recent serve of `path` (project-relative), cleared on read. */
	readonly takeWarnings: (path: string) => readonly string[];
	readonly stop: () => Promise<void>;
};

const noCache = { "cache-control": "no-store" };
const reloadDebounceMs = 60;
const heartbeatMs = 15_000;

function isHidden(path: string): boolean {
	return path.split("/").some((segment) => segment.startsWith("."));
}

async function listFrames(dir: string) {
	const paths: string[] = [];
	for await (const path of new Bun.Glob("**/*.html").scan({ cwd: dir, dot: false })) {
		paths.push(path);
	}
	paths.sort();
	return Promise.all(
		paths.map(async (path) => ({
			path,
			width: parseViewportWidth(await Bun.file(resolveInside(dir, path)).text()),
		})),
	);
}

export function startDraftServer(options: DraftServerOptions): DraftServer {
	const warnings = new Map<string, readonly string[]>();
	const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
	const encoder = new TextEncoder();

	const broadcast = (chunk: string) => {
		for (const client of clients) client.enqueue(encoder.encode(chunk));
	};

	const events = () => {
		let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
		const stream = new ReadableStream<Uint8Array>({
			start(started) {
				controller = started;
				clients.add(started);
				started.enqueue(encoder.encode(": connected\n\n"));
			},
			cancel() {
				if (controller !== undefined) clients.delete(controller);
			},
		});
		return new Response(stream, {
			headers: { "content-type": "text/event-stream", ...noCache },
		});
	};

	const serveFile = async (pathname: string): Promise<Response> => {
		let path: string;
		let file: string;
		try {
			path = decodeURIComponent(pathname).replace(/^\/+/, "");
			if (path === "" || isHidden(path)) return new Response("Not found", { status: 404 });
			file = resolveInside(options.dir, path);
		} catch {
			return new Response("Not found", { status: 404 });
		}
		if (!statSync(file, { throwIfNoEntry: false })?.isFile()) {
			return new Response("Not found", { status: 404 });
		}
		const extension = extname(file).toLowerCase();
		if (extension === ".html" || extension === ".htm") {
			const rewritten = await rewriteIcons(await Bun.file(file).text());
			warnings.set(path, rewritten.warnings);
			return new Response(rewritten.html, {
				headers: { "content-type": "text/html; charset=utf-8", ...noCache },
			});
		}
		return new Response(Bun.file(file), { headers: noCache });
	};

	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: options.port ?? 0,
		idleTimeout: 0,
		async fetch(request) {
			const pathname = new URL(request.url).pathname;
			if (options.view) {
				if (pathname === "/") {
					return new Response(galleryHtml, {
						headers: { "content-type": "text/html; charset=utf-8", ...noCache },
					});
				}
				if (pathname === "/__events") return events();
				if (pathname === "/__frames")
					return Response.json(await listFrames(options.dir), { headers: noCache });
			}
			return serveFile(pathname);
		},
	});

	let watcher: FSWatcher | undefined;
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	if (options.view) {
		let pending: ReturnType<typeof setTimeout> | undefined;
		watcher = watch(options.dir, { recursive: true }, (_event, filename) => {
			if (filename !== null && isHidden(filename.replaceAll("\\", "/"))) return;
			clearTimeout(pending);
			pending = setTimeout(() => broadcast("event: change\ndata: {}\n\n"), reloadDebounceMs);
		});
		heartbeat = setInterval(() => broadcast(": ping\n\n"), heartbeatMs);
	}

	return {
		url: `http://127.0.0.1:${server.port}`,
		takeWarnings(path) {
			const found = warnings.get(path);
			warnings.delete(path);
			return found === undefined ? [] : found;
		},
		async stop() {
			watcher?.close();
			clearInterval(heartbeat);
			await server.stop(true);
		},
	};
}
