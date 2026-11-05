import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { projectLayout } from "@paper-execute/draft-project";
import { Context, Effect, Layer, type Scope } from "effect";

import {
	AtlasConflict,
	AtlasDbError,
	type AtlasError,
	AtlasInvalid,
	AtlasNotFound,
	AtlasNotInitialized,
} from "./errors.ts";
import { migrate, schemaVersion, userVersion } from "./schema.ts";
import { get, run } from "./sqlite.ts";

export type AtlasHandle = {
	readonly project: string;
	readonly dir: string;
	readonly db: Database;
	readonly repo: string;
};

export type AtlasOptions = {
	readonly project: string;
	readonly dir: string;
};

export class Atlas extends Context.Service<
	Atlas,
	AtlasHandle & {
		readonly readonly: boolean;
		/** Full sha of the repo HEAD, resolved on first use and cached for the service's lifetime. */
		readonly head: Effect.Effect<string, AtlasInvalid>;
	}
>()("@paper-execute/draft-atlas/Atlas") {
	static layer(options: AtlasOptions) {
		return Layer.effect(Atlas, openAtlas(options, false));
	}

	static layerReadonly(options: AtlasOptions) {
		return Layer.effect(Atlas, openAtlas(options, true));
	}
}

function toAtlasError(cause: unknown): AtlasError {
	if (
		cause instanceof AtlasNotFound ||
		cause instanceof AtlasInvalid ||
		cause instanceof AtlasConflict ||
		cause instanceof AtlasDbError
	) {
		return cause;
	}
	return toDbError(cause);
}

/** Runs `fn` against the db, mapping thrown domain errors through and wrapping anything else as AtlasDbError. */
export function read<A>(fn: (atlas: AtlasHandle) => A) {
	return Effect.gen(function* () {
		const atlas = yield* Atlas;
		return yield* Effect.try({ try: () => fn(atlas), catch: toAtlasError });
	});
}

/** `fn` runs inside BEGIN IMMEDIATE: throwing a domain error rolls the whole write back. */
export function write<A>(fn: (atlas: AtlasHandle, head: string) => A) {
	return Effect.gen(function* () {
		const atlas = yield* Atlas;
		const head = yield* atlas.head;
		return yield* Effect.try({
			try: () => atlas.db.transaction(() => fn(atlas, head)).immediate(),
			catch: toAtlasError,
		});
	});
}

function gitOutput(repo: string, args: readonly string[]): string {
	const result = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) {
		throw new AtlasInvalid({
			reason: `git ${args.join(" ")} failed in ${repo}: ${result.stderr.toString().trim()}`,
		});
	}
	return result.stdout.toString().trim();
}

function openReadWrite(file: string): Database {
	const db = new Database(file, { create: true });
	db.exec("PRAGMA busy_timeout = 5000");
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA foreign_keys = ON");
	migrate(db);
	return db;
}

function openReadonly(file: string): Database {
	const db = new Database(file, { readonly: true });
	db.exec("PRAGMA busy_timeout = 5000");
	db.exec("PRAGMA query_only = ON");
	const version = userVersion(db);
	if (version !== schemaVersion) {
		db.close();
		throw new AtlasInvalid({
			reason: `Atlas schema is at version ${version}, expected ${schemaVersion}; run a read-write command to migrate it`,
		});
	}
	return db;
}

function toDbError(cause: unknown): AtlasDbError {
	return new AtlasDbError({ reason: cause instanceof Error ? cause.message : String(cause) });
}

function toInvalid(cause: unknown): AtlasInvalid {
	if (cause instanceof AtlasInvalid) return cause;
	return new AtlasInvalid({ reason: cause instanceof Error ? cause.message : String(cause) });
}

function acquireDb(open: () => Database) {
	return Effect.acquireRelease(
		Effect.try({
			try: open,
			catch: (cause) => (cause instanceof AtlasInvalid ? cause : toDbError(cause)),
		}),
		(db) => Effect.sync(() => db.close()),
	);
}

function openAtlas(options: AtlasOptions, readonly: boolean) {
	return Effect.gen(function* () {
		const file = projectLayout(options.dir).atlasDb;
		if (!existsSync(file)) return yield* new AtlasNotInitialized({ dir: options.dir });
		const db = yield* acquireDb(() => (readonly ? openReadonly(file) : openReadWrite(file)));
		const row = yield* Effect.try({
			try: () => get<{ value: string }>(db, "SELECT value FROM meta WHERE key = 'repo'"),
			catch: toDbError,
		});
		if (row === null) {
			return yield* new AtlasInvalid({
				reason: `Atlas in ${options.dir} has no repo set; run \`draft atlas init\``,
			});
		}
		const repo = row.value;
		const head = yield* Effect.cached(
			Effect.try({ try: () => gitOutput(repo, ["rev-parse", "HEAD"]), catch: toInvalid }),
		);
		return Atlas.of({ project: options.project, dir: options.dir, db, repo, readonly, head });
	});
}

export type InitOptions = AtlasOptions & {
	readonly repo: string;
};

/** Creates or updates the atlas for `dir`. Idempotent; the db closes with the scope. */
export function initAtlas(
	options: InitOptions,
): Effect.Effect<AtlasHandle, AtlasInvalid | AtlasDbError, Scope.Scope> {
	return Effect.gen(function* () {
		const repo = yield* Effect.try({
			try: () => realpathSync(gitOutput(options.repo, ["rev-parse", "--show-toplevel"])),
			catch: toInvalid,
		});
		const layout = projectLayout(options.dir);
		const db = yield* acquireDb(() => {
			mkdirSync(layout.common, { recursive: true });
			return openReadWrite(layout.atlasDb);
		});
		yield* Effect.try({
			try: () =>
				db
					.transaction(() =>
						run(
							db,
							"INSERT INTO meta (key, value) VALUES ('repo', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
							repo,
						),
					)
					.immediate(),
			catch: toDbError,
		});
		return { project: options.project, dir: options.dir, db, repo };
	});
}
