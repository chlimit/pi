/// <reference lib="dom" />

import type {
	DesktopApi,
	DesktopEvent,
	DesktopSnapshot,
	ModelOption,
	SessionSummary,
	ThinkingLevel,
	UiMessage,
} from "./protocol.ts";

declare global {
	interface Window {
		piDesktop: DesktopApi;
	}
}

const workspaceButton = element<HTMLButtonElement>("workspace-button");
const newSessionButton = element<HTMLButtonElement>("new-session-button");
const modelSelect = element<HTMLSelectElement>("model-select");
const thinkingSelect = element<HTMLSelectElement>("thinking-select");
const transcript = element<HTMLElement>("transcript");
const emptyState = element<HTMLElement>("empty-state");
const composer = element<HTMLTextAreaElement>("composer");
const sendButton = element<HTMLButtonElement>("send-button");
const stopButton = element<HTMLButtonElement>("stop-button");
const workspaceLabel = element<HTMLElement>("workspace-label");
const sessionLabel = element<HTMLElement>("session-label");
const sessionList = element<HTMLElement>("session-list");
const statusLabel = element<HTMLElement>("status-label");
const notice = element<HTMLElement>("notice");

let snapshot: DesktopSnapshot | undefined;
let models: ModelOption[] = [];
let sessions: SessionSummary[] = [];
let streamingArticle: HTMLElement | undefined;
let streamingText: HTMLElement | undefined;
let streamingThinking: HTMLElement | undefined;
const tools = new Map<string, HTMLElement>();

workspaceButton.addEventListener(
	"click",
	() =>
		void run(async () => {
			const selected = await window.piDesktop.selectWorkspace();
			if (selected) applySnapshot(selected);
		}),
);

newSessionButton.addEventListener(
	"click",
	() => void run(async () => applySnapshot(await window.piDesktop.newSession())),
);

modelSelect.addEventListener(
	"change",
	() =>
		void run(async () => {
			const model = models[Number(modelSelect.value)];
			if (model) applySnapshot(await window.piDesktop.setModel(model.provider, model.id));
		}),
);

thinkingSelect.addEventListener(
	"change",
	() =>
		void run(async () => {
			applySnapshot(await window.piDesktop.setThinkingLevel(thinkingSelect.value as ThinkingLevel));
		}),
);

sendButton.addEventListener("click", () => void sendPrompt());
stopButton.addEventListener("click", () => void run(() => window.piDesktop.abort()));
composer.addEventListener("keydown", (event) => {
	if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault();
		void sendPrompt();
	}
});

window.piDesktop.onEvent(handleEvent);
void run(async () => applySnapshot(await window.piDesktop.getSnapshot()));

async function sendPrompt(): Promise<void> {
	const message = composer.value.trim();
	if (!message || !snapshot?.workspace || snapshot.isStreaming) return;
	composer.value = "";
	await run(() => window.piDesktop.prompt(message));
}

function handleEvent(event: DesktopEvent): void {
	switch (event.type) {
		case "snapshot":
			applySnapshot(event.snapshot);
			break;
		case "busy":
			if (snapshot) {
				snapshot = { ...snapshot, isStreaming: event.value };
				updateControls();
				if (!event.value) void run(refreshSessions);
			}
			break;
		case "message-start":
			if (event.message.role === "assistant") beginAssistantMessage();
			else if (event.message.role === "user") appendMessage(event.message);
			break;
		case "message-delta":
			appendDelta(event.kind, event.delta);
			break;
		case "message-end":
			finishMessage(event.message);
			break;
		case "tool-start":
			appendTool(event.id, event.name, event.args);
			break;
		case "tool-update":
			updateTool(event.id, event.update);
			break;
		case "tool-end":
			finishTool(event.id, event.isError, event.result);
			break;
		case "notice":
			showNotice(event.message, event.level);
			break;
	}
}

