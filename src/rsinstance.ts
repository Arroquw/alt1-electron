import { app, BrowserWindow } from "electron";
import * as electron from "electron";
import * as path from "path";
import { delay } from "./lib";
import { OSWindow, native, OSWindowPin, OSNullWindow } from "./native";
import { OverlayCommand } from "./shared";
import { TypedEmitter } from "./typedemitter";
import { boundMethod } from "autobind-decorator";
import { AppPermission, settings } from "./settings";
import { openApp, managedWindows, selectAppContexts } from "./main";
import { Alt1EventType, ImgRef, ImgRefData, PointLike, Rect, RectLike } from "alt1";
import { readAnything } from "./readers/alt1reader";
import RightClickReader from "./readers/rightclick";


export var rsInstances: RsInstance[] = [];

const newRsWindow = (handle) => new RsInstance(new OSWindow(handle));

export function initRsInstanceTracking() {
	detectInstances();
	OSNullWindow.on("show", newRsWindow);
};

export function stopRsInstanceTracking() {
	OSNullWindow.removeListener("show", newRsWindow);
}

export function detectInstances() {
	let handles = native.getRsHandles();

	// Make a list of currently-tracked instances that were not detected this time, for removal
	// Note: this variable is not inlined because iterating a list while modifying it would not behave as expected
	const removedInstances = rsInstances.filter((x) => !handles.includes(x.window.handle));

	// Close and remove each one
	for (const instance of removedInstances) {
		instance.close();
	}

	// Add any new ones
	handles.filter((x) => !rsInstances.map((x) => x.window.handle).includes(x)).map((x) => new RsInstance(new OSWindow(x)));
}

export function getRsInstanceFromWnd(wnd: OSWindow) {
	let rsinst = rsInstances.find(rs => rs.window.handle == wnd.handle);
	if (rsinst) { return rsinst; }
	if (!rsinst) {
		//TODO check popups as well
		let appwnd = managedWindows.find(w => w.nativeWindow.handle == wnd.handle);
		if (appwnd) { return appwnd.rsClient; }
	}
	return null;
}

type RsInstanceEvents = {
	close: []
}


//TODO this class is just straight up weird
class ActiveRightclick {
	reader: RightClickReader;
	inst: RsInstance;
	interval: number;
	imgref: ImgRef;
	clientRect: RectLike;
	constructor(client: RsInstance, reader: RightClickReader, imgref: ImgRef) {
		this.reader = reader;
		this.inst = client;
		this.imgref = imgref;
		this.clientRect = new Rect(reader.pos!.x + imgref.x, reader.pos!.y + imgref.y, reader.pos!.width, reader.pos!.height);

		this.interval = setInterval(this.check, 100) as any;
		let screentopleft = this.inst.clientToScreen({ x: this.clientRect.x, y: this.clientRect.y });
		let screenbotright = this.inst.clientToScreen({ x: this.clientRect.x + this.clientRect.width, y: this.clientRect.y + this.clientRect.height });
		for (let wnd of managedWindows) {
			if (wnd.rsClient != this.inst) { continue; }
			let wndbounds = wnd.nativeWindow.getClientBounds();
			let rect = {
				x: screentopleft.x - wndbounds.x,
				y: screentopleft.y - wndbounds.y,
				width: screenbotright.x - screentopleft.x,
				height: screenbotright.y - screentopleft.y
			};
			wnd.window.webContents.send("rightclick", rect);
		}
		this.inst.activeRightclick = this;
	}

	close() {
		for (let wnd of managedWindows) {
			if (wnd.rsClient != this.inst) { continue; }
			wnd.window.webContents.send("rightclick", null);
		}
		clearInterval(this.interval);
		this.inst.activeRightclick = null;
	}

	@boundMethod
	check() {
		let screenpos = electron.screen.getCursorScreenPoint();
		let mouse = this.inst.screenToClient(screenpos);
		let pos = this.clientRect;
		const margin = 10;
		if (mouse.x < pos.x - margin || mouse.y < pos.y - margin || mouse.x > pos.x + pos.width + margin || mouse.y > pos.y + pos.height + margin) {
			this.close();
		}
	}
}

