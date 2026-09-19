export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const IPC_CHANNELS = {
	abort: "pi:abort",
	event: "pi:event",
	getSnapshot: "pi:get-snapshot",
	listModels: "pi:list-models",
	listSessions: "pi:list-sessions",
	newSession: "pi:new-session",
	openSession: "pi:open-session",
	prompt: "pi:prompt",
	selectWorkspace: "pi:select-workspace",
	setModel: "pi:set-model",
	setThinkingLevel: "pi:set-thinking-level",
} as const;

export interface UiMessage {
	role: "user" | "assistant" | "tool" | "system";
	text: string;
	timestamp: number;
	error?: string;
}

export interface ModelOption {
	provider: string;
	id: string;
	name: string;
	reasoning: boolean;
}

export interface SessionSummary {
	path: string;
	id: string;
	title: string;
	modified: string;
	messageCount: number;
}

export interface DesktopSnapshot {
	workspace: string | undefined;
	sessionId: string | undefined;
	sessionPath: string | undefined;
	sessionName: string | undefined;
	model: ModelOption | undefined;
	thinkingLevel: ThinkingLevel;
	isStreaming: boolean;
	messages: UiMessage[];
}

export type DesktopEvent =
	| { type: "snapshot"; snapshot: DesktopSnapshot }
	| { type: "message-start"; message: UiMessage }
	| { type: "message-delta"; kind: "text" | "thinking"; delta: string }
	| { type: "message-end"; message: UiMessage }
	| { type: "tool-start"; id: string; name: string; args: unknown }
	| { type: "tool-update"; id: string; name: string; update: unknown }
	| { type: "tool-end"; id: string; name: string; isError: boolean; result: unknown }
	| { type: "busy"; value: boolean }
	| { type: "notice"; level: "info" | "error"; message: string };

export type HostRequest =
	| { id: number; type: "open-workspace"; workspace: string; sessionPath?: string }
	| { id: number; type: "get-snapshot" }
	| { id: number; type: "list-models" }
	| { id: number; type: "list-sessions" }
	| { id: number; type: "prompt"; message: string }
	| { id: number; type: "abort" }
	| { id: number; type: "new-session" }
	| { id: number; type: "open-session"; path: string }
	| { id: number; type: "set-model"; provider: string; modelId: string }
	| { id: number; type: "set-thinking-level"; level: ThinkingLevel };

type WithoutRequestId<T> = T extends { id: number } ? Omit<T, "id"> : never;
export type HostRequestInput = WithoutRequestId<HostRequest>;

export type HostMessage =
	| { type: "response"; id: number; ok: true; value: unknown }
	| { type: "response"; id: number; ok: false; error: string }
	| { type: "event"; event: DesktopEvent };

export interface DesktopApi {
	selectWorkspace(): Promise<DesktopSnapshot | undefined>;
	getSnapshot(): Promise<DesktopSnapshot>;
	listModels(): Promise<ModelOption[]>;
	listSessions(): Promise<SessionSummary[]>;
	prompt(message: string): Promise<void>;
	abort(): Promise<void>;
	newSession(): Promise<DesktopSnapshot>;
	openSession(path: string): Promise<DesktopSnapshot>;
	setModel(provider: string, modelId: string): Promise<DesktopSnapshot>;
	setThinkingLevel(level: ThinkingLevel): Promise<DesktopSnapshot>;
	onEvent(listener: (event: DesktopEvent) => void): () => void;
}
