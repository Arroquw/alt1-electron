import type { WebContents, BrowserWindow } from "electron";

export interface ElectronRemote {
	getCurrentWebContents: () => WebContents;
	getCurrentWindow: () => BrowserWindow;
	getGlobal: (name: string) => any;
	webContents: {
		fromId: (id: number) => WebContents | undefined;
		isDevToolsOpened: (id: number) => boolean;
		openDevTools: (id: number, options?: { mode?: "right" | "bottom" | "undocked" | "detach" }) => void;
		closeDevTools: (id: number) => void;
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

export interface Alt1Internal {
	// Event system access
	getEventHandlers: () => any;

	// Helper functions
	getRsInfo: () => RsClientState;
	captureSync: (x: number, y: number, w: number, h: number) => FlatImageData;
	imagedataToBase64: (img: FlatImageData) => string;
	subImageData: (img: FlatImageData, x: number, y: number, w: number, h: number) => FlatImageData;
	queueOverlayCommand: (command: OverlayCommand) => void;
	setTooltip: (text: string) => void;
	warn: (key: string, message: string) => void;

	// State access
	getBoundImage: () => (FlatImageData & { x: number, y: number }) | null;
	setBoundImage: (img: (FlatImageData & { x: number, y: number }) | null) => void;

	// IPC direct access
	ipcSend: (channel: string, ...args: any[]) => void;
	ipcSendSync: (channel: string, ...args: any[]) => any;
	ipcInvoke: (channel: string, ...args: any[]) => Promise<any>;

	// Utilities
	decodeImageString: any;

	// Static properties
	identifyAppUrl: (url: string) => void;
	captureInterval: number;
	maxtransfer: number;
	openInfo: string;
	skinName: string;
	version: string;
	versionint: number;

	// Methods
	openBrowser: (url: string) => boolean;
	getRegion: (x: number, y: number, w: number, h: number) => string;
	bindRegion: (x: number, y: number, w: number, h: number) => number;
	bindGetPixel: (id: number, x: number, y: number) => number;
	bindGetRegion: (id: number, x: number, y: number, w: number, h: number) => string;
	overLayLine: (color: number, linewidth: number, x1: number, y1: number, x2: number, y2: number, time: number) => boolean;
	overLayRect: (color: number, x: number, y: number, width: number, height: number, time: number, linewidth: number) => boolean;
	overLayTextEx: (text: string, color: number, size: number, x: number, y: number, time: number, font: string, center: boolean, shadow: boolean) => boolean;
	overLayText: (text: string, color: number, size: number, x: number, y: number, time: number) => boolean;
	overLayImage: (x: number, y: number, imgstr: string, imgwidth: number, time: number) => boolean;
	overLaySetGroup: (groupid: string) => void;
	overLaySetGroupZIndex: (groupid: string, zindex: number) => void;
	overLayFreezeGroup: (groupid: string) => void;
	overLayContinueGroup: (groupid: string) => void;
	overLayClearGroup: (groupid: string) => void;
	overLayRefreshGroup: (groupid: string) => void;
	setTooltipMethod: (str: string) => boolean;
	clearTooltip: () => void;
	registerStatusDaemon: (serverUrl: string, state: string) => string;
	getStatusDaemonState: () => string;
	capture: (x: number, y: number, width: number, height: number) => Uint8ClampedArray;
	captureAsync: (x: number, y: number, width: number, height: number) => Promise<ImageData>;
	captureMultiAsync: (areas: any) => Promise<any>;
	bindGetRegionBuffer: (id: number, x: number, y: number, w: number, h: number) => Uint8ClampedArray;
	closeApp: () => void;
	userResize: (left: number, top: number, right: number, bot: number) => void;
}

declare global {
	interface Window {
		electronRemote: ElectronRemote;
		electronIPC: ElectronIPC;
		remote: ElectronRemote;
		alt1Internal: Alt1Internal;
	}
}

export { };