export class RsInstance extends TypedEmitter<RsInstanceEvents> {
	window: OSWindow;
	overlayWindow: { browser: BrowserWindow, pin: OSWindowPin | null, stalledOverlay: { frameid: number, cmd: OverlayCommand[] }[] } | null;
	activeRightclick: ActiveRightclick | null = null;
	isActive = false;
	lastActiveTime = 0;
	lastMouseScreen: { x: number, y: number } | null = null;
	lastMouseClient: { x: number, y: number } | null = null;

	constructor(rswindow: OSWindow) {
		super();
		this.window = rswindow;
		this.window.on("close", this.close);
		this.window.on("click", this.clientClicked);
		this.window.on("mousemove", this.onMouseMove);
		this.overlayWindow = null;

		for (let app of settings.bookmarks) {
			if (app.wasOpen) {
				app.wasOpen = false;
				openApp(app);
			}
		}

		rsInstances.push(this);
		console.log(`new rs client tracked with handle: ${this.window.handle}`);
	}

	closeOverlayFrame(frameid: number) {
		if (!this.overlayWindow) {
			console.log("[overlay] closeframe skipped: no overlayWindow", frameid);
			return;
		}
		if (this.overlayWindow.browser.isDestroyed()) {
			console.log("[overlay] closeframe skipped: overlay browser destroyed", frameid);
			return;
		}
		console.log("[overlay] sending closeframe -> overlay renderer", frameid);
		this.overlayWindow.browser.webContents.send("closeframe", frameid);
	}

	@boundMethod
	close() {
		rsInstances.splice(rsInstances.indexOf(this), 1);
		this.window.removeListener("close", this.close);
		this.window.removeListener("click", this.clientClicked);
		this.window.removeListener("mousemove", this.onMouseMove);
		this.emit("close");
		console.log(`stopped tracking rs client with handle: ${this.window.handle}`);
		if (this.overlayWindow?.browser && !this.overlayWindow.browser.isDestroyed()) {
			this.overlayWindow.browser.close();
		}
		this.overlayWindow = null;
	}

	emitAppEvent<T extends keyof Alt1EventType>(permission: AppPermission | "", type: T, event: Alt1EventType[T]) {
		for (let context of selectAppContexts(this, permission)) {
			context.send("appevent", type, event);
		}
	}

	@boundMethod
	async clientClicked() {
		this.lastActiveTime = Date.now();
		if (this.activeRightclick) {
			this.activeRightclick.close();
		}
		//TODO actually check if it is a rightclick
		if (!native.getMouseState()) {
			//need to wait for 2 frames to get rendered (doublebuffered)
			await delay(2 * 50);

			const mousescreen =
				this.lastMouseScreen ??
				this.overlayWindow?.pin?.getMousePos() ??
				electron.screen.getCursorScreenPoint();

			const mousepos = this.screenToClient(mousescreen);

			const captrect = new Rect(mousepos.x - 300, mousepos.y - 300, 600, 600);
			captrect.intersect({ x: 0, y: 0, ...this.getClientSize() });

			// Guard 0 size captures
			if (captrect.width <= 0 || captrect.height <= 0) {
				console.log("tried to capture 0 size area around mouse click");
				return;
			}

			// Make sure click is inside client bounds
			if (!captrect.containsPoint(mousepos.x, mousepos.y)) {
				console.log("click outside client");
				return;
			}

			let capt = this.capture(captrect);
			let reader = new RightClickReader();
			let img = new ImgRefData(capt, 0, 0);
			if (reader.find(img)) {
				let pos = reader.pos!;
				new ActiveRightclick(this, reader, new ImgRefData(capt, captrect.x, captrect.y));
				this.emitAppEvent("", "menudetected", {
					eventName: "menudetected",
					rectangle: {
						x: pos.x + captrect.x,
						y: pos.y + captrect.y,
						width: pos.width,
						height: pos.height
					}
				});
			}
		}
	}

	@boundMethod
	onMouseMove(pos: { x: number, y: number }) {
		// pos should be screen coords coming from native
		this.lastMouseScreen = pos;
		this.lastMouseClient = this.screenToClient(pos);
	}

