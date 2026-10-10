import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Bun macro: runs at bundle time so the compiled binary carries the SVGs instead of
// reading them from a node_modules path that only exists next to the original checkout.
// Only the regular weight is embedded; the icon plugin never requests another.
export function readRegularIconSvgs(): Record<string, string> {
	const dir = join(
		dirname(fileURLToPath(import.meta.resolve("@phosphor-icons/core"))),
		"../assets/regular",
	);
	const icons: Record<string, string> = {};
	for (const file of readdirSync(dir)) {
		if (!file.endsWith(".svg")) continue;
		icons[file.slice(0, -".svg".length)] = readFileSync(join(dir, file), "utf8");
	}
	return icons;
}
