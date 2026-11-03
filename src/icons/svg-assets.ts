import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Bun macro: runs at bundle time so the compiled binary carries the SVGs instead of
// reading them from a node_modules path that only exists next to the original checkout.
// Only regular, bold and fill are embedded; other weights would triple the binary's icon payload.
export function readIconSvgsByWeight(): Record<string, Record<string, string>> {
	const assets = join(
		dirname(fileURLToPath(import.meta.resolve("@phosphor-icons/core"))),
		"../assets",
	);
	const byWeight: Record<string, Record<string, string>> = {};
	for (const weight of ["regular", "bold", "fill"]) {
		const suffix = weight === "regular" ? "" : `-${weight}`;
		const icons: Record<string, string> = {};
		for (const file of readdirSync(join(assets, weight))) {
			if (!file.endsWith(`${suffix}.svg`)) continue;
			icons[file.slice(0, -`${suffix}.svg`.length)] = readFileSync(
				join(assets, weight, file),
				"utf8",
			);
		}
		byWeight[weight] = icons;
	}
	return byWeight;
}
