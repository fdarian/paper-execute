import { isAbsolute, resolve } from "node:path";
import { cacheTtlFlag, ccFlags } from "@paper-execute/agent-team";
import {
	Atlas,
	AtlasInvalid,
	aliasAdd,
	aliasRm,
	aliasSources,
	codeAdd,
	codeRm,
	docAdd,
	docRm,
	exportAtlas,
	type FeatureStatus,
	featureAdd,
	featureMerge,
	featureRename,
	featureRm,
	featureSet,
	formatList,
	formatShow,
	formatSql,
	initAtlas,
	list,
	relate,
	show,
	sql,
	unrelate,
} from "@paper-execute/draft-atlas";
import { projectLayout } from "@paper-execute/draft-project";
import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { runCartographerAcp, runCartographerClaude } from "./cartographer/run.ts";
import { atlasGroup, inProject, launchInProject, withAtlas, withReadonlyAtlas } from "./run.ts";
import { startAtlasViewServer } from "./view/server.ts";

const statuses = ["built", "planned"] as const satisfies readonly FeatureStatus[];

const switchFlag = (name: string) => Flag.Boolean(name).pipe(Flag.withDefault(false));

const json = switchFlag("json").pipe(Flag.withDescription("Print JSON instead of text"));
const featureArg = (name: string) => Argument.String(name);

/** Agents run from the repo root, so a relative path means "relative to where I am", not to the repo. */
const fromCwd = (path: string) => (isAbsolute(path) ? path : resolve(process.cwd(), path));

const pointer = (path: string, symbol: Option.Option<string>) =>
	Option.match(symbol, { onNone: () => path, onSome: (name) => `${path}#${name}` });

const init = Command.make(
	"init",
	{
		repo: Flag.optional(Flag.String("repo")).pipe(
			Flag.withDescription("Path inside the product repo (default: the cwd)"),
		),
	},
	(config) =>
		inProject((options) =>
			Effect.scoped(
				initAtlas({
					...options,
					repo: Option.match(config.repo, { onNone: () => process.cwd(), onSome: fromCwd }),
				}),
			).pipe(
				Effect.flatMap((handle) =>
					Console.log(
						`atlas ${handle.project} · repo ${handle.repo} · ${projectLayout(handle.dir).atlasDb}`,
					),
				),
			),
		),
).pipe(Command.withDescription("Create the atlas and record the product repo"));

const showCommand = Command.make(
	"show",
	{ terms: Argument.String("term").pipe(Argument.atLeast(1)), json },
	(config) =>
		withAtlas(
			show(config.terms).pipe(
				Effect.map((view) => (config.json ? JSON.stringify(view, null, 2) : formatShow(view))),
			),
		),
).pipe(Command.withDescription("Show features by name, alias or substring"));

const listCommand = Command.make(
	"list",
	{
		status: Flag.optional(Flag.Literals("status", statuses)),
		json,
	},
	(config) =>
		withAtlas(
			list({ status: Option.getOrUndefined(config.status) }).pipe(
				Effect.map((features) =>
					config.json ? JSON.stringify(features, null, 2) : formatList(features),
				),
			),
		),
).pipe(Command.withDescription("List the feature tree"));

const sqlCommand = Command.make(
	"sql",
	{ statement: Argument.String("statement"), json },
	(config) =>
		withReadonlyAtlas(
			sql(config.statement).pipe(
				Effect.map((result) => (config.json ? JSON.stringify(result, null, 2) : formatSql(result))),
			),
		),
).pipe(Command.withDescription("Run a read-only SELECT against the atlas db"));

const featureSetCommand = Command.make(
	"set",
	{
		name: featureArg("name"),
		summary: Flag.optional(Flag.String("summary")).pipe(
			Flag.withDescription("One line; required when creating"),
		),
		parent: Flag.optional(Flag.String("parent")),
		root: switchFlag("root").pipe(Flag.withDescription("Move the feature to the top level")),
		status: Flag.optional(Flag.Literals("status", statuses)),
		verified: switchFlag("verified"),
	},
	(config) =>
		withAtlas(
			Effect.gen(function* () {
				if (config.root && Option.isSome(config.parent)) {
					return yield* new AtlasInvalid({ reason: "--parent and --root cannot be used together" });
				}
				const result = yield* featureSet({
					name: config.name,
					summary: Option.getOrUndefined(config.summary),
					parent: config.root
						? "root"
						: Option.match(config.parent, {
								onNone: () => undefined,
								onSome: (set) => ({ set }),
							}),
					status: Option.getOrUndefined(config.status),
					verified: config.verified,
				});
				return `feature ${result.name} ${result.created ? "created" : "updated"}`;
			}),
		),
).pipe(Command.withDescription("Create or update a feature"));

