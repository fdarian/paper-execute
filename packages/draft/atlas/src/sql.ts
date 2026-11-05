import { Effect } from "effect";

import { Atlas, read } from "./atlas.ts";
import { AtlasInvalid } from "./errors.ts";

export type SqlResult = {
	readonly columns: readonly string[];
	readonly rows: readonly (readonly unknown[])[];
};

/** Requires the read-only layer. */
export function sql(statement: string) {
	return Effect.gen(function* () {
		const atlas = yield* Atlas;
		if (!atlas.readonly) {
			return yield* new AtlasInvalid({ reason: "sql runs only on a read-only atlas connection" });
		}
		return yield* read((handle): SqlResult => {
			const prepared = handle.db.query(statement);
			return { columns: prepared.columnNames, rows: prepared.values() };
		});
	});
}
