type Pending = {
	readonly resolve: (result: unknown) => void;
	readonly reject: (error: Error) => void;
	readonly method: string;
};

type Listener = (params: unknown) => void;

type CdpMessage = {
	readonly id?: number;
	readonly method?: string;
	readonly params?: unknown;
	readonly result?: unknown;
	readonly error?: { readonly message: string };
	readonly sessionId?: string;
};

/** Minimal Chrome DevTools Protocol client over Bun's WebSocket, speaking to the browser endpoint. */
export class CdpConnection {
	private nextId = 1;
	private readonly pending = new Map<number, Pending>();
	private readonly listeners = new Map<string, Set<Listener>>();

	private constructor(private readonly socket: WebSocket) {
		socket.addEventListener("message", (event) => this.dispatch(String(event.data)));
		socket.addEventListener("close", () => this.failPending("DevTools connection closed"));
	}

	static connect(url: string): Promise<CdpConnection> {
		return new Promise((resolve, reject) => {
			const socket = new WebSocket(url);
			socket.addEventListener("open", () => resolve(new CdpConnection(socket)), { once: true });
			socket.addEventListener("error", () => reject(new Error(`Cannot connect to ${url}`)), {
				once: true,
			});
		});
	}

	send(method: string, params: object, sessionId?: string): Promise<unknown> {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject, method });
			this.socket.send(JSON.stringify({ id, method, params, sessionId }));
		});
	}

	/** Subscribes to an event on one session; returns the unsubscribe function. */
	on(sessionId: string, method: string, listener: Listener): () => void {
		const key = `${sessionId}:${method}`;
		let set = this.listeners.get(key);
		if (set === undefined) {
			set = new Set();
			this.listeners.set(key, set);
		}
		set.add(listener);
		return () => set.delete(listener);
	}

	close(): void {
		this.socket.close();
	}

	private dispatch(raw: string): void {
		const message = JSON.parse(raw) as CdpMessage;
		if (message.id !== undefined) {
			const pending = this.pending.get(message.id);
			if (pending === undefined) return;
			this.pending.delete(message.id);
			if (message.error !== undefined) {
				pending.reject(new Error(`${pending.method}: ${message.error.message}`));
			} else {
				pending.resolve(message.result);
			}
			return;
		}
		if (message.method === undefined || message.sessionId === undefined) return;
		const set = this.listeners.get(`${message.sessionId}:${message.method}`);
		if (set === undefined) return;
		for (const listener of set) listener(message.params);
	}

	private failPending(reason: string): void {
		for (const pending of this.pending.values()) pending.reject(new Error(reason));
		this.pending.clear();
	}
}