	setActive(active: boolean) {
		if (active != this.isActive) {
			this.isActive = active;
			if (this.isActive) {
				this.emitAppEvent("", "rsfocus", { eventName: "rsfocus" });
			} else {
				this.emitAppEvent("", "rsblur", { eventName: "rsblur" });
			}
		}
	}

	screenToClient(p: PointLike) {
		let rsrect = this.window.getClientBounds();
		//TODO add scaling
		return { x: p.x - rsrect.x, y: p.y - rsrect.y };
	}

	clientToScreen(p: PointLike) {
		let rsrect = this.window.getClientBounds();
		//TODO add scaling
		return { x: p.x + rsrect.x, y: p.y + rsrect.y };
	}

	getClientSize() {
		//TODO this doesn't account for scaling
		let rect = this.window.getClientBounds();
		return { width: rect.width, height: rect.height };
	}

	capture(rect: RectLike) {
		let capt = native.captureWindowMulti(this.window.handle, settings.captureMode, { main: rect });
		return new ImageData(capt.main, rect.width, rect.height);
	}

	alt1Pressed() {
		const mousescreen =
			this.lastMouseScreen ??
			this.overlayWindow?.pin?.getMousePos() ??
			electron.screen.getCursorScreenPoint();

		const mousepos = this.screenToClient(mousescreen);

		console.log("ALT1PRESS", Date.now(), "handle", this.window.handle);
		console.log("MOUSESCREEN:", mousescreen);
		console.log("MOUSEPOS:", mousepos);

		// Build capture rect centered on cursor, clamp to client bounds
		const captrect = new Rect(mousepos.x - 300, mousepos.y - 300, 600, 600);
		captrect.intersect({ x: 0, y: 0, ...this.getClientSize() });

		// If the press is outside the client, don't capture.
		if (!captrect.containsPoint(mousepos.x, mousepos.y)) {
			console.log("alt+1 pressed outside client");
			return;
		}

		const img = this.capture(captrect);
		const res = readAnything(img, mousepos.x - captrect.x, mousepos.y - captrect.y);
		if (res?.type == "text") {
			let str = res.line.text;
			console.log("text " + res.font + ": " + str);
			//TODO grab these from c# alt1

		} else if (res?.type == "rightclick") {
			console.log("rightclick: " + res.line.text);
		}
		else {
			console.log("no text found under cursor")
		}
		this.emitAppEvent("", "alt1pressed", {
			eventName: "alt1pressed",
			text: res?.line.text || "",
			rsLinked: true,//event is no emited in new api if this is not true
			x: mousepos.x, y: mousepos.y,
			mouseAbs: mousescreen,
			mouseRs: mousepos
		});
	}

	overlayCommands(frameid: number, commands: OverlayCommand[]) {
		if (!this.overlayWindow) {
			let bounds = this.window.getClientBounds();
			let browser = new BrowserWindow({
				webPreferences: { nodeIntegration: true, contextIsolation: false },
				frame: false,
				transparent: true,
				x: bounds.x,
				y: bounds.y,
				width: bounds.width,
				height: bounds.height,
				show: false,
				//resizable: false,
				movable: false,
				skipTaskbar: true,
				focusable: false
			});

			let pin: OSWindowPin = new OSWindowPin(browser, this.window, "cover");
			browser.loadFile(path.resolve(__dirname, "overlayframe/index.html"));
			browser.on("closed", () => {
				pin.unpin();
				this.overlayWindow = null;
			});
			browser.once("ready-to-show", () => {
				browser.show();
			});
			browser.webContents.once("dom-ready", () => {
				for (let stalled of this.overlayWindow!.stalledOverlay) {
					browser.webContents.send("overlay", stalled.frameid, stalled.cmd);
				}
			});
			browser.setIgnoreMouseEvents(true);
			this.overlayWindow = { browser, pin, stalledOverlay: [{ frameid: frameid, cmd: commands }] };
		} else {
			this.overlayWindow.browser.webContents.send("overlay", frameid, commands);
		}
	}
}
