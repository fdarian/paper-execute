import type { Database } from "bun:sqlite";

const kebabName = `length(name) > 0
	AND name NOT GLOB '*[^a-z0-9-]*'
	AND name NOT GLOB '-*'
	AND name NOT GLOB '*-'
	AND name NOT GLOB '*--*'`;

export const aliasSources = ["commit", "pr", "plan", "doc", "route", "ui", "code", "user"] as const;

const sqlList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

export const migrations: readonly string[] = [
	`
CREATE TABLE meta (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

CREATE TABLE feature (
	id INTEGER PRIMARY KEY,
	name TEXT NOT NULL UNIQUE CHECK (${kebabName}),
	summary TEXT NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('built', 'planned')),
	confidence TEXT NOT NULL CHECK (confidence IN ('seeded', 'verified')),
	parent_id INTEGER REFERENCES feature (id) ON DELETE RESTRICT,
	seen_at TEXT NOT NULL
);
CREATE INDEX feature_parent ON feature (parent_id);

CREATE TABLE alias (
	term TEXT COLLATE NOCASE NOT NULL,
	feature_id INTEGER NOT NULL REFERENCES feature (id) ON DELETE CASCADE,
	source TEXT NOT NULL CHECK (source IN (${sqlList(aliasSources)})),
	PRIMARY KEY (term, feature_id)
);
CREATE INDEX alias_feature ON alias (feature_id);

CREATE TABLE code (
	id INTEGER PRIMARY KEY,
	feature_id INTEGER NOT NULL REFERENCES feature (id) ON DELETE CASCADE,
	path TEXT NOT NULL,
	symbol TEXT
);
CREATE UNIQUE INDEX code_unique ON code (feature_id, path, IFNULL(symbol, ''));

CREATE TABLE doc (
	id INTEGER PRIMARY KEY,
	feature_id INTEGER NOT NULL REFERENCES feature (id) ON DELETE CASCADE,
	path TEXT NOT NULL,
	UNIQUE (feature_id, path)
);

CREATE TABLE relation (
	a_id INTEGER NOT NULL REFERENCES feature (id) ON DELETE CASCADE,
	b_id INTEGER NOT NULL REFERENCES feature (id) ON DELETE CASCADE,
	note TEXT NOT NULL,
	CHECK (a_id < b_id),
	PRIMARY KEY (a_id, b_id)
);
CREATE INDEX relation_b ON relation (b_id);

CREATE TABLE decision (
	id INTEGER PRIMARY KEY,
	text TEXT NOT NULL,
	date TEXT NOT NULL,
	source TEXT
);

CREATE TABLE ref (
	id INTEGER PRIMARY KEY,
	file TEXT NOT NULL UNIQUE,
	app TEXT NOT NULL,
	viewport TEXT NOT NULL,
	route TEXT,
	caption TEXT NOT NULL,
	captured_at TEXT NOT NULL,
	"commit" TEXT NOT NULL,
	replaced_by_id INTEGER REFERENCES ref (id) ON DELETE SET NULL
);

CREATE TABLE frame (
	id INTEGER PRIMARY KEY,
	path TEXT NOT NULL UNIQUE,
	state TEXT NOT NULL CHECK (state IN ('proposed', 'accepted', 'rejected', 'shipped')),
	date TEXT NOT NULL,
	caption TEXT NOT NULL,
	supersedes_id INTEGER REFERENCES frame (id) ON DELETE SET NULL
);

CREATE TABLE decision_feature (
	decision_id INTEGER NOT NULL REFERENCES decision (id) ON DELETE CASCADE,
	feature_id INTEGER NOT NULL REFERENCES feature (id) ON DELETE CASCADE,
	PRIMARY KEY (decision_id, feature_id)
);
CREATE INDEX decision_feature_feature ON decision_feature (feature_id);

CREATE TABLE decision_frame (
	decision_id INTEGER NOT NULL REFERENCES decision (id) ON DELETE CASCADE,
	frame_id INTEGER NOT NULL REFERENCES frame (id) ON DELETE CASCADE,
	PRIMARY KEY (decision_id, frame_id)
);
CREATE INDEX decision_frame_frame ON decision_frame (frame_id);

CREATE TABLE ref_feature (
	ref_id INTEGER NOT NULL REFERENCES ref (id) ON DELETE CASCADE,
	feature_id INTEGER NOT NULL REFERENCES feature (id) ON DELETE CASCADE,
	PRIMARY KEY (ref_id, feature_id)
);
CREATE INDEX ref_feature_feature ON ref_feature (feature_id);

CREATE TABLE frame_feature (
	frame_id INTEGER NOT NULL REFERENCES frame (id) ON DELETE CASCADE,
	feature_id INTEGER NOT NULL REFERENCES feature (id) ON DELETE CASCADE,
	PRIMARY KEY (frame_id, feature_id)
);
CREATE INDEX frame_feature_feature ON frame_feature (feature_id);

CREATE TABLE frame_ref (
	frame_id INTEGER NOT NULL REFERENCES frame (id) ON DELETE CASCADE,
	ref_id INTEGER NOT NULL REFERENCES ref (id) ON DELETE CASCADE,
	PRIMARY KEY (frame_id, ref_id)
);
CREATE INDEX frame_ref_ref ON frame_ref (ref_id);
`,
	// The atlas maps only the shipped product, so a feature has no status. SQLite accepts DROP COLUMN
	// here because the CHECK constraint belongs to the dropped column itself; no table rebuild, so
	// the ON DELETE CASCADE children are never touched.
	"ALTER TABLE feature DROP COLUMN status;",
];

export const schemaVersion = migrations.length;

export function userVersion(db: Database): number {
	const row = db.query<{ user_version: number }, []>("PRAGMA user_version").get();
	if (row === null) throw new Error("PRAGMA user_version returned no row");
	return row.user_version;
}

/** Applies pending migrations under BEGIN IMMEDIATE so concurrent first opens serialize. */
export function migrate(db: Database): void {
	db.transaction(() => {
		const current = userVersion(db);
		if (current > schemaVersion) {
			throw new Error(
				`Atlas schema version ${current} is newer than this build supports (${schemaVersion})`,
			);
		}
		migrations.slice(current).forEach((statements, offset) => {
			db.exec(statements);
			db.exec(`PRAGMA user_version = ${current + offset + 1}`);
		});
	}).immediate();
}
