import { existsSync } from "node:fs";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	type AgentSession,
	type AgentSessionEvent,
	createAgentSession,
	ModelRuntime,
	type SessionInfo,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import type {
	DesktopEvent,
	DesktopSnapshot,
	HostMessage,
	HostRequest,
	ModelOption,
	SessionSummary,
	UiMessage,
} from "./protocol.ts";

let workspace: string | undefined;
let session: AgentSession | undefined;
let modelRuntime: ModelRuntime | undefined;
let unsubscribe: (() => void) | undefined;
let inputBuffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
	inputBuffer += chunk;
	while (true) {
		const newline = inputBuffer.indexOf("\n");
		if (newline === -1) return;
		const line = inputBuffer.slice(0, newline).trimEnd();
		inputBuffer = inputBuffer.slice(newline + 1);
		if (line) void handleLine(line);
	}
});

process.on("SIGTERM", dispose);
process.on("SIGINT", dispose);

async function handleLine(line: string): Promise<void> {
	let request: HostRequest;
	try {
		request = JSON.parse(line) as HostRequest;
	} catch (error) {
		write({ type: "event", event: { type: "notice", level: "error", message: errorText(error) } });
		return;
	}

	try {
		const value = await handleRequest(request);
		write({ type: "response", id: request.id, ok: true, value });
	} catch (error) {
		write({ type: "response", id: request.id, ok: false, error: errorText(error) });
	}
}

async function handleRequest(request: HostRequest): Promise<unknown> {
	switch (request.type) {
		case "open-workspace":
			workspace = request.workspace;
			await createSession(resolveSessionManager(request.sessionPath));
			return snapshot();
		case "get-snapshot":
			return snapshot();
		case "list-models":
			return await listModels();
		case "list-sessions":
			return await listSessions();
		case "prompt": {
			const activeSession = requireSession();
			await activeSession.prompt(request.message, { source: "rpc" });
			return undefined;
		}
		case "abort":
			await requireSession().abort();
			return undefined;
		case "new-session":
			await createSession(SessionManager.create(requireWorkspace()));
			return snapshot();
		case "open-session":
			await createSession(SessionManager.open(request.path));
			return snapshot();
		case "set-model": {
			const runtime = requireModelRuntime();
			const model = runtime.getModel(request.provider, request.modelId);
			if (!model) throw new Error(`Model not found: ${request.provider}/${request.modelId}`);
			await requireSession().setModel(model);
			const nextSnapshot = snapshot();
			emit({ type: "snapshot", snapshot: nextSnapshot });
			return nextSnapshot;
		}
		case "set-thinking-level":
			requireSession().setThinkingLevel(request.level);
			return snapshot();
	}
}

async function createSession(sessionManager: SessionManager): Promise<void> {
	const cwd = requireWorkspace();
	if (session?.isStreaming) throw new Error("Stop the active run before starting a new session");
	unsubscribe?.();
	session?.dispose();
	modelRuntime ??= await ModelRuntime.create();
	const result = await createAgentSession({
		cwd,
		modelRuntime,
		sessionManager,
	});
	session = result.session;
	unsubscribe = session.subscribe(handleSessionEvent);
	emit({ type: "snapshot", snapshot: snapshot() });
	if (result.modelFallbackMessage) emit({ type: "notice", level: "info", message: result.modelFallbackMessage });
}

function resolveSessionManager(sessionPath: string | undefined): SessionManager {
	const cwd = requireWorkspace();
	if (sessionPath && existsSync(sessionPath)) return SessionManager.open(sessionPath);
	return SessionManager.continueRecent(cwd);
}

