import type { Database, SQLQueryBindings } from "bun:sqlite";

export function all<Row>(db: Database, sql: string, ...params: SQLQueryBindings[]): Row[] {
	return db.query<Row, SQLQueryBindings[]>(sql).all(...params);
}

export function get<Row>(db: Database, sql: string, ...params: SQLQueryBindings[]): Row | null {
	return db.query<Row, SQLQueryBindings[]>(sql).get(...params);
}

export function run(db: Database, sql: string, ...params: SQLQueryBindings[]): number {
	return db.query<unknown, SQLQueryBindings[]>(sql).run(...params).changes;
}
