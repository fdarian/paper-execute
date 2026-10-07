import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";

import { readImageDataUri } from "#/image/plugin";

const pngBytes = Uint8Array.from(
	atob(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
	),
	(char) => char.charCodeAt(0),
);

let dir: string;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "paper-execute-image-"));
	await writeFile(join(dir, "pixel.PNG"), pngBytes);
	await writeFile(join(dir, "notes.txt"), "not an image");
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

test("get returns a PNG data URI that round-trips the file bytes", async () => {
	const uri = await Effect.runPromise(readImageDataUri(join(dir, "pixel.PNG")));
	const prefix = "data:image/png;base64,";
	expect(uri.startsWith(prefix)).toBe(true);
	expect(new Uint8Array(Buffer.from(uri.slice(prefix.length), "base64"))).toEqual(pngBytes);
});

test("get fails on an unknown extension", async () => {
	const error = await Effect.runPromise(Effect.flip(readImageDataUri(join(dir, "notes.txt"))));
	expect(error._tag).toBe("ImageUnsupportedTypeError");
});

test("get fails on a missing file", async () => {
	const error = await Effect.runPromise(Effect.flip(readImageDataUri(join(dir, "missing.png"))));
	expect(error._tag).toBe("ImageReadError");
});

test("failures carry a user-actionable message for the sandbox", async () => {
	const unsupported = await Effect.runPromise(
		Effect.flip(readImageDataUri(join(dir, "notes.txt"))),
	);
	expect(unsupported).toMatchObject({ __executorUserActionable: true });
	expect(unsupported).toHaveProperty("userMessage", expect.stringContaining(".txt"));
	const missing = await Effect.runPromise(Effect.flip(readImageDataUri(join(dir, "missing.png"))));
	expect(missing).toHaveProperty("userMessage", expect.stringContaining("missing.png"));
});