const featureAddCommand = Command.make(
	"add",
	{
		name: featureArg("name"),
		summary: Flag.String("summary").pipe(Flag.withDescription("One line")),
		parent: Flag.optional(Flag.String("parent")),
		status: Flag.optional(Flag.Literals("status", statuses)),
	},
	(config) =>
		withAtlas(
			featureAdd({
				name: config.name,
				summary: config.summary,
				parent: Option.getOrUndefined(config.parent),
				status: Option.getOrUndefined(config.status),
			}).pipe(Effect.map((result) => `feature ${result.name} created`)),
		),
).pipe(Command.withDescription("Create a feature; fails if the name exists"));

const featureRenameCommand = Command.make(
	"rename",
	{ from: featureArg("old"), to: featureArg("new") },
	(config) =>
		withAtlas(
			featureRename(config.from, config.to).pipe(
				Effect.as(`feature ${config.from} → ${config.to}`),
			),
		),
).pipe(Command.withDescription("Rename a feature; the old name stays as an alias"));

const featureMergeCommand = Command.make(
	"merge",
	{ from: featureArg("from"), into: featureArg("into") },
	(config) =>
		withAtlas(
			featureMerge(config.from, config.into).pipe(
				Effect.as(`feature ${config.from} merged into ${config.into}`),
			),
		),
).pipe(Command.withDescription("Fold a feature into another"));

const featureRmCommand = Command.make("rm", { name: featureArg("name") }, (config) =>
	withAtlas(featureRm(config.name).pipe(Effect.as(`feature ${config.name} removed`))),
).pipe(Command.withDescription("Remove a feature nothing else points to"));

const feature = Command.make("feature").pipe(
	Command.withDescription("Create, rename, merge and remove features"),
	Command.withSubcommands([
		featureAddCommand,
		featureSetCommand,
		featureRenameCommand,
		featureMergeCommand,
		featureRmCommand,
	]),
);

const aliasAddCommand = Command.make(
	"add",
	{
		feature: featureArg("feature"),
		term: Argument.String("term"),
		source: Flag.Literals("source", aliasSources).pipe(
			Flag.withDescription("Where the term was found"),
		),
	},
	(config) =>
		withAtlas(
			aliasAdd(config.feature, config.term, config.source).pipe(
				Effect.as(`alias "${config.term}" → ${config.feature}`),
			),
		),
).pipe(Command.withDescription("Add an alias for a feature"));

const aliasRmCommand = Command.make(
	"rm",
	{ feature: featureArg("feature"), term: Argument.String("term") },
	(config) =>
		withAtlas(
			aliasRm(config.feature, config.term).pipe(
				Effect.as(`alias "${config.term}" removed from ${config.feature}`),
			),
		),
).pipe(Command.withDescription("Remove an alias"));

const alias = Command.make("alias").pipe(
	Command.withDescription("Manage feature aliases"),
	Command.withSubcommands([aliasAddCommand, aliasRmCommand]),
);

const symbolFlag = Flag.optional(Flag.String("symbol")).pipe(
	Flag.withDescription("Symbol the file must contain"),
);

const codeAddCommand = Command.make(
	"add",
	{ feature: featureArg("feature"), path: Argument.String("path"), symbol: symbolFlag },
	(config) =>
		withAtlas(
			codeAdd(config.feature, fromCwd(config.path), Option.getOrUndefined(config.symbol)).pipe(
				Effect.as(`code ${pointer(config.path, config.symbol)} → ${config.feature}`),
			),
		),
).pipe(Command.withDescription("Point a feature at a file in the repo"));

const codeRmCommand = Command.make(
	"rm",
	{ feature: featureArg("feature"), path: Argument.String("path"), symbol: symbolFlag },
	(config) =>
		withAtlas(
			codeRm(config.feature, fromCwd(config.path), Option.getOrUndefined(config.symbol)).pipe(
				Effect.as(`code ${pointer(config.path, config.symbol)} removed from ${config.feature}`),
			),
		),
).pipe(Command.withDescription("Remove a code pointer"));

