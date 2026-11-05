import {
	Atlas,
	type AtlasError,
	AtlasInvalid,
	type AtlasNotInitialized,
	type AtlasOptions,
} from "@paper-execute/draft-atlas";
import { defaultProjectName, projectDir } from "@paper-execute/draft-project";
import { Console, Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";

type CliFailure = AtlasError | AtlasNotInitialized;

export const atlasGroup = Command.make("atlas").pipe(
	Command.withSharedFlags({
		project: Flag.optional(Flag.String("project")).pipe(
			Flag.withDescription("Project name (default: git repo or folder name of the cwd)"),
		),
	}),
);

function markFailed(): void {
	process.exitCode = 1;
}

function describe(error: CliFailure, project: string): string {
	if (error._tag === "AtlasNotInitialized") {
		return `No atlas for project "${project}". Run \`draft atlas --project ${project} init --repo <repo>\` first.`;
	}
	return error.message;
}

const resolveDir = (project: string) =>
	Effect.try({
		try: () => projectDir(project),
		catch: (cause) =>
			new AtlasInvalid({ reason: cause instanceof Error ? cause.message : String(cause) }),
	});

const projectName = Effect.gen(function* () {
	const group = yield* atlasGroup;
	return Option.getOrElse(group.project, () => defaultProjectName(process.cwd()));
});

const printFailure = (error: CliFailure, project: string) =>
	Console.error(`error: ${describe(error, project)}`);

/** Resolves the group's `--project`, runs `body`, and reports an Atlas failure as `error: <message>` with exit code 1. */
export function inProject<E extends CliFailure>(
	body: (options: AtlasOptions) => Effect.Effect<void, E | AtlasInvalid>,
) {
	return Effect.gen(function* () {
		const project = yield* projectName;
		return yield* resolveDir(project).pipe(
			Effect.flatMap((dir) => body({ project, dir })),
			Effect.catch((error: CliFailure) =>
				printFailure(error, project).pipe(Effect.andThen(Effect.sync(markFailed))),
			),
		);
	});
}

export type OpenedAtlas = AtlasOptions & { readonly repo: string };

const repoOf = (options: AtlasOptions) =>
	Effect.gen(function* () {
		const atlas = yield* Atlas;
		return atlas.repo;
	}).pipe(Effect.provide(Atlas.layer(options)));

/**
 * For commands that hand the process to another program. The atlas is opened only to learn its repo and is closed
 * again before `launch` runs. A missing atlas prints `error: …` and exits 1 without calling `launch`.
 */
export function launchInProject<E, R>(launch: (atlas: OpenedAtlas) => Effect.Effect<never, E, R>) {
	return Effect.gen(function* () {
		const project = yield* projectName;
		const atlas = yield* resolveDir(project).pipe(
			Effect.flatMap((dir) =>
				repoOf({ project, dir }).pipe(Effect.map((repo) => ({ project, dir, repo }))),
			),
			Effect.catch((error: CliFailure) =>
				printFailure(error, project).pipe(Effect.andThen(Effect.sync(() => process.exit(1)))),
			),
		);
		return yield* launch(atlas);
	});
}

/** Opens the read-write atlas for this one command and prints the line it returns. */
export function withAtlas<E extends CliFailure>(effect: Effect.Effect<string, E, Atlas>) {
	return inProject((options) =>
		effect.pipe(Effect.flatMap(Console.log), Effect.provide(Atlas.layer(options))),
	);
}

export function withReadonlyAtlas<E extends CliFailure>(effect: Effect.Effect<string, E, Atlas>) {
	return inProject((options) =>
		effect.pipe(Effect.flatMap(Console.log), Effect.provide(Atlas.layerReadonly(options))),
	);
}
