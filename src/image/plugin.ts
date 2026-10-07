import { homedir } from "node:os";
import { extname, join } from "node:path";

import { Effect, Schema } from "effect";

import { ImageReadError, ImageUnsupportedTypeError } from "#/errors";
import { definePaperPlugin } from "#/plugin/define";

const mimeByExtension: Readonly<Record<string, string>> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".avif": "image/avif",
};

const ImageGetInput = Schema.toStandardSchemaV1(Schema.String);

const ImageGetOutput = Schema.toStandardSchemaV1(Schema.String);

export const imagePlugin = definePaperPlugin({
	name: "image",
	docs: 'Local image helper. `plugins.image.get(path)` reads an image file (png, jpg, jpeg, gif, webp, svg, avif; a leading `~` is expanded) and returns a `data:<mime>;base64,...` URI string. Embed it by putting the returned string in an `<img src>` inside `paper.write_html`, and always set an explicit width on the `<img>` (e.g. `style="width:600px"`).',
	tools: {
		get: {
			input: ImageGetInput,
			output: ImageGetOutput,
			execute: (path: unknown) => readImageDataUri(path),
		},
	},
});

export function readImageDataUri(path: unknown) {
	return Effect.gen(function* () {
		if (typeof path !== "string") {
			return yield* new ImageReadError({
				path: String(path),
				reason: "Path must be a string",
			});
		}
		const resolvedPath = expandHome(path);
		const extension = extname(resolvedPath).toLowerCase();
		const mime = mimeByExtension[extension];
		if (mime === undefined) {
			return yield* new ImageUnsupportedTypeError({
				path,
				extension,
				supported: Object.keys(mimeByExtension),
			});
		}
		const bytes = yield* Effect.tryPromise({
			try: () => Bun.file(resolvedPath).bytes(),
			catch: (cause) => new ImageReadError({ path, reason: "Failed to read image file", cause }),
		});
		return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
	});
}

function expandHome(path: string): string {
	if (path === "~") {
		return homedir();
	}
	if (path.startsWith("~/")) {
		return join(homedir(), path.slice(2));
	}
	return path;
}
