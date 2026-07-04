import { Schema } from "effect";

export class IconSearchError extends Schema.TaggedErrorClass<IconSearchError>()("IconSearchError", {
	query: Schema.String,
	reason: Schema.String,
}) {}

export class IconSvgError extends Schema.TaggedErrorClass<IconSvgError>()("IconSvgError", {
	name: Schema.String,
	weight: Schema.String,
	cause: Schema.Defect,
}) {}

export class PaperExecutorError extends Schema.TaggedErrorClass<PaperExecutorError>()(
	"PaperExecutorError",
	{
		reason: Schema.String,
		cause: Schema.Defect,
	},
) {}