function applySnapshot(value: DesktopSnapshot): void {
	snapshot = value;
	workspaceLabel.textContent = value.workspace ?? "No workspace selected";
	sessionLabel.textContent = currentSessionTitle(value) ?? "Select a project to begin";
	thinkingSelect.value = value.thinkingLevel;
	transcript.replaceChildren(emptyState);
	tools.clear();
	streamingArticle = undefined;
	streamingText = undefined;
	streamingThinking = undefined;
	for (const message of value.messages) appendMessage(message);
	emptyState.hidden = value.messages.length > 0;
	updateControls();
	if (value.workspace) {
		void run(refreshModels);
		void run(refreshSessions);
	} else {
		sessions = [];
		renderSessionList();
	}
}

async function refreshSessions(): Promise<void> {
	if (!snapshot?.workspace) {
		sessions = [];
		renderSessionList();
		return;
	}
	sessions = sessionsWithCurrent(await window.piDesktop.listSessions());
	renderSessionList();
}

function sessionsWithCurrent(items: SessionSummary[]): SessionSummary[] {
	if (!snapshot?.sessionId) return items;
	const currentPath = snapshot.sessionPath;
	const found = items.some((item) => item.id === snapshot?.sessionId || samePath(item.path, currentPath));
	if (found) return items;
	return [
		{
			path: currentPath ?? snapshot.sessionId,
			id: snapshot.sessionId,
			title: currentSessionTitle(snapshot) ?? "New session",
			modified: new Date().toISOString(),
			messageCount: snapshot.messages.length,
		},
		...items,
	];
}

function renderSessionList(): void {
	sessionList.replaceChildren();
	const busy = snapshot?.isStreaming ?? false;
	for (const item of sessions) {
		const button = document.createElement("button");
		const isCurrent = item.id === snapshot?.sessionId || samePath(item.path, snapshot?.sessionPath);
		button.type = "button";
		button.className = `session-item${isCurrent ? " active" : ""}`;
		button.disabled = busy || isCurrent;
		button.setAttribute("role", "listitem");
		const title = document.createElement("div");
		title.className = "session-item-title";
		title.textContent = item.title;
		const meta = document.createElement("div");
		meta.className = "session-item-meta";
		meta.textContent = `${item.messageCount} · ${formatRelativeTime(item.modified)}`;
		button.append(title, meta);
		button.addEventListener("click", () => {
			if (isCurrent || !item.path) return;
			void run(async () => applySnapshot(await window.piDesktop.openSession(item.path)));
		});
		sessionList.append(button);
	}
}

function currentSessionTitle(value: DesktopSnapshot): string | undefined {
	const named = value.sessionName?.trim();
	if (named) return named;
	const firstUser = value.messages.find((message) => message.role === "user")?.text.trim();
	if (firstUser) return firstUser;
	if (value.sessionId) return "New session";
	return undefined;
}

function samePath(left: string | undefined, right: string | undefined): boolean {
	if (!left || !right) return false;
	return left.replaceAll("\\", "/").toLowerCase() === right.replaceAll("\\", "/").toLowerCase();
}

function formatRelativeTime(iso: string): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return "";
	const minutes = Math.floor(Math.max(0, Date.now() - then) / 60000);
	if (minutes < 1) return "Just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d ago`;
	return new Date(iso).toLocaleDateString();
}

async function refreshModels(): Promise<void> {
	models = await window.piDesktop.listModels();
	modelSelect.replaceChildren();
	if (models.length === 0) {
		modelSelect.add(new Option("No authenticated models", ""));
		modelSelect.disabled = true;
		return;
	}
	for (const [index, model] of models.entries()) {
		modelSelect.add(new Option(`${model.provider} · ${model.name}`, String(index)));
	}
	const currentIndex = models.findIndex(
		(model) => model.provider === snapshot?.model?.provider && model.id === snapshot.model.id,
	);
	modelSelect.value = String(currentIndex >= 0 ? currentIndex : 0);
	modelSelect.disabled = snapshot?.isStreaming ?? false;
}

