import { findIconSvg, iconWeights } from "#/icons/svg";

export type IconRewrite = {
	readonly html: string;
	readonly warnings: readonly string[];
};

const droppedAttributes = new Set(["data-icon", "data-weight"]);

function escapeAttribute(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

/** Expands `<i data-icon="name" data-weight="bold">` into the inline Phosphor SVG. */
export async function rewriteIcons(html: string): Promise<IconRewrite> {
	const warnings: string[] = [];
	const rewriter = new HTMLRewriter().on("i[data-icon]", {
		element(element) {
			const name = element.getAttribute("data-icon");
			const weight = element.getAttribute("data-weight");
			const resolvedWeight = weight === null || weight === "" ? "regular" : weight;
			if (name === null || name === "") {
				warnings.push("icon: empty data-icon");
				return;
			}
			if (!iconWeights.includes(resolvedWeight)) {
				warnings.push(
					`icon: unsupported weight "${resolvedWeight}" for "${name}" (use ${iconWeights.join(", ")})`,
				);
				return;
			}
			const svg = findIconSvg(name, resolvedWeight);
			if (svg === undefined) {
				warnings.push(`icon: unknown icon "${name}"`);
				return;
			}
			const passthrough: string[] = [];
			for (const [attribute, value] of element.attributes) {
				if (!droppedAttributes.has(attribute)) {
					passthrough.push(`${attribute}="${escapeAttribute(value)}"`);
				}
			}
			const attributes = ['width="1em"', 'height="1em"', 'fill="currentColor"', ...passthrough];
			const sized = svg
				.replace(' fill="currentColor"', "")
				.replace("<svg ", `<svg ${attributes.join(" ")} `);
			element.replace(sized, { html: true });
		},
	});
	const rewritten = await rewriter.transform(new Response(html)).text();
	return { html: rewritten, warnings };
}
