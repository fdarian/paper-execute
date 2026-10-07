import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";

import { readImage } from "#/image/plugin";

const pngBytes = Uint8Array.from(
	atob(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
	),
	(char) => char.charCodeAt(0),
);

// Header-only GIF89a: enough for dimension sniffing, not a decodable image.
function gifBytes(width: number, height: number): Uint8Array {
	return Uint8Array.from([
		...Buffer.from("GIF89a"),
		width & 0xff,
		width >> 8,
		height & 0xff,
		height >> 8,
		0,
		0,
		0,
		0x3b,
	]);
}

let dir: string;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "paper-execute-image-"));
	await writeFile(join(dir, "pixel.PNG"), pngBytes);
	await writeFile(join(dir, "notes.txt"), "not an image");
	await writeFile(join(dir, "wide.gif"), gifBytes(3, 2));
	await writeFile(
		join(dir, "viewbox.svg"),
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12"></svg>',
	);
	await writeFile(join(dir, "sizeless.svg"), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

test("get returns a PNG data URI that round-trips the file bytes with dimensions", async () => {
	const image = await Effect.runPromise(readImage(join(dir, "pixel.PNG")));
	const prefix = "data:image/png;base64,";
	expect(image.src.startsWith(prefix)).toBe(true);
	expect(new Uint8Array(Buffer.from(image.src.slice(prefix.length), "base64"))).toEqual(pngBytes);
	expect(image).toMatchObject({ width: 1, height: 1, mimeType: "image/png" });
});

test("get reads dimensions from a GIF", async () => {
	const image = await Effect.runPromise(readImage(join(dir, "wide.gif")));
	expect(image).toMatchObject({ width: 3, height: 2, mimeType: "image/gif" });
});

test("get reads dimensions from an SVG viewBox", async () => {
	const image = await Effect.runPromise(readImage(join(dir, "viewbox.svg")));
	expect(image).toMatchObject({ width: 24, height: 12, mimeType: "image/svg+xml" });
});

test("get fails on an SVG without any size", async () => {
	const error = await Effect.runPromise(Effect.flip(readImage(join(dir, "sizeless.svg"))));
	expect(error._tag).toBe("ImageDimensionsError");
	expect(error).toHaveProperty("userMessage", expect.stringContaining("sizeless.svg"));
});

test("get fails on an unknown extension", async () => {
	const error = await Effect.runPromise(Effect.flip(readImage(join(dir, "notes.txt"))));
	expect(error._tag).toBe("ImageUnsupportedTypeError");
});

test("get fails on a missing file", async () => {
	const error = await Effect.runPromise(Effect.flip(readImage(join(dir, "missing.png"))));
	expect(error._tag).toBe("ImageReadError");
});

test("failures carry a user-actionable message for the sandbox", async () => {
	const unsupported = await Effect.runPromise(Effect.flip(readImage(join(dir, "notes.txt"))));
	expect(unsupported).toMatchObject({ __executorUserActionable: true });
	expect(unsupported).toHaveProperty("userMessage", expect.stringContaining(".txt"));
	const missing = await Effect.runPromise(Effect.flip(readImage(join(dir, "missing.png"))));
	expect(missing).toHaveProperty("userMessage", expect.stringContaining("missing.png"));
});
