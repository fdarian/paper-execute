import { Effect } from "effect";

import { IconSvgError } from "#/errors";

import { readIconSvgsByWeight } from "./svg-assets.ts" with { type: "macro" };

const svgsByWeight = readIconSvgsByWeight();

export const iconWeights = Object.keys(svgsByWeight);

export function findIconSvg(name: string, weight: string): string | undefined {
	if (!Object.hasOwn(svgsByWeight, weight)) return undefined;
	const svgs = svgsByWeight[weight];
	if (svgs === undefined || !Object.hasOwn(svgs, name)) return undefined;
	return svgs[name];
}

type IconSvgOptions = {
	readonly name: string;
	readonly size?: number;
	readonly color?: string;
};

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
	return Effect.try({
		try: () => {
			const svg = findIconSvg(options.name, "regular");
			if (svg === undefined) {
				throw new Error(`No icon named "${options.name}"`);
			}
			return patchSvg(svg, options);
		},
		catch: (cause) =>
			new IconSvgError({
				name: options.name,
				reason: cause instanceof Error ? cause.message : String(cause),
			}),
	});
}
