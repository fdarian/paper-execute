import type { Register } from "claude-code";

type Reference = {
	marker: string;
	fileId: string;
	pageId: string | undefined;
	nodeId: string | undefined;
};

function referenceBlock(references: readonly Reference[]): string {
	const lines = [
		"<paper_references>",
		"IDs for the [ref-N] markers above; pass them to paper.* APIs (fileId, pageId, node IDs).",
	];
	for (const fileId of new Set(references.map((ref) => ref.fileId))) {
		const fileRefs = references.filter((ref) => ref.fileId === fileId);
		const fileRef = fileRefs.find((ref) => ref.pageId === undefined);
		lines.push(
			`${fileRef === undefined ? "" : `${fileRef.marker} `}file ${fileId}`,
		);
		for (const pageId of new Set(fileRefs.map((ref) => ref.pageId))) {
			if (pageId === undefined) continue;
			const pageRefs = fileRefs.filter((ref) => ref.pageId === pageId);
			const pageRef = pageRefs.find((ref) => ref.nodeId === undefined);
			lines.push(
				`  ${pageRef === undefined ? "" : `${pageRef.marker} `}page ${pageId}`,
			);
			for (const ref of pageRefs) {
				if (ref.nodeId !== undefined) {
					lines.push(`    ${ref.marker} node ${ref.nodeId}`);
				}
			}
		}
	}
	lines.push("</paper_references>");
	return lines.join("\n");
}

export const register: Register = (on) => {
	on("prompt.submit", (_$, e, next) => {
		const references: Reference[] = [];
		const text = e.text.replace(
			/https:\/\/app\.paper\.design\/file\/([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_-]+))?)?(?:[?#][^\s<>"'`()[\]{},;!]*)?/g,
			(
				url: string,
				fileId: string,
				pageId: string | undefined,
				nodeId: string | undefined,
			) => {
				const existing = references.find(
					(ref) =>
						ref.fileId === fileId &&
						ref.pageId === pageId &&
						ref.nodeId === nodeId,
				);
				const ref =
					existing === undefined
						? {
								marker: `[ref-${references.length + 1}]`,
								fileId,
								pageId,
								nodeId,
							}
						: existing;
				if (existing === undefined) references.push(ref);
				const punctuation = url.match(/[.?:…]+$/);
				return `${ref.marker}${punctuation === null ? "" : punctuation[0]}`;
			},
		);
		if (references.length === 0) return next(e);
		return next({ ...e, text: `${text}\n\n${referenceBlock(references)}` });
	});
};
