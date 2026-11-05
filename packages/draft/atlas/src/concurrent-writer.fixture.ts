import { Effect } from "effect";

import { Atlas } from "./atlas.ts";
import { featureSet } from "./product.ts";

const dir = process.argv[2];
const prefix = process.argv[3];
if (dir === undefined || prefix === undefined) throw new Error("usage: <dir> <prefix>");

const program = Effect.gen(function* () {
	for (let index = 0; index < 40; index++) {
		yield* featureSet({ name: `${prefix}-${index}`, summary: "concurrent", verified: false });
	}
}).pipe(Effect.provide(Atlas.layer({ project: "demo", dir })));

await Effect.runPromise(program);
