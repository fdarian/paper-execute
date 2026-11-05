import { Schema } from "effect";

export class AtlasNotInitialized extends Schema.TaggedError<AtlasNotInitialized>()(
	"AtlasNotInitialized",
	{ dir: Schema.String },
) {
	override get message() {
		return `No atlas in ${this.dir}. Run \`draft atlas init\` first.`;
	}
}

export class AtlasNotFound extends Schema.TaggedError<AtlasNotFound>()("AtlasNotFound", {
	kind: Schema.Literals(["feature", "alias", "code", "doc", "relation"]),
	name: Schema.String,
}) {
	override get message() {
		return `No ${this.kind} "${this.name}"`;
	}
}

export class AtlasInvalid extends Schema.TaggedError<AtlasInvalid>()("AtlasInvalid", {
	reason: Schema.String,
}) {
	override get message() {
		return this.reason;
	}
}

export class AtlasConflict extends Schema.TaggedError<AtlasConflict>()("AtlasConflict", {
	reason: Schema.String,
}) {
	override get message() {
		return this.reason;
	}
}

export class AtlasDbError extends Schema.TaggedError<AtlasDbError>()("AtlasDbError", {
	reason: Schema.String,
}) {
	override get message() {
		return this.reason;
	}
}

/** Everything an atlas operation can fail with once the atlas is open. */
export type AtlasError = AtlasNotFound | AtlasInvalid | AtlasConflict | AtlasDbError;
