import { type AgentDefinition, type AgentTeam, materializePlugin } from "@paper-execute/agent-team";
import { dataDir, projectLayout } from "@paper-execute/draft-project";

import { cartographerAssets } from "./embedded.ts";

export interface CartographerInputs {
	readonly project: string;
	readonly dir: string;
	readonly repo: string;
	/** Command prefix that runs `draft atlas --project <project>`. */
	readonly atlas: readonly string[];
}

const shellSafe = /^[A-Za-z0-9_@%+=:,./-]+$/;

function shellQuote(arg: string): string {
	return shellSafe.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;
}

function filler(inputs: CartographerInputs): (template: string) => string {
	const values: Record<string, string> = {
		atlas: inputs.atlas.map(shellQuote).join(" "),
		repo: inputs.repo,
		project: inputs.project,
		dir: inputs.dir,
		tokens: projectLayout(inputs.dir).tokens,
	};
	return (template) => {
		const filled = template.replace(/\{\{(\w+)\}\}/g, (placeholder, key: string) => {
			const value = values[key];
			return value === undefined ? placeholder : value;
		});
		const unfilled = filled.match(/\{\{[^}]*\}\}/);
		if (unfilled !== null)
			throw new Error(`Unfilled placeholder ${unfilled[0]} in cartographer asset`);
		return filled;
	};
}

/** The cartographer as a subagent of another session, answering product questions and fixing atlas entries. */
export function cartographerSubagent(inputs: CartographerInputs): AgentDefinition {
	const fill = filler(inputs);
	return {
		description:
			"Answers questions about the product from the atlas and fixes atlas entries that the user or a designer found wrong or missing.",
		model: "sonnet",
		tools: ["Bash", "Read", "Grep", "Glob"],
		prompt: `${fill(cartographerAssets.shared)}\n\n${fill(cartographerAssets.onCall)}`,
	};
}

export function cartographerTeam(inputs: CartographerInputs): AgentTeam {
	const fill = filler(inputs);

	const filledPluginFiles = Object.fromEntries(
		Object.entries(cartographerAssets.pluginFiles).map(([path, content]) => [path, fill(content)]),
	);
	const shared = fill(cartographerAssets.shared);

	return {
		agents: {
			cartographer: {
				description: `Answers questions about ${inputs.project} from its atlas and keeps the atlas correct.`,
				model: "sonnet",
				tools: ["Bash", "Read", "Grep", "Glob", "Write", "Agent", "Skill"],
				prompt: `${shared}\n\n${fill(cartographerAssets.cartographer)}`,
			},
			surveyor: {
				description: `Indexes one area of ${inputs.project} into the atlas and reports the features it wrote.`,
				model: "haiku",
				// The minimum the CLI accepts; keeps a surveyor's context under Haiku's 100K price step.
				autoCompactWindow: 100_000,
				tools: ["Bash", "Read", "Grep", "Glob"],
				prompt: `${shared}\n\n${fill(cartographerAssets.surveyor)}\n\n${fill(cartographerAssets.survey)}`,
			},
		},
		main: "cartographer",
		mcpServers: {},
		pluginDirs: [materializePlugin(`cartographer-${inputs.project}`, filledPluginFiles)],
		addDirs: [inputs.dir, inputs.repo],
		enabledPlugins: {},
		// Absolute, so agents that cd elsewhere still reach the same atlas.
		env: { DRAFT_DATA_DIR: dataDir() },
	};
}