const code = Command.make("code").pipe(
	Command.withDescription("Manage code pointers"),
	Command.withSubcommands([codeAddCommand, codeRmCommand]),
);

const docAddCommand = Command.make(
	"add",
	{ feature: featureArg("feature"), path: Argument.String("path") },
	(config) =>
		withAtlas(
			docAdd(config.feature, fromCwd(config.path)).pipe(
				Effect.as(`doc ${config.path} → ${config.feature}`),
			),
		),
).pipe(Command.withDescription("Point a feature at a doc in the repo"));

const docRmCommand = Command.make(
	"rm",
	{ feature: featureArg("feature"), path: Argument.String("path") },
	(config) =>
		withAtlas(
			docRm(config.feature, fromCwd(config.path)).pipe(
				Effect.as(`doc ${config.path} removed from ${config.feature}`),
			),
		),
).pipe(Command.withDescription("Remove a doc pointer"));

const doc = Command.make("doc").pipe(
	Command.withDescription("Manage doc pointers"),
	Command.withSubcommands([docAddCommand, docRmCommand]),
);

const relateCommand = Command.make(
	"relate",
	{ a: featureArg("a"), b: featureArg("b"), note: Flag.String("note") },
	(config) =>
		withAtlas(
			relate(config.a, config.b, config.note).pipe(Effect.as(`related ${config.a} ~ ${config.b}`)),
		),
).pipe(Command.withDescription("Link two features with a note"));

const unrelateCommand = Command.make(
	"unrelate",
	{ a: featureArg("a"), b: featureArg("b") },
	(config) =>
		withAtlas(unrelate(config.a, config.b).pipe(Effect.as(`unrelated ${config.a} ~ ${config.b}`))),
).pipe(Command.withDescription("Remove the link between two features"));

const ccCommand = Command.make("cc", { ...ccFlags, cacheTtl: cacheTtlFlag }, (config) =>
	launchInProject((atlas) =>
		runCartographerClaude({
			inputs: atlas,
			continue: config.continue,
			resume: config.resume,
			passthrough: config.args,
			cacheTtl: Option.getOrUndefined(config.cacheTtl),
		}).pipe(Effect.flatMap((exitCode) => Effect.sync(() => process.exit(exitCode)))),
	),
).pipe(
	Command.withDescription(
		"Launch Claude Code with the cartographer agent; pass other claude args after `--` (draft atlas cc -- --verbose)",
	),
);

const acpCommand = Command.make("acp", { cacheTtl: cacheTtlFlag }, (config) =>
	launchInProject((atlas) =>
		runCartographerAcp({ inputs: atlas, cacheTtl: Option.getOrUndefined(config.cacheTtl) }).pipe(
			Effect.flatMap(() => Effect.sync(() => process.exit(0))),
		),
	),
).pipe(Command.withDescription("Run the cartographer agent as an ACP server over stdio"));

const viewCommand = Command.make(
	"view",
	{
		port: Flag.Int("port").pipe(
			Flag.filter(
				(port) => port >= 0 && port <= 65535,
				(port) => `Port ${port} is out of range (0-65535)`,
			),
			Flag.withDefault(0),
			Flag.withDescription("Port to listen on (default: any free port)"),
		),
	},
	(config) =>
		inProject((options) =>
			Effect.gen(function* () {
				// Fails with the init hint before anything listens.
				yield* exportAtlas().pipe(Effect.provide(Atlas.layerReadonly(options)));
				const server = yield* Effect.acquireRelease(
					Effect.sync(() => startAtlasViewServer({ ...options, port: config.port })),
					(started) => Effect.promise(() => started.stop()),
				);
				yield* Console.log(server.url);
				return yield* Effect.never;
			}).pipe(Effect.scoped),
		),
).pipe(
	Command.withDescription("Serve a local web viewer for the atlas; reloads when the atlas changes"),
);

export const atlasCommand = atlasGroup.pipe(
	Command.withDescription("Query and edit the product atlas"),
	Command.withSubcommands([
		init,
		showCommand,
		listCommand,
		sqlCommand,
		feature,
		alias,
		code,
		doc,
		relateCommand,
		unrelateCommand,
		viewCommand,
		ccCommand,
		acpCommand,
	]),
);
