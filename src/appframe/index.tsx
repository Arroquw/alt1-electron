/// <reference path="../types/preload.d.ts" />
import * as React from "react";
import { useState, useLayoutEffect, useRef } from "react";
import { render } from "react-dom";
import type { RectLike } from "alt1";
import classnames from "classnames";

import "./style.scss";
import "./index.html";

if (!window.electronRemote || !window.electronIPC) {
	throw new Error("Preload script not loaded!");
}

const remote = window.electronRemote;
const ipcRenderer = window.electronIPC;
(window as any).remote = remote;

let appview: Electron.WebviewTag | null = null;
let thiswindow: any = null;

window.addEventListener("DOMContentLoaded", () => {
	thiswindow = remote.getManagedWindow();

	if (!thiswindow) {
		console.error("Failed to get managed window");
		document.body.innerHTML = "<h1>Error: Managed window not found</h1>";
		return;
	}

	render(<AppFrame />, document.getElementById("root"));
});

function AppFrame(p: {}) {
	let [rightclickArea, setRightclickArea] = useState(null as RectLike | null);
	let [minimized, setMinimized] = useState(false);
	let gridel = useRef<HTMLDivElement>(null);
	let rootref = useRef<HTMLDivElement>(null);
	let buttonroot = useRef<HTMLDivElement>(null);

	//app webview
	useLayoutEffect(() => {
		let view = document.createElement("webview");
		view.className = "appframe";
		view.preload = new URL("./preload.bundle.js", window.location.href).pathname;
		view.allowpopups = true;
		view.nodeintegration = false;
		view.nodeintegrationinsubframes = false;
		view.src = thiswindow.appConfig.appUrl;
		view.webpreferences = "sandbox,contextIsolation=true";

		gridel.current!.appendChild(view);
		view.addEventListener("dom-ready", () => {
			thiswindow.appFrameId = view.getWebContentsId();
		});

		appview = view;
		(window as any).view = view;
		return () => { appview = null };
	}, []);

	//rightclick event listener
	useLayoutEffect(() => {
		let handler = (rect: RectLike | null) => setRightclickArea(rect);
		ipcRenderer.on("rightclick", handler);
		return () => { ipcRenderer.off("rightclick", handler); };
	}, []);

	//transparent window clickthrough handler
	useLayoutEffect(clickThroughEffect.bind(null, minimized, rightclickArea, rootref.current, buttonroot.current, gridel.current),
		[minimized, rightclickArea, rootref.current, buttonroot.current, gridel.current]);

	return (
		<div className="approot" ref={rootref}>
			<div className="appgrid" ref={gridel} >
				<BorderEl ver="top" hor="left" />
				<BorderEl ver="top" hor="" />
				<BorderEl ver="top" hor="right" />
				<BorderEl ver="" hor="left" />
				<BorderEl ver="" hor="right" />
				<BorderEl ver="bot" hor="left" />
				<BorderEl ver="bot" hor="" />
				<BorderEl ver="bot" hor="right" />
			</div>
			<div className="buttonroot" ref={buttonroot}>
				<div className="button button-close" onClick={e => close()} />
				<div className={`button ${minimized ? "button-restore" : "button-minimize"}`} onClick={e => setMinimized(!minimized)} />
				<div className="button button-settings" onMouseDown={toggleDevTools} />
				<div className="dragbutton" onMouseDown={e => startDrag(e, true, true, true, true)} />
			</div>
		</div>
	);
}

function toggleDevTools(e: React.MouseEvent) {
	if (e.button == 0) {
		if (appview) {
			const webContentsId = appview.getWebContentsId();
			if (remote.webContents.isDevToolsOpened(webContentsId)) {
				remote.webContents.closeDevTools(webContentsId);
			} else {
				remote.webContents.openDevTools(webContentsId, { mode: "detach" });
			}
		}
	} else if (e.button == 2) {
		const currentWc = remote.getCurrentWebContents();
		const currentId = currentWc.id;
		if (remote.webContents.isDevToolsOpened(currentId)) {
			remote.webContents.closeDevTools(currentId);
		} else {
			remote.webContents.openDevTools(currentId, { mode: "detach" });
		}
	}
}

function BorderEl(p: { ver: "top" | "bot" | "", hor: "left" | "right" | "" }) {
	return <div className={classnames("border", "border-" + p.ver + p.hor)} onMouseDown={e => borderDrag(e, p.ver, p.hor)}></div>
}

function borderDrag(e: React.MouseEvent, ver: "top" | "bot" | "", hor: "left" | "right" | "") {
	return startDrag(e, hor == "left", ver == "top", hor == "right", ver == "bot");
}

