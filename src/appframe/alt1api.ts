import { SyncResponse, RsClientState } from "../shared";

if (!window.alt1Internal) {
	throw new Error("alt1Internal bridge not found - preload script may not have loaded correctly");
}
const remote = window.electronRemote;
const ipcRenderer = window.electronIPC;
const alt1_internal = window.alt1Internal;
(window as any).remote = remote;

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

let getters: PropertyDescriptorMap = {
	rsX: { get() { return getRsInfo().clientRect.x; } },
	rsY: { get() { return getRsInfo().clientRect.y; } },
	rsWidth: { get() { return getRsInfo().clientRect.width; } },
	rsHeight: { get() { return getRsInfo().clientRect.height; } },
	rsActive: { get() { return getRsInfo().active; } },
	rsLastActive: { get() { return Date.now() - getRsInfo().lastActiveTime; } },
	rsPing: { get() { return getRsInfo().ping; } },
	rsScaling: { get() { return getRsInfo().scaling; } },
	rsLinked: { get() { return true; } }, //can no longer open apps without rs
	captureMethod: { get() { return getRsInfo().captureMode; } },
	mousePosition: { get() { return getRsInfo().mousePosition; } },
	//TODO
	currentWorld: { get() { return 1; } },
	lastWorldHop: { get() { return 0; } },
	permissionGameState: { get() { return true; } },
	permissionInstalled: { get() { return true; } },
	permissionOverlay: { get() { return true; } },
	permissionPixel: { get() { return true; } }
};


const bridge = alt1_internal;

// Create the global namespace if it doesn't exist
(window as any).alt1 = (window as any).alt1 || {};

Object.defineProperties((window as any).alt1, getters);
// Automatically map all functions/properties from the frozen bridge
// to the mutable window.bla object
Object.keys(bridge).forEach((key) => {
	const descriptor = Object.getOwnPropertyDescriptor(bridge, key);

	if (descriptor && (descriptor.get || typeof bridge[key] === 'function')) {
		// Map functions or getters
		Object.defineProperty(window.alt1, key, {
			get: () => bridge[key],
			enumerable: true,
			configurable: true
		});
	} else {
		// Map static values
		(window.alt1 as any)[key] = bridge[key];
	}
});

// 3. Initialize the mutable parts that the bridge CANNOT handle
window.alt1.events = {};

console.log("Namespace 'bla' is now hydrated and extensible!");

