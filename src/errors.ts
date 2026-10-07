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

// `__executorUserActionable`, `code` and `userMessage` make executor pass the message to sandbox code
// instead of replacing it with an opaque "Internal tool error".
export class ImageReadError extends Schema.TaggedError<ImageReadError>()("ImageReadError", {
	path: Schema.String,
	reason: Schema.String,
	cause: Schema.optional(Schema.Defect()),
}) {
	readonly __executorUserActionable = true;
	readonly code = "image_read_failed";
	get userMessage() {
		return `${this.reason}: ${this.path}`;
	}
}

export class ImageDimensionsError extends Schema.TaggedError<ImageDimensionsError>()(
	"ImageDimensionsError",
	{
		path: Schema.String,
		cause: Schema.Defect(),
	},
) {
	readonly __executorUserActionable = true;
	readonly code = "image_dimensions_unknown";
	get userMessage() {
		return `Could not determine the pixel dimensions of ${this.path} (an SVG needs width/height or a viewBox)`;
	}
}

export class ImageUnsupportedTypeError extends Schema.TaggedError<ImageUnsupportedTypeError>()(
	"ImageUnsupportedTypeError",
	{
		path: Schema.String,
		extension: Schema.String,
		supported: Schema.Array(Schema.String),
	},
) {
	readonly __executorUserActionable = true;
	readonly code = "image_unsupported_type";
	get userMessage() {
		return `Unsupported image extension "${this.extension}" for ${this.path}; supported: ${this.supported.join(", ")}`;
	}
}

export class PaperExecutorError extends Schema.TaggedError<PaperExecutorError>()(
	"PaperExecutorError",
	{
		reason: Schema.String,
		cause: Schema.Defect(),
	},
) {}