function startDrag(e: React.MouseEvent, left: boolean, top: boolean, right: boolean, bot: boolean) {
	e.preventDefault();
	ipcRenderer.sendSync("dragwindow", left, top, right, bot);
}

function subtractRects(rect: RectLike, sub: RectLike) {
	let rects: RectLike[] = [];
	let y1 = rect.y;
	let y2 = Math.min(rect.y + rect.height, sub.y);
	//above sub rect
	if (y2 > y1) {
		rects.push({ x: rect.x, y: y1, width: rect.width, height: y2 - y1 });
	}
	let y3 = Math.min(rect.y + rect.height, sub.y + sub.height);
	if (y3 > y2) {
		//left of sub rect
		if (rect.x < sub.x) {
			rects.push({ x: rect.x, y: y2, width: Math.min(rect.x + rect.width, sub.x) - rect.x, height: y3 - y2 });
		}
		//right of sub rect
		if (sub.x + sub.width < rect.x + rect.width) {
			rects.push({ x: sub.x + sub.width, y: y2, width: rect.x + rect.width - sub.x - sub.width, height: y3 - y2 });
		}
	}
	let y4 = rect.y + rect.height;
	//below sub rect
	if (y4 > y3) {
		rects.push({ x: rect.x, y: y3, width: rect.width, height: y4 - y3 });
	}
	return rects;
}

function clickThroughEffect(minimized: boolean, rc: RectLike, root: HTMLElement, buttonroot: HTMLElement, gridel: HTMLDivElement) {
	if (!buttonroot || !root || !gridel) { return; }

	//visual transparency
	gridel.style.display = (minimized ? "none" : "");
	if (rc) {
		//TODO handle window scaling, the coords are in window client area pixel coords
		//This method is current broken in electron but works in browser? maybe need update
		// let path = "";
		// //path around entire window
		// path += `M0 0 H${window.innerWidth} V${window.innerHeight} H0 Z `;
		// //second path around the rightclick area this erases it because of rule evenodd
		// path += `M${rightclickArea.x} ${rightclickArea.y} h${rightclickArea.width} v${rightclickArea.height} h${-rightclickArea.width} Z`;
		// appstyle.clipPath = `path(evenodd,"${path}")`;
		//kinda hacky this way with a 0 width line running through the clickable area but it works
		let path = "";
		path += `0 0, ${window.innerWidth}px 0, ${window.innerWidth}px ${window.innerHeight}px, 0 ${window.innerHeight}px,0 0,`;
		path += `${rc.x}px ${rc.y}px,${rc.x + rc.width}px ${rc.y}px, ${rc.x + rc.width}px ${rc.y + rc.height}px, ${rc.x}px ${rc.y + rc.height}px, ${rc.x}px ${rc.y}px`;
		root.style.clipPath = `polygon(evenodd,${path})`;
	} else {
		root.style.clipPath = "";
	}

	//mouse events
	if (process.platform != "linux") {
		if (minimized || rc) {
			//TODO check if this actually works when element is hidden while being hovered
			let currenthover = root.matches(":hover");
			thiswindow.window.setIgnoreMouseEvents(!currenthover);
			let handler = (e: MouseEvent) => {
				thiswindow.window.setIgnoreMouseEvents(e.type == "mouseleave");
			};
			root.addEventListener("mouseenter", handler);
			root.addEventListener("mouseleave", handler);
			return () => {
				root.removeEventListener("mouseenter", handler);
				root.removeEventListener("mouseleave", handler);
			}
		} else {
			thiswindow.window.setIgnoreMouseEvents(false);
		}
	} else {
		const fullwndrect = { x: 0, y: 0, width: 5000, height: 5000 };
		if (minimized || rc) {
			let btnrects: RectLike[] = [];
			if (minimized) {
				for (let i = 0; i < buttonroot.children.length; i++) {
					let child = buttonroot.children[i];
					let rect = child.getBoundingClientRect();
					btnrects.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
				}
			} else {
				btnrects.push(fullwndrect);
			}
			if (rc) {
				btnrects = btnrects.flatMap(b => subtractRects(b, rc));
			}
			//actually need one pixel or the graphics won't update
			if (btnrects.length == 0) { btnrects.push({ x: 0, y: 0, width: 1, height: 1 }); }
			ipcRenderer.send("shape", thiswindow.nativeWindow.handle, btnrects);
		} else {
			//need to set it to an actual shape or graphics won't update
			ipcRenderer.send("shape", thiswindow.nativeWindow.handle, [fullwndrect]);
		}
	}
}
