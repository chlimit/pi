import { contextBridge, ipcRenderer } from "electron";
import {
	type DesktopApi,
	type DesktopEvent,
	type DesktopSnapshot,
	IPC_CHANNELS,
	type ModelOption,
	type SessionSummary,
} from "./protocol.ts";

const api: DesktopApi = {
	selectWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.selectWorkspace) as Promise<DesktopSnapshot | undefined>,
	getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getSnapshot) as Promise<DesktopSnapshot>,
	listModels: () => ipcRenderer.invoke(IPC_CHANNELS.listModels) as Promise<ModelOption[]>,
	listSessions: () => ipcRenderer.invoke(IPC_CHANNELS.listSessions) as Promise<SessionSummary[]>,
	prompt: (message) => ipcRenderer.invoke(IPC_CHANNELS.prompt, message) as Promise<void>,
	abort: () => ipcRenderer.invoke(IPC_CHANNELS.abort) as Promise<void>,
	newSession: () => ipcRenderer.invoke(IPC_CHANNELS.newSession) as Promise<DesktopSnapshot>,
	openSession: (path) => ipcRenderer.invoke(IPC_CHANNELS.openSession, path) as Promise<DesktopSnapshot>,
	setModel: (provider, modelId) =>
		ipcRenderer.invoke(IPC_CHANNELS.setModel, provider, modelId) as Promise<DesktopSnapshot>,
	setThinkingLevel: (level) => ipcRenderer.invoke(IPC_CHANNELS.setThinkingLevel, level) as Promise<DesktopSnapshot>,
	onEvent: (listener) => {
		const handler = (_event: Electron.IpcRendererEvent, value: DesktopEvent): void => listener(value);
		ipcRenderer.on(IPC_CHANNELS.event, handler);
		return () => ipcRenderer.removeListener(IPC_CHANNELS.event, handler);
	},
};

contextBridge.exposeInMainWorld("piDesktop", api);
