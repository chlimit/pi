import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, type IpcMainInvokeEvent, ipcMain } from "electron";
import { AgentProcess } from "./agent-process.ts";
import {
	type DesktopEvent,
	type DesktopSnapshot,
	IPC_CHANNELS,
	type ModelOption,
	type SessionSummary,
	type ThinkingLevel,
} from "./protocol.ts";

interface DesktopState {
	workspace?: string;
	sessionPath?: string;
}

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const rendererUrl = pathToFileURL(join(packageDir, "dist", "index.html")).href;
let mainWindow: BrowserWindow | undefined;
let agentProcess: AgentProcess | undefined;

function statePath(): string {
	return join(app.getPath("userData"), "state.json");
}

function readState(): DesktopState {
	try {
		const value = JSON.parse(readFileSync(statePath(), "utf8")) as DesktopState;
		return value && typeof value === "object" ? value : {};
	} catch {
		return {};
	}
}

function writeState(state: DesktopState): void {
	writeFileSync(statePath(), `${JSON.stringify(state)}\n`);
}

function persistStateFromSnapshot(snapshot: DesktopSnapshot): void {
	if (!snapshot.workspace) return;
	writeState({
		workspace: snapshot.workspace,
		...(snapshot.sessionPath ? { sessionPath: snapshot.sessionPath } : {}),
	});
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function sendEvent(event: DesktopEvent): void {
	if (event.type === "snapshot") persistStateFromSnapshot(event.snapshot);
	const window = mainWindow;
	if (window && !window.isDestroyed()) window.webContents.send(IPC_CHANNELS.event, event);
}

function createWindow(): void {
	mainWindow = new BrowserWindow({
		width: 1320,
		height: 860,
		minWidth: 820,
		minHeight: 600,
		backgroundColor: "#101114",
		titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
		webPreferences: {
			preload: join(packageDir, "dist", "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	void mainWindow.loadFile(join(packageDir, "dist", "index.html"));
	mainWindow.on("closed", () => {
		mainWindow = undefined;
	});
}

function registerIpc(): void {
	agentProcess = new AgentProcess(sendEvent);
	ipcMain.handle(IPC_CHANNELS.selectWorkspace, async (event): Promise<DesktopSnapshot | undefined> => {
		assertTrustedSender(event);
		const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory"] });
		const workspace = result.filePaths[0];
		if (result.canceled || !workspace) return undefined;
		const snapshot = await agentProcess!.request<DesktopSnapshot>({ type: "open-workspace", workspace });
		persistStateFromSnapshot(snapshot);
		return snapshot;
	});
	ipcMain.handle(IPC_CHANNELS.getSnapshot, async (event) => {
		assertTrustedSender(event);
		return agentProcess!.request<DesktopSnapshot>({ type: "get-snapshot" });
	});
	ipcMain.handle(IPC_CHANNELS.listModels, async (event) => {
		assertTrustedSender(event);
		return agentProcess!.request<ModelOption[]>({ type: "list-models" });
	});
	ipcMain.handle(IPC_CHANNELS.listSessions, async (event) => {
		assertTrustedSender(event);
		return agentProcess!.request<SessionSummary[]>({ type: "list-sessions" });
	});
	ipcMain.handle(IPC_CHANNELS.prompt, async (event, message: string) => {
		assertTrustedSender(event);
		if (typeof message !== "string" || !message.trim()) throw new Error("Message is required");
		await agentProcess!.request<void>({ type: "prompt", message: message.trim() });
	});
	ipcMain.handle(IPC_CHANNELS.abort, async (event) => {
		assertTrustedSender(event);
		return agentProcess!.request<void>({ type: "abort" });
	});
	ipcMain.handle(IPC_CHANNELS.newSession, async (event) => {
		assertTrustedSender(event);
		const snapshot = await agentProcess!.request<DesktopSnapshot>({ type: "new-session" });
		persistStateFromSnapshot(snapshot);
		return snapshot;
	});
	ipcMain.handle(IPC_CHANNELS.openSession, async (event, path: string) => {
		assertTrustedSender(event);
		if (typeof path !== "string" || !path.trim()) throw new Error("Session path is required");
		const snapshot = await agentProcess!.request<DesktopSnapshot>({ type: "open-session", path });
		persistStateFromSnapshot(snapshot);
		return snapshot;
	});
	ipcMain.handle(IPC_CHANNELS.setModel, async (event, provider: string, modelId: string) => {
		assertTrustedSender(event);
		if (typeof provider !== "string" || typeof modelId !== "string") throw new Error("Invalid model");
		return await agentProcess!.request<DesktopSnapshot>({ type: "set-model", provider, modelId });
	});
	ipcMain.handle(IPC_CHANNELS.setThinkingLevel, async (event, level: string) => {
		assertTrustedSender(event);
		if (!isThinkingLevel(level)) throw new Error("Invalid thinking level");
		return await agentProcess!.request<DesktopSnapshot>({ type: "set-thinking-level", level });
	});
}

async function restoreDesktopState(): Promise<void> {
	const state = readState();
	if (!state.workspace || !isDirectory(state.workspace)) return;
	const sessionPath = state.sessionPath && existsSync(state.sessionPath) ? state.sessionPath : undefined;
	const snapshot = await agentProcess!.request<DesktopSnapshot>({
		type: "open-workspace",
		workspace: state.workspace,
		...(sessionPath ? { sessionPath } : {}),
	});
	persistStateFromSnapshot(snapshot);
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
	if (!event.senderFrame || event.senderFrame.url !== rendererUrl) {
		throw new Error("Blocked IPC from an untrusted renderer");
	}
}

function isThinkingLevel(value: string): value is ThinkingLevel {
	const allowed: readonly string[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
	return allowed.includes(value);
}

app.whenReady().then(async () => {
	registerIpc();
	let restoreError: string | undefined;
	try {
		await restoreDesktopState();
	} catch (error) {
		restoreError = error instanceof Error ? error.message : String(error);
	}
	createWindow();
	if (restoreError) {
		mainWindow?.webContents.once("did-finish-load", () => {
			sendEvent({ type: "notice", level: "error", message: restoreError });
		});
	}
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => agentProcess?.dispose());
