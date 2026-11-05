import { materializePlugin } from "@paper-execute/agent-team";

import { designerAssets } from "./embedded.ts";

export function materializePaperRefsPlugin(): string {
	return materializePlugin("paper-refs", designerAssets.pluginFiles);
}
