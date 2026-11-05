import { type FSWatcher, watch } from "node:fs";
import { Atlas, type AtlasOptions, exportAtlas } from "@paper-execute/draft-atlas";
import { projectLayout } from "@paper-execute/draft-project";
import { Effect } from "effect";
import { atlasViewAssets } from "./embedded.ts";

export type AtlasViewServer = {
	readonly url: string;
	readonly stop: () => Promise<void>;
};

const noCache = { "cache-control": "no-store" };
const watchedFiles = new Set(["atlas.db", "atlas.db-wal"]);
const changeDebounceMs = 250;
const heartbeatMs = 15_000;

/** Opens the read-only layer for this one call, so a schema or repo change is seen without a restart. */
export function loadAtlasExport(options: AtlasOptions) {
	return Effect.runPromise(exportAtlas().pipe(Effect.provide(Atlas.layerReadonly(options))));
}

export function startAtlasViewServer(options: AtlasOptions & { readonly port: number }) {
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

	const atlasJson = async () => {
		try {
			return Response.json(await loadAtlasExport(options), { headers: noCache });
		} catch (error) {
			return Response.json(
				{ error: error instanceof Error ? error.message : String(error) },
				{ status: 500, headers: noCache },
			);
		}
	};

	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: options.port,
		idleTimeout: 0,
		fetch(request) {
			const pathname = new URL(request.url).pathname;
			if (pathname === "/") {
				return new Response(atlasViewAssets.page, {
					headers: { "content-type": "text/html; charset=utf-8", ...noCache },
				});
			}
			if (pathname === "/cytoscape.js") {
				return new Response(atlasViewAssets.cytoscape, {
					headers: { "content-type": "text/javascript; charset=utf-8" },
				});
			}
			if (pathname === "/api/atlas") return atlasJson();
			if (pathname === "/__events") return events();
			return new Response("Not found", { status: 404 });
		},
	});

	let pending: ReturnType<typeof setTimeout> | undefined;
	const watcher: FSWatcher = watch(projectLayout(options.dir).common, (_event, filename) => {
		if (filename === null || !watchedFiles.has(filename)) return;
		clearTimeout(pending);
		pending = setTimeout(() => broadcast("event: change\ndata: {}\n\n"), changeDebounceMs);
	});
	const heartbeat = setInterval(() => broadcast(": ping\n\n"), heartbeatMs);

	return {
		url: `http://127.0.0.1:${server.port}`,
		async stop() {
			watcher.close();
			clearTimeout(pending);
			clearInterval(heartbeat);
			await server.stop(true);
		},
	} satisfies AtlasViewServer;
}
