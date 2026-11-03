import { defaultProjectName, projectDir } from "./project.ts";
import { startDraftServer } from "./server.ts";

export async function serveDraftView(
	project: string | undefined,
	port: number | undefined,
): Promise<void> {
	const dir = projectDir(project === undefined ? defaultProjectName(process.cwd()) : project);
	const server = startDraftServer({ dir, port, view: true });
	console.log(`Project: ${dir}`);
	console.log(`Gallery: ${server.url}`);
	await new Promise<void>((resolve) => {
		process.once("SIGINT", resolve);
		process.once("SIGTERM", resolve);
	});
	await server.stop();
}
