import { Schema } from "effect";

export class IconSearchError extends Schema.TaggedError<IconSearchError>()("IconSearchError", {
	query: Schema.String,
	reason: Schema.String,
}) {}

export class PaperPluginConfigError extends Schema.TaggedError<PaperPluginConfigError>()(
	"PaperPluginConfigError",
	{
		reason: Schema.String,
	},
) {}

export class PaperPluginLoadError extends Schema.TaggedError<PaperPluginLoadError>()(
	"PaperPluginLoadError",
	{
		entry: Schema.String,
		reason: Schema.String,
		cause: Schema.Defect(),
	},
) {}

export class PaperPluginRegistryError extends Schema.TaggedError<PaperPluginRegistryError>()(
	"PaperPluginRegistryError",
	{
		plugin: Schema.String,
		path: Schema.Array(Schema.String),
		reason: Schema.String,
	},
) {}

export class IconSvgError extends Schema.TaggedError<IconSvgError>()("IconSvgError", {
	name: Schema.String,
	weight: Schema.String,
	cause: Schema.Defect(),
}) {}

export class PaperExecutorError extends Schema.TaggedError<PaperExecutorError>()(
	"PaperExecutorError",
	{
		reason: Schema.String,
		cause: Schema.Defect(),
	},
) {}
