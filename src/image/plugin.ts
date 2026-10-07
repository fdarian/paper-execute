import { homedir } from "node:os";
import { extname, join } from "node:path";

import { Effect, Schema } from "effect";
import { imageSize } from "image-size";

import { ImageDimensionsError, ImageReadError, ImageUnsupportedTypeError } from "#/errors";
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

const ImageGetOutput = Schema.toStandardSchemaV1(
	Schema.Struct({
		src: Schema.String,
		width: Schema.Number,
		height: Schema.Number,
		mimeType: Schema.String,
	}),
);

export const imagePlugin = definePaperPlugin({
	name: "image",
	instructions:
		// biome-ignore lint/suspicious/noTemplateCurlyInString: the example is code shown to the model
		'When the user gives a local image file path (screenshot, photo, etc.) to put into Paper, use `plugins.image.get(path)`; never read the file yourself. It returns `{ src, width, height, mimeType }`: `src` is a data URI, width/height are intrinsic pixels (`~` expands). Embed with `<img src="${img.src}" style="width:${W}px;aspect-ratio:${img.width}/${img.height}" />` in `paper.write_html`; width plus aspect-ratio are required or Paper collapses the height to 0. The size can also size the artboard.',
	tools: {
		get: {
			input: ImageGetInput,
			output: ImageGetOutput,
			execute: (path: unknown) => readImage(path),
		},
	},
});

export function readImage(path: unknown) {
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
		const size = yield* Effect.try({
			try: () => imageSize(bytes),
			catch: (cause) => new ImageDimensionsError({ path, cause }),
		});
		return {
			src: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
			width: size.width,
			height: size.height,
			mimeType: mime,
		};
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
