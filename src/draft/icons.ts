import { findIconSvg, iconWeights } from "#/icons/svg";

export type IconRewrite = {
	readonly html: string;
	readonly warnings: readonly string[];
};

/** Fills `<i data-icon="name" data-weight="bold">` with the inline Phosphor SVG, 1em square in `currentColor`. */
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
			// The <i> stays so author selectors like `.card i { font-size: 32px }` keep working.
			const style = element.getAttribute("style");
			element.setAttribute("style", `display:inline-flex;${style === null ? "" : style}`);
			element.setInnerContent(svg.replace("<svg ", '<svg width="1em" height="1em" '), {
				html: true,
			});
		},
	});
	const rewritten = await rewriter.transform(new Response(html)).text();
	return { html: rewritten, warnings };
}
