import { contextBridge, ipcRenderer } from "electron";
import * as remote from "@electron/remote";
import { FlatImageData, SyncResponse, OverlayCommand, RsClientState } from "../shared";
import { decodeImageString } from "alt1";
import type * as alt1types from "alt1";

let warningsTriggered: string[] = [];
function warn(key: string, message: string) {
	if (!warningsTriggered.includes(key)) {
		console.warn(message);
		warningsTriggered.push(key);
	}
}

// Get the main module
const getMainModule = () => {
	return remote.getGlobal("Alt1lite");
};

// Event handling setup
const eventHandlers: { [K in keyof alt1types.Alt1EventType]?: Array<(event: alt1types.Alt1EventType[K]) => void> } = {};

ipcRenderer.on("appevent", <T extends keyof alt1types.Alt1EventType>(e: any, type: T, appevent: alt1types.Alt1EventType[T]) => {
	try {
		if (eventHandlers[type]) {
			for (let handler of eventHandlers[type]!) {
				handler(appevent);
			}
		}
	} catch (e) {
		console.error(e);
	}
});

function captureSync(x: number, y: number, w: number, h: number) {
	warn("captsync", "Synchonous capture is depricated");
	let img: SyncResponse<FlatImageData> = ipcRenderer.sendSync("capturesync", x, y, w, h);
	if (img.error != undefined) { throw new Error(img.error); }
	return img.value;
}

function imagedataToBase64(img: FlatImageData) {
	warn("base64capt", "This capture api is a backward port for compatibylity and is much slower");
	const btoachars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	let str = "";
	let data = img.data;
	for (var a = 0; a + 3 < data.length; a += 12) {
		let b0 = data[a + 0], g0 = data[a + 1], r0 = data[a + 2], a0 = data[a + 3];
		let b1 = data[a + 4], g1 = data[a + 5], r1 = data[a + 6], a1 = data[a + 7];
		let b2 = data[a + 8], g2 = data[a + 9], r2 = data[a + 10], a2 = data[a + 11];
		str += btoachars[(r0 >> 2) & 0x3f] + btoachars[((r0 << 4) | (g0 >> 4)) & 0x3f] + btoachars[((g0 << 2) | (b0 >> 6)) & 0x3f] + btoachars[(b0) & 0x3f];
		str += btoachars[(a0 >> 2) & 0x3f] + btoachars[((a0 << 4) | (r1 >> 4)) & 0x3f] + btoachars[((r1 << 2) | (g1 >> 6)) & 0x3f] + btoachars[(g1) & 0x3f];
		str += btoachars[(b1 >> 2) & 0x3f] + btoachars[((b1 << 4) | (a1 >> 4)) & 0x3f] + btoachars[((a1 << 2) | (r2 >> 6)) & 0x3f] + btoachars[(r2) & 0x3f];
		str += btoachars[(g2 >> 2) & 0x3f] + btoachars[((g2 << 4) | (b2 >> 4)) & 0x3f] + btoachars[((b2 << 2) | (a2 >> 6)) & 0x3f] + btoachars[(a2) & 0x3f];
	}
	let endstr = "";
	for (; a < img.data.length; a++) {
		endstr += String.fromCharCode(data[a]);
	}
	str += btoa(endstr);
	return str;
}

let lastRsInfo: SyncResponse<RsClientState> = null!;
let lastRsInfoTime = 0;
function getRsInfo() {
	let info = lastRsInfo;
	if (lastRsInfoTime < Date.now() - 100) {
		info = ipcRenderer.sendSync("rsbounds");
		lastRsInfo = info;
		lastRsInfoTime = Date.now();
	}
	if (info.error != undefined) {
		if (String(info.error).includes("no permitted RS Client") || String(info.error).includes("not bound")) {
			lastRsInfoTime = 0;
			let retry = ipcRenderer.sendSync("rsbounds");
			lastRsInfo = retry;
			lastRsInfoTime = Date.now();
			if (retry.error == undefined) return retry.value;
		}
		throw new Error(info.error);
	}
	return info.value;
}

let boundImage: FlatImageData & { x: number, y: number } | null = null;
let overlayDebounceCommands: OverlayCommand[] = [];
let overlayFlushTimer: NodeJS.Timeout | null = null;

