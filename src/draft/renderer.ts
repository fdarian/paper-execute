import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CdpConnection } from "./cdp.ts";

const macChromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const launchTimeoutMs = 20_000;
const loadTimeoutMs = 15_000;
const initialViewportHeight = 900;
const defaultMaxOutputWidth = 960;
// Chrome fails to rasterize textures taller than this.
const maxCaptureHeight = 16_000;

export type RenderRequest = {
	readonly url: string;
	/** Viewport width in CSS pixels. */
	readonly width: number;
	readonly selector?: string;
	/** Downscales a full-frame capture so the PNG is at most this wide. Ignored with a selector. */
	readonly maxWidth?: number;
};

export type RenderResult = {
	readonly png: Buffer;
	/** Size of the captured area in CSS pixels. */
	readonly frame: { readonly width: number; readonly height: number };
	/** Size of the PNG in pixels. */
	readonly output: { readonly width: number; readonly height: number };
	readonly warnings: readonly string[];
};

type Browser = {
	readonly process: Bun.Subprocess;
	readonly connection: CdpConnection;
	readonly userDataDir: string;
};

type Box = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};

export function findChrome(): string | undefined {
	const override = process.env.DRAFT_CHROME_PATH;
	if (override !== undefined && override.length > 0) {
		if (!existsSync(override)) {
			throw new Error(`DRAFT_CHROME_PATH does not exist: ${override}`);
		}
		return override;
	}
	return existsSync(macChromePath) ? macChromePath : undefined;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function readDevToolsUrl(stderr: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stderr.getReader();
	const decoder = new TextDecoder();
	let output = "";
	for (;;) {
		const chunk = await reader.read();
		if (chunk.done) throw new Error(`Chrome exited before DevTools was ready:\n${output.trim()}`);
		output += decoder.decode(chunk.value, { stream: true });
		const match = /DevTools listening on (ws:\/\/\S+)/.exec(output);
		const url = match?.[1];
		if (url !== undefined) {
			// Keep draining so Chrome never blocks on a full stderr pipe.
			void (async () => {
				while (!(await reader.read()).done);
			})();
			return url;
		}
	}
}

const liveRenderers = new Set<ChromeRenderer>();
let exitHooksInstalled = false;

function installExitHooks(): void {
	if (exitHooksInstalled) return;
	exitHooksInstalled = true;
	process.on("exit", () => {
		for (const renderer of liveRenderers) renderer.killNow();
	});
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
		process.on(signal, () => {
			for (const renderer of liveRenderers) renderer.killNow();
			process.exit(128);
		});
	}
}

/** Headless Chrome driven over raw CDP. Starts on first render and is reused until `close`. */
export class ChromeRenderer {
	private browser: Promise<Browser> | undefined;
	private launched: Browser | undefined;

	async render(request: RenderRequest): Promise<RenderResult> {
		const browser = await this.ensureBrowser();
		const connection = browser.connection;
		const target = (await connection.send("Target.createTarget", { url: "about:blank" })) as {
			targetId: string;
		};
		try {
			const attached = (await connection.send("Target.attachToTarget", {
				targetId: target.targetId,
				flatten: true,
			})) as { sessionId: string };
			return await this.capture(connection, attached.sessionId, request);
		} finally {
			// The tab may already be gone if Chrome crashed; the original error is the useful one.
			await connection.send("Target.closeTarget", { targetId: target.targetId }).catch(() => {});
		}
	}

	async close(): Promise<void> {
		const browser = this.launched;
		this.launched = undefined;
		this.browser = undefined;
		liveRenderers.delete(this);
		if (browser === undefined) return;
		browser.connection.close();
		browser.process.kill();
		await browser.process.exited;
		rmSync(browser.userDataDir, { recursive: true, force: true, maxRetries: 3 });
	}

	/** Synchronous teardown for process exit handlers, which cannot await. */
	killNow(): void {
		const browser = this.launched;
		this.launched = undefined;
		this.browser = undefined;
		liveRenderers.delete(this);
		if (browser === undefined) return;
		browser.process.kill("SIGKILL");
		rmSync(browser.userDataDir, { recursive: true, force: true, maxRetries: 3 });
	}

	private ensureBrowser(): Promise<Browser> {
		if (this.browser === undefined) {
			const launching = this.launch();
			this.browser = launching;
			launching.catch(() => {
				if (this.browser === launching) this.browser = undefined;
			});
		}
		return this.browser;
	}

