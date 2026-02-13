import type { WebContents, BrowserWindow } from "electron";

export interface ElectronRemote {
	getCurrentWebContents: () => WebContents;
	getCurrentWindow: () => BrowserWindow;
	getGlobal: (name: string) => any;
	webContents: {
		fromId: (id: number) => WebContents | undefined;
	};
	getManagedWindow: () => any;
}

export interface ElectronIPC {
	send: (channel: string, ...args: any[]) => void;
	sendSync: (channel: string, ...args: any[]) => any;
	invoke: (channel: string, ...args: any[]) => Promise<any>;
	on: (channel: string, listener: (...args: any[]) => void) => void;
	off: (channel: string, listener: (...args: any[]) => void) => void;
}

declare global {
	interface Window {
		electronRemote: ElectronRemote;
		electronIPC: ElectronIPC;
		remote: ElectronRemote;
	}
}

export { };
