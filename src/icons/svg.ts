import { Effect } from "effect";

import { IconSvgError } from "#/errors";

const iconWeights = ["regular", "thin", "light", "bold", "fill", "duotone"] as const;

type IconWeight = (typeof iconWeights)[number];

type IconSvgOptions = {
	readonly name: string;
	readonly weight: IconWeight;
	readonly size?: number;
	readonly color?: string;
};

function resolveIconSvgPath(name: string, weight: IconWeight): string {
	return new URL(
		`../../node_modules/@phosphor-icons/core/assets/${weight}/${name}.svg`,
		import.meta.url,
	).pathname;
}

function patchSvg(svg: string, options: IconSvgOptions): string {
	let patched = svg;
	if (options.size !== undefined) {
		patched = patched.replace("<svg ", `<svg width="${options.size}" height="${options.size}" `);
	}
	if (options.color !== undefined) {
		patched = patched.replace("<svg ", `<svg fill="${options.color}" color="${options.color}" `);
	}
	return patched;
}

export function readIconSvg(options: IconSvgOptions) {
	return Effect.tryPromise({
		try: async () => {
			const file = Bun.file(resolveIconSvgPath(options.name, options.weight));
			const svg = await file.text();
			return patchSvg(svg, options);
		},
		catch: (cause) => new IconSvgError({ name: options.name, weight: options.weight, cause }),
	});
}

export type { IconWeight };
export { iconWeights };
