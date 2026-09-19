import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DesktopEvent, HostMessage, HostRequestInput } from "./protocol.ts";

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
};

export class AgentProcess {
	private child: ChildProcessWithoutNullStreams | undefined;
	private nextRequestId = 1;
	private readonly pending = new Map<number, PendingRequest>();
	private outputBuffer = "";
	private stopping = false;
	private readonly onEvent: (event: DesktopEvent) => void;

	constructor(onEvent: (event: DesktopEvent) => void) {
		this.onEvent = onEvent;
	}

	start(): void {
		if (this.child) return;

		const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
		const repositoryRoot = resolve(packageDir, "../..");
		const isDevelopment = Boolean((process as NodeJS.Process & { defaultApp?: boolean }).defaultApp);
		const nodeExecutable = process.env.PI_DESKTOP_NODE ?? "node";
		const entry = isDevelopment
			? join(packageDir, "src", "agent-host.ts")
			: join(packageDir, "dist", "agent-host.js");
		const args = isDevelopment
			? [
					join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs"),
					"--tsconfig",
					join(repositoryRoot, "tsconfig.json"),
					entry,
				]
			: [entry];

		this.child = spawn(nodeExecutable, args, {
			cwd: repositoryRoot,
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		this.child.stdout.setEncoding("utf8");
		this.child.stderr.setEncoding("utf8");
		this.child.stdout.on("data", (chunk: string) => this.consumeOutput(chunk));
		this.child.stderr.on("data", (chunk: string) => {
			const message = chunk.trim();
			if (message) this.onEvent({ type: "notice", level: "error", message });
		});
		this.child.on("error", (error) => this.stopWithError(error));
		this.child.on("exit", (code, signal) => {
			this.child = undefined;
			if (this.stopping) return;
			const error = new Error(`Agent Host exited (${code ?? signal ?? "unknown"})`);
			this.stopWithError(error);
		});
	}

	request<T>(request: HostRequestInput): Promise<T> {
		this.start();
		const child = this.child;
		if (!child) return Promise.reject(new Error("Agent Host is unavailable"));

		const id = this.nextRequestId++;
		return new Promise<T>((resolveRequest, rejectRequest) => {
			this.pending.set(id, {
				resolve: (value) => resolveRequest(value as T),
				reject: rejectRequest,
			});
			child.stdin.write(`${JSON.stringify({ ...request, id })}\n`);
		});
	}

	dispose(): void {
		this.stopping = true;
		this.child?.kill();
		this.child = undefined;
		const error = new Error("Agent Host stopped");
		for (const request of this.pending.values()) request.reject(error);
		this.pending.clear();
	}

	private stopWithError(error: Error): void {
		for (const request of this.pending.values()) request.reject(error);
		this.pending.clear();
		this.onEvent({ type: "busy", value: false });
		this.onEvent({ type: "notice", level: "error", message: error.message });
	}

	private consumeOutput(chunk: string): void {
		this.outputBuffer += chunk;
		while (true) {
			const newline = this.outputBuffer.indexOf("\n");
			if (newline === -1) return;
			const line = this.outputBuffer.slice(0, newline).trimEnd();
			this.outputBuffer = this.outputBuffer.slice(newline + 1);
			if (!line) continue;
			this.handleMessage(line);
		}
	}

	private handleMessage(line: string): void {
		let message: HostMessage;
		try {
			message = JSON.parse(line) as HostMessage;
		} catch {
			this.onEvent({ type: "notice", level: "error", message: `Invalid Agent Host output: ${line}` });
			return;
		}

		if (message.type === "event") {
			this.onEvent(message.event);
			return;
		}

		const request = this.pending.get(message.id);
		if (!request) return;
		this.pending.delete(message.id);
		if (message.ok) request.resolve(message.value);
		else request.reject(new Error(message.error));
	}
}