function beginAssistantMessage(): void {
	streamingArticle = document.createElement("article");
	streamingArticle.className = "message assistant";
	const label = document.createElement("div");
	label.className = "message-label";
	label.textContent = "Pi";
	streamingThinking = document.createElement("details");
	streamingThinking.className = "thinking";
	const summary = document.createElement("summary");
	summary.textContent = "Thinking";
	streamingThinking.append(summary, document.createElement("pre"));
	streamingThinking.hidden = true;
	streamingText = document.createElement("div");
	streamingText.className = "message-text";
	streamingArticle.append(label, streamingThinking, streamingText);
	transcript.append(streamingArticle);
	emptyState.hidden = true;
	scrollToEnd();
}

function appendDelta(kind: "text" | "thinking", delta: string): void {
	if (!streamingArticle) beginAssistantMessage();
	if (kind === "text" && streamingText) streamingText.textContent += delta;
	if (kind === "thinking" && streamingThinking) {
		streamingThinking.hidden = false;
		const content = streamingThinking.querySelector("pre");
		if (content) content.textContent += delta;
	}
	scrollToEnd();
}

function finishMessage(message: UiMessage): void {
	if (message.role === "assistant" && streamingArticle) {
		if (streamingText && !streamingText.textContent) streamingText.textContent = message.text;
		if (message.error) streamingArticle.classList.add("error");
		streamingArticle = undefined;
		streamingText = undefined;
		streamingThinking = undefined;
		return;
	}
}

function appendMessage(message: UiMessage): void {
	if (!message.text && !message.error) return;
	const article = document.createElement("article");
	article.className = `message ${message.role}${message.error ? " error" : ""}`;
	const label = document.createElement("div");
	label.className = "message-label";
	label.textContent = message.role === "user" ? "You" : message.role === "assistant" ? "Pi" : "Tool";
	const content = document.createElement("div");
	content.className = "message-text";
	content.textContent = message.error || message.text;
	article.append(label, content);
	transcript.append(article);
	emptyState.hidden = true;
	scrollToEnd();
}

function appendTool(id: string, name: string, args: unknown): void {
	const article = document.createElement("details");
	article.className = "tool";
	article.open = false;
	const summary = document.createElement("summary");
	summary.textContent = `${name} · running`;
	const body = document.createElement("pre");
	body.textContent = formatValue(args);
	article.append(summary, body);
	transcript.append(article);
	tools.set(id, article);
	scrollToEnd();
}

function updateTool(id: string, update: unknown): void {
	const body = tools.get(id)?.querySelector("pre");
	if (body) body.textContent = formatValue(update);
}

function finishTool(id: string, isError: boolean, result: unknown): void {
	const tool = tools.get(id);
	if (!tool) return;
	const summary = tool.querySelector("summary");
	const body = tool.querySelector("pre");
	if (summary) summary.textContent = `${summary.textContent?.split(" ·")[0]} · ${isError ? "failed" : "done"}`;
	if (body) body.textContent = formatValue(result);
	tool.classList.toggle("error", isError);
}

function updateControls(): void {
	const hasWorkspace = Boolean(snapshot?.workspace);
	const busy = snapshot?.isStreaming ?? false;
	composer.disabled = !hasWorkspace;
	sendButton.disabled = !hasWorkspace || busy;
	stopButton.hidden = !busy;
	newSessionButton.disabled = !hasWorkspace || busy;
	modelSelect.disabled = !hasWorkspace || busy || models.length === 0;
	thinkingSelect.disabled = !hasWorkspace || busy;
	statusLabel.textContent = busy ? "Pi is working" : hasWorkspace ? "Ready" : "Choose a workspace";
	renderSessionList();
}

function showNotice(message: string, level: "info" | "error"): void {
	notice.textContent = message;
	notice.className = `notice ${level}`;
	notice.hidden = false;
	window.setTimeout(() => {
		notice.hidden = true;
	}, 6000);
}

async function run(action: () => Promise<void>): Promise<void> {
	try {
		await action();
	} catch (error) {
		showNotice(error instanceof Error ? error.message : String(error), "error");
	}
}

function formatValue(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, undefined, 2);
	} catch {
		return String(value);
	}
}

function scrollToEnd(): void {
	transcript.scrollTop = transcript.scrollHeight;
}

function element<T extends HTMLElement>(id: string): T {
	const value = document.getElementById(id);
	if (!value) throw new Error(`Missing element: ${id}`);
	return value as T;
}
