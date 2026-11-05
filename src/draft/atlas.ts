import { dirname, join } from "node:path";
import { Atlas, type AtlasOptions } from "@paper-execute/draft-atlas";
import type { CartographerInputs } from "@paper-execute/draft-cartographer";
import { Effect } from "effect";

const draftMain = join(import.meta.dir, "../../packages/draft/cli/src/main.ts");

// The root package ships `designer` and `draft` as sibling binaries in `dist/cli/`.
export function draftCommand(args: readonly string[]): string[] {
	const compiled = Bun.main.startsWith("/$bunfs/");
	return compiled
		? [join(dirname(process.execPath), "draft"), ...args]
		: [process.execPath, draftMain, ...args];
}

/** The cartographer inputs of a project, or `undefined` when it has no atlas. */
export function openProjectAtlas(project: AtlasOptions) {
	return Effect.gen(function* () {
		const atlas = yield* Atlas;
		return {
			project: project.project,
			dir: project.dir,
			repo: atlas.repo,
			atlas: draftCommand(["atlas", "--project", project.project]),
		} satisfies CartographerInputs;
	}).pipe(
		Effect.provide(Atlas.layer(project)),
		Effect.catchTag("AtlasNotInitialized", () => Effect.succeed(undefined)),
	);
}