	private async launch(): Promise<Browser> {
		const executable = findChrome();
		if (executable === undefined) {
			throw new Error(
				`Chrome not found. Install Google Chrome or set DRAFT_CHROME_PATH to a Chrome/Chromium executable.`,
			);
		}
		const userDataDir = mkdtempSync(join(tmpdir(), "draft-chrome-"));
		const chrome = Bun.spawn(
			[
				executable,
				"--headless=new",
				"--remote-debugging-port=0",
				`--user-data-dir=${userDataDir}`,
				"--no-first-run",
				"--no-default-browser-check",
				"--hide-scrollbars",
				"--mute-audio",
				"--disable-extensions",
				"--disable-background-networking",
				"about:blank",
			],
			{ stdin: "ignore", stdout: "ignore", stderr: "pipe" },
		);
		try {
			const url = await withTimeout(
				readDevToolsUrl(chrome.stderr),
				launchTimeoutMs,
				"Chrome launch",
			);
			const connection = await CdpConnection.connect(url);
			const browser: Browser = { process: chrome, connection, userDataDir };
			this.launched = browser;
			liveRenderers.add(this);
			installExitHooks();
			void chrome.exited.then(() => {
				if (this.launched === browser) {
					this.launched = undefined;
					this.browser = undefined;
					liveRenderers.delete(this);
					rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 });
				}
			});
			return browser;
		} catch (cause) {
			chrome.kill("SIGKILL");
			rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 });
			throw cause;
		}
	}

	private async capture(
		connection: CdpConnection,
		sessionId: string,
		request: RenderRequest,
	): Promise<RenderResult> {
		const send = (method: string, params: object = {}) =>
			connection.send(method, params, sessionId);
		const evaluate = async (expression: string, awaitPromise = false): Promise<unknown> => {
			const response = (await send("Runtime.evaluate", {
				expression,
				awaitPromise,
				returnByValue: true,
			})) as { result: { value?: unknown }; exceptionDetails?: { text: string } };
			if (response.exceptionDetails !== undefined) {
				throw new Error(`Page script failed: ${response.exceptionDetails.text}`);
			}
			return response.result.value;
		};

		const origin = new URL(request.url).origin;
		const shorten = (url: string) => (url.startsWith(origin) ? url.slice(origin.length) : url);
		const warnings: string[] = [];
		const requestUrls = new Map<string, string>();
		connection.on(sessionId, "Runtime.consoleAPICalled", (params) => {
			const event = params as {
				type: string;
				args: { value?: unknown; description?: string }[];
			};
			if (event.type !== "error") return;
			const text = event.args
				.map((arg) => (arg.value === undefined ? arg.description : String(arg.value)))
				.join(" ");
			warnings.push(`console error: ${text}`);
		});
		connection.on(sessionId, "Runtime.exceptionThrown", (params) => {
			const event = params as {
				exceptionDetails: { text: string; exception?: { description?: string } };
			};
			const details = event.exceptionDetails;
			warnings.push(`script exception: ${details.exception?.description ?? details.text}`);
		});
		connection.on(sessionId, "Network.requestWillBeSent", (params) => {
			const event = params as { requestId: string; request: { url: string } };
			requestUrls.set(event.requestId, event.request.url);
		});
		connection.on(sessionId, "Network.responseReceived", (params) => {
			const event = params as { response: { url: string; status: number } };
			if (event.response.status >= 400 && !event.response.url.endsWith("/favicon.ico")) {
				warnings.push(`request failed: ${event.response.status} ${shorten(event.response.url)}`);
			}
		});
		connection.on(sessionId, "Network.loadingFailed", (params) => {
			const event = params as { requestId: string; errorText: string; canceled?: boolean };
			if (event.canceled) return;
			const url = requestUrls.get(event.requestId);
			warnings.push(
				`request failed: ${event.errorText}${url === undefined ? "" : ` ${shorten(url)}`}`,
			);
		});

		await Promise.all([
			send("Page.enable"),
			send("Runtime.enable"),
			send("Network.enable"),
			send("Emulation.setDeviceMetricsOverride", {
				width: request.width,
				height: initialViewportHeight,
				deviceScaleFactor: 1,
				mobile: false,
			}),
		]);

		const loaded = new Promise<void>((resolve) => {
			const off = connection.on(sessionId, "Page.loadEventFired", () => {
				off();
				resolve();
			});
		});
		const navigation = (await send("Page.navigate", { url: request.url })) as {
			errorText?: string;
		};
		if (navigation.errorText !== undefined) {
			throw new Error(`Navigation failed: ${navigation.errorText}`);
		}
		await withTimeout(loaded, loadTimeoutMs, "Page load");
		await withTimeout(
			evaluate("document.fonts.ready.then(() => true)", true),
			loadTimeoutMs,
			"Font loading",
		);

		const box = (await evaluate(
			request.selector === undefined
				? `({
					x: 0,
					y: 0,
					width: ${request.width},
					height: Math.ceil(Math.max(
						document.documentElement.getBoundingClientRect().height,
						document.body ? document.body.scrollHeight : 0,
					)),
				})`
				: `(() => {
					const element = document.querySelector(${JSON.stringify(request.selector)});
					if (element === null) return null;
					const rect = element.getBoundingClientRect();
					return {
						x: Math.floor(rect.left + scrollX),
						y: Math.floor(rect.top + scrollY),
						width: Math.ceil(rect.width),
						height: Math.ceil(rect.height),
					};
				})()`,
		)) as Box | null;
		if (box === null) {
			throw new Error(`No element matches selector "${request.selector}"`);
		}
		if (box.width === 0 || box.height === 0) {
			throw new Error(`Capture area is empty (${box.width}x${box.height})`);
		}

		const widthScale =
			request.selector === undefined
				? Math.min(
						1,
						(request.maxWidth === undefined ? defaultMaxOutputWidth : request.maxWidth) / box.width,
					)
				: 1;
		const scale = Math.min(widthScale, maxCaptureHeight / box.height);
		const screenshot = (await send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: true,
			clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale },
		})) as { data: string };

		return {
			png: Buffer.from(screenshot.data, "base64"),
			frame: { width: box.width, height: box.height },
			output: { width: Math.round(box.width * scale), height: Math.round(box.height * scale) },
			warnings,
		};
	}
}