function queueOverlayCommand(command: OverlayCommand) {
	overlayDebounceCommands.push(command);
	if (!overlayFlushTimer) {
		overlayFlushTimer = setTimeout(() => {
			sendOverlayQueue();
			overlayFlushTimer = null;
		}, 16);
	}
}

function sendOverlayQueue() {
	if (overlayDebounceCommands.length === 0) return;
	ipcRenderer.send("overlay", overlayDebounceCommands);
	overlayDebounceCommands = [];
}

function setTooltip(text: string) {
	ipcRenderer.send("settooltip", text);
}

function subImageData(img: FlatImageData, x: number, y: number, w: number, h: number) {
	if (x == 0 && y == 0 && w == img.width && h == img.height) {
		return img;
	}
	let newdata = new Uint8ClampedArray(w * h * 4);
	let data = img.data;
	let imgwidth = img.width;
	for (let dy = 0; dy < h; dy++) {
		let i = x * 4 + (y + dy) * 4 * imgwidth;
		newdata.set(data.subarray(i, i + w * 4), dy * 4 * w);
	}
	return { data: newdata, width: w, height: h } as FlatImageData;
}

// Expose electronRemote API
contextBridge.exposeInMainWorld("electronRemote", {
	getCurrentWebContents: () => remote.getCurrentWebContents(),
	getCurrentWindow: () => remote.getCurrentWindow(),
	getGlobal: (name: string) => remote.getGlobal(name),
	webContents: {
		fromId: (id: number) => remote.webContents.fromId(id),
		isDevToolsOpened: (id: number) => {
			const wc = remote.webContents.fromId(id);
			return wc ? wc.isDevToolsOpened() : false;
		},
		openDevTools: (id: number, options?: any) => {
			const wc = remote.webContents.fromId(id);
			if (wc) wc.openDevTools(options);
		},
		closeDevTools: (id: number) => {
			const wc = remote.webContents.fromId(id);
			if (wc) wc.closeDevTools();
		}
	},
	getManagedWindow: () => {
		const mod = getMainModule();
		if (!mod || !mod.getManagedWindow) {
			return null;
		}
		return mod.getManagedWindow(remote.getCurrentWebContents());
	}
});

contextBridge.exposeInMainWorld("electronIPC", {
	send: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
	sendSync: (channel: string, ...args: any[]) => ipcRenderer.sendSync(channel, ...args),
	invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
	on: (channel: string, listener: (...args: any[]) => void) => {
		ipcRenderer.on(channel, (event, ...args) => listener(...args));
	},
	off: (channel: string, listener: (...args: any[]) => void) => {
		ipcRenderer.removeListener(channel, listener);
	}
});