function handleSessionEvent(event: AgentSessionEvent): void {
	switch (event.type) {
		case "agent_start":
			emit({ type: "busy", value: true });
			break;
		case "agent_settled":
			emit({ type: "busy", value: false });
			break;
		case "message_start":
			emit({ type: "message-start", message: toUiMessage(event.message) });
			break;
		case "message_update":
			if (event.assistantMessageEvent.type === "text_delta") {
				emit({ type: "message-delta", kind: "text", delta: event.assistantMessageEvent.delta });
			} else if (event.assistantMessageEvent.type === "thinking_delta") {
				emit({ type: "message-delta", kind: "thinking", delta: event.assistantMessageEvent.delta });
			}
			break;
		case "message_end":
			emit({ type: "message-end", message: toUiMessage(event.message) });
			break;
		case "tool_execution_start":
			emit({ type: "tool-start", id: event.toolCallId, name: event.toolName, args: safeValue(event.args) });
			break;
		case "tool_execution_update":
			emit({
				type: "tool-update",
				id: event.toolCallId,
				name: event.toolName,
				update: safeValue(event.partialResult),
			});
			break;
		case "tool_execution_end":
			emit({
				type: "tool-end",
				id: event.toolCallId,
				name: event.toolName,
				isError: event.isError,
				result: safeValue(event.result),
			});
			break;
		case "auto_retry_start":
			emit({ type: "notice", level: "info", message: `Retrying request (${event.attempt}/${event.maxAttempts})` });
			break;
		case "compaction_start":
			emit({ type: "notice", level: "info", message: `Compacting context: ${event.reason}` });
			break;
	}
}

function snapshot(): DesktopSnapshot {
	return {
		workspace,
		sessionId: session?.sessionId,
		sessionPath: session?.sessionFile,
		sessionName: session?.sessionName,
		model: session?.model ? toModelOption(session.model) : undefined,
		thinkingLevel: session?.thinkingLevel ?? "off",
		isStreaming: session?.isStreaming ?? false,
		messages: session?.state.messages.map(toUiMessage) ?? [],
	};
}

async function listSessions(): Promise<SessionSummary[]> {
	if (!workspace) return [];
	const sessions = await SessionManager.list(workspace);
	return sessions.map(toSessionSummary);
}

async function listModels(): Promise<ModelOption[]> {
	const runtime = requireModelRuntime();
	const models = await runtime.getAvailable();
	return models.map(toModelOption).sort((left, right) => {
		const providerOrder = left.provider.localeCompare(right.provider);
		return providerOrder === 0 ? left.name.localeCompare(right.name) : providerOrder;
	});
}

function toModelOption(model: { provider: string; id: string; name: string; reasoning: boolean }): ModelOption {
	return { provider: model.provider, id: model.id, name: model.name, reasoning: model.reasoning };
}

function toSessionSummary(info: SessionInfo): SessionSummary {
	const named = info.name?.trim();
	const firstMessage = info.firstMessage.replace(/[\x00-\x1f\x7f]/g, " ").trim();
	const title = named || (firstMessage && firstMessage !== "(no messages)" ? firstMessage : "New session");
	return {
		path: info.path,
		id: info.id,
		title,
		modified: info.modified.toISOString(),
		messageCount: info.messageCount,
	};
}

function toUiMessage(message: AgentMessage): UiMessage {
	const value = message as unknown as Record<string, unknown>;
	const role = message.role === "user" ? "user" : message.role === "assistant" ? "assistant" : "tool";
	return {
		role,
		text: messageText(value),
		timestamp: typeof value.timestamp === "number" ? value.timestamp : Date.now(),
		...(typeof value.errorMessage === "string" ? { error: value.errorMessage } : {}),
	};
}

function messageText(message: Record<string, unknown>): string {
	if (typeof message.summary === "string") return message.summary;
	if (typeof message.output === "string") return message.output;
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((block) => {
			if (!block || typeof block !== "object") return [];
			const item = block as Record<string, unknown>;
			if (item.type === "text" && typeof item.text === "string") return [item.text];
			if (item.type === "image") return ["[Image]"];
			return [];
		})
		.join("\n");
}

function safeValue(value: unknown): unknown {
	try {
		return JSON.parse(JSON.stringify(value)) as unknown;
	} catch {
		return String(value);
	}
}

function requireWorkspace(): string {
	if (!workspace) throw new Error("Select a workspace first");
	return workspace;
}

function requireSession(): AgentSession {
	if (!session) throw new Error("Select a workspace first");
	return session;
}

function requireModelRuntime(): ModelRuntime {
	if (!modelRuntime) throw new Error("Select a workspace first");
	return modelRuntime;
}

function emit(event: DesktopEvent): void {
	write({ type: "event", event });
}

function write(message: HostMessage): void {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function dispose(): void {
	unsubscribe?.();
	session?.dispose();
	process.exit(0);
}