// Expose alt1 API
contextBridge.exposeInMainWorld("alt1", {
	events: eventHandlers,

	get rsX() { return getRsInfo().clientRect.x; },
	get rsY() { return getRsInfo().clientRect.y; },
	get rsWidth() { return getRsInfo().clientRect.width; },
	get rsHeight() { return getRsInfo().clientRect.height; },
	get rsActive() { return getRsInfo().active; },
	get rsLastActive() { return Date.now() - getRsInfo().lastActiveTime; },
	get rsPing() { return getRsInfo().ping; },
	get rsScaling() { return getRsInfo().scaling; },
	get rsLinked() { return true; },
	get captureMethod() { return getRsInfo().captureMode; },
	get mousePosition() { return getRsInfo().mousePosition; },
	get currentWorld() { return 1; },
	get lastWorldHop() { return 0; },
	get permissionGameState() { return true; },
	get permissionInstalled() { return true; },
	get permissionOverlay() { return true; },
	get permissionPixel() { return true; },

	identifyAppUrl: (url: string) => ipcRenderer.send("identifyapp", url),
	captureInterval: 100,
	maxtransfer: 100e6,
	openInfo: '{"openMethod":"systray"}',
	skinName: "default",
	version: "1.3.0",
	versionint: 1003000,

	openBrowser: (url: string) => { window.open(url, "_blank"); return true; },
	getRegion: (x: number, y: number, w: number, h: number) => {
		let img = captureSync(x, y, w, h);
		return imagedataToBase64(img);
	},
	bindRegion(x: number, y: number, w: number, h: number) {
		warn("bindbypass", "This platform does not utilise the bound image pattern");
		boundImage = { x, y, ...captureSync(x, y, w, h) };
		return 1;
	},
	bindGetPixel(id: number, x: number, y: number) {
		if (!boundImage || id != 1) { return 0; }
		let i = boundImage.width * 4 * y + 4 * x;
		let r = boundImage.data[i + 0], g = boundImage.data[i + 1], b = boundImage.data[i + 2], a = boundImage.data[i + 3];
		return (r << 24) | (g << 16) | (b << 8) | a;
	},
	bindGetRegion(id: number, x: number, y: number, w: number, h: number) {
		if (!boundImage || id != 1) { return ""; }
		return imagedataToBase64(subImageData(boundImage, x, y, w, h));
	},
	overLayLine(color: number, linewidth: number, x1: number, y1: number, x2: number, y2: number, time: number) {
		queueOverlayCommand({ command: "draw", time, action: { type: "line", x1, y1, x2, y2, color, linewidth } });
		return true;
	},
	overLayRect(color: number, x: number, y: number, width: number, height: number, time: number, linewidth: number) {
		queueOverlayCommand({ command: "draw", time, action: { type: "rect", x, y, width, height, color, linewidth } });
		return true;
	},
	overLayTextEx(text: string, color: number, size: number, x: number, y: number, time: number, font: string, center: boolean, shadow: boolean) {
		queueOverlayCommand({ command: "draw", time, action: { type: "text", x, y, font, text, center, shadow, color, size } });
		return true;
	},
	overLayText(text: string, color: number, size: number, x: number, y: number, time: number) {
		queueOverlayCommand({ command: "draw", time, action: { type: "text", x, y, font: "", text, center: false, shadow: true, color, size } });
		return true;
	},
	overLayImage(x: number, y: number, imgstr: string, imgwidth: number, time: number) {
		const raw = atob(imgstr);
		var height = raw.length / 4 / imgwidth;
		if (!Number.isInteger(height)) {
			height = Math.floor(height);
		}
		var sprite = new ImageData(imgwidth, height);
		decodeImageString(imgstr, sprite, 0, 0, imgwidth, height);
		let flatImageData: FlatImageData = {
			data: sprite.data,
			width: imgwidth,
			height: height,
		};
		if (sprite.height > 0 && sprite.width > 0) {
			queueOverlayCommand({ command: "draw", time, action: { type: "sprite", x, y, sprite: flatImageData } });
		}
		return true;
	},
	overLaySetGroup(groupid: string) { queueOverlayCommand({ command: "setgroup", groupid }); },
	overLaySetGroupZIndex(groupid: string, zindex: number) { queueOverlayCommand({ command: "setgroupzindex", groupid, zindex }); },
	overLayFreezeGroup(groupid: string) { queueOverlayCommand({ command: "freezegroup", groupid }); },
	overLayContinueGroup(groupid: string) { queueOverlayCommand({ command: "continuegroup", groupid }); },
	overLayClearGroup(groupid: string) { queueOverlayCommand({ command: "cleargroup", groupid }); },
	overLayRefreshGroup(groupid: string) { queueOverlayCommand({ command: "refreshgroup", groupid }); },
	setTooltip(str: string) { setTooltip(str); return true; },
	clearTooltip() { setTooltip(""); },
	registerStatusDaemon(serverUrl: string, state: string) {
		return JSON.stringify({
			state: "",
			nextRun: 100,
			alerts: [{ title: "", body: "" }],
			status: [{ status: "" }],
		});
	},
	getStatusDaemonState() { return ""; },
	capture(x: number, y: number, width: number, height: number) {
		return captureSync(x, y, width, height).data;
	},
	captureAsync(x: number, y: number, width: number, height: number) {
		return ipcRenderer.invoke("capture", x, y, width, height);
	},
	captureMultiAsync(areas: any) {
		return ipcRenderer.invoke("capturemulti", areas);
	},
	bindGetRegionBuffer(id: number, x: number, y: number, w: number, h: number) {
		if (!boundImage || id != 1) { throw new Error("no bound image"); }
		return subImageData(boundImage, x, y, w, h).data;
	},
	closeApp() {
		window.close();
	},
	userResize(left: number, top: number, right: number, bot: number) {
		ipcRenderer.sendSync("dragwindow", left, top, right, bot);
	}
});
