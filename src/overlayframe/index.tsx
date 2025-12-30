import { ipcRenderer } from "electron/renderer";
import type { OverlayCommand, OverlayPrimitive } from "src/shared";

import "./index.html";

type ActivePrimitive = { endtime: number, visible: boolean, deleted: boolean, action: OverlayPrimitive };
type OverlayGroup = { name: string, frameid: number, zindex: number, frozen: boolean, primitives: ActivePrimitive[], nextupdate: number };
type FrameState = { currentgroup: OverlayGroup; };

let groupstates: OverlayGroup[] = [];
let framestates = new Map<number, FrameState>();
let iszsorted = true;
let cnv = document.getElementById("cnv") as HTMLCanvasElement;
let ctx = cnv.getContext("2d")!;
let redrawtimer = 0;
let shutdowntimer = 0;
const shutdowntimeout = 30 * 1000;

function resizeCanvas() {
  cnv.width = cnv.clientWidth;
  cnv.height = cnv.clientHeight;
}
window.addEventListener("resize", () => { resizeCanvas(); redraw(Date.now(), true); });
resizeCanvas();

function findFrameState(frameid: number) {
	let s = framestates.get(frameid);
	if (s) { return s; }
	s = { currentgroup: findgroup(frameid, "") };
	framestates.set(frameid, s);
	return s;
}

function findgroup(frameid: number, groupid: string) {
	let g = groupstates.find(q => q.name == groupid && q.frameid == frameid);
	if (g) { return g; }
	g = { name: groupid, frameid: frameid, frozen: false, zindex: 0, primitives: [], nextupdate: Infinity };
	groupstates.push(g);
	return g;
}

ipcRenderer.on("overlay", (e, frameid: number, commands) => {
	parseCommands(frameid, commands);
});

ipcRenderer.on("closeframe", (e, frameid: number) => {
	framestates.delete(frameid);
	groupstates = groupstates.filter(q => q.frameid != frameid);
	redraw(Date.now());
	if (groupstates.length === 0) {
		window.close();
	}
});

function parseCommands(frameid: number, commands: OverlayCommand[]) {
	let now = Date.now();
	let framestate = findFrameState(frameid);
	let currentgroup = framestate.currentgroup;
	const DEFAULT_TTL_MS = 1500;
	for (let c of commands) {
		if (c.command === "draw") {
			const ttl = (typeof c.time === "number" && c.time > 0) ? c.time : DEFAULT_TTL_MS;
			currentgroup.primitives.push({
				visible: !currentgroup.frozen,
				deleted: false,
				endtime: now + ttl,
				action: c.action,
			});
			if (!currentgroup.frozen) currentgroup.nextupdate = 0;
		} else if (c.command == "setgroup") {
			currentgroup = findgroup(frameid, c.groupid);
		} else if (c.command == "cleargroup") {
			let group = findgroup(frameid, c.groupid);
			group.primitives.forEach(p => p.deleted = true);
			if (!group.frozen) group.nextupdate = 0;
		} else if (c.command == "setgroupzindex") {
			let group = findgroup(frameid, c.groupid);
			group.zindex = c.zindex;
			iszsorted = false;
			group.nextupdate = 0;
		} else if (c.command == "freezegroup") {
			findgroup(frameid, c.groupid).frozen = true;
		} else if (c.command == "continuegroup" || c.command == "refreshgroup") {
			let group = findgroup(frameid, c.groupid);
			let oldfreeze = group.frozen;
			group.frozen = false;
			cleanGroup(group, now);
			if (c.command == "refreshgroup") {
				group.frozen = oldfreeze;
			}
			group.nextupdate = 0;
		}
	}

	framestate.currentgroup = currentgroup;
	redraw(now);
}

function cleanGroup(g: OverlayGroup, now: number) {
	const bonustime = (!g.frozen ? 0 : 10 * 1000);
	let endtime = now - bonustime;
	g.primitives = g.primitives.filter(p => (!p.deleted || g.frozen) && p.endtime >= endtime);
	//elements created during freeze
	let nextupdate = Infinity;
	for (let prim of g.primitives) {
		if (!g.frozen) { prim.visible = true; }
		nextupdate = Math.min(nextupdate, prim.endtime + bonustime);
	}
	if (!isFinite(nextupdate) && g.primitives.some(p => !p.deleted && p.visible)) {
		nextupdate = now + 250;
	}
	g.nextupdate = nextupdate;
}

function coltocss(c: number) {
	//ARGB
	return `rgb(${(c >> 16) & 0xff},${(c >> 8) & 0xff},${(c >> 0) & 0xff})`;
}

function scheduleRedraw(time: number) {
	if (redrawtimer) {
		clearTimeout(redrawtimer);
		redrawtimer = 0;
	}
	if (isFinite(time)) {
		redrawtimer = setTimeout(redraw, time - Date.now(), time) as any;
	}
}

function redraw(now: number, force = false) {
	if (!iszsorted) {
		groupstates = groupstates.sort((a, b) => a.zindex - b.zindex);
		iszsorted = true;
	}

	let currentnextupdate = Infinity;
	let newnextupdate = Infinity;
	for (let g of groupstates) {
		currentnextupdate = Math.min(currentnextupdate, g.nextupdate);
		cleanGroup(g, now);
		newnextupdate = Math.min(newnextupdate, g.nextupdate);
	}

	//remove obsolete groups
	//groupstates = groupstates.filter(q => q.primitives.length != 0 || q.frozen || q.zindex != 0);

	let drawcount = 0;
	if (force || currentnextupdate <= now) {
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, cnv.width, cnv.height);
		//js uses center of pixel definition
		ctx.translate(0.5, 0.5);

		for (let g of groupstates) {
			const prims = g.primitives.slice();
			const pri = (t: string) => {
				switch (t) {
					case "sprite": return 0;
					case "rect":   return 1;
					case "line":   return 2;
					case "text":   return 3;
					default:	   return 1;
				}
			};

			prims.sort((a, b) => {
				const pa = pri(a.action.type);
				const pb = pri(b.action.type);
				if (pa !== pb) return pa - pb;
				return g.primitives.indexOf(a) - g.primitives.indexOf(b);
			});

			for (const prim of prims) {
				if (prim.deleted) continue;
				if (!prim.visible) continue;
				drawcount++;
				let act = prim.action;
				if (act.type == "line") {
					ctx.strokeStyle = coltocss(act.color);
					ctx.lineWidth = act.linewidth;
					ctx.beginPath();
					ctx.moveTo(act.x1, act.y1);
					ctx.lineTo(act.x2, act.y2);
					ctx.stroke();
				} else if (act.type == "rect") {
					ctx.strokeStyle = coltocss(act.color);
					ctx.lineWidth = act.linewidth;
					ctx.strokeRect(act.x + act.linewidth / 2, act.y + act.linewidth / 2, act.width - act.linewidth, act.height - act.linewidth);
				} else if (act.type == "text") {
					ctx.fillStyle = coltocss(act.color);
					ctx.font = `${act.size}px ${act.font || "sans-serif"}`;
					ctx.textAlign = act.center ? "center" : "start";
					ctx.textBaseline = act.center ? "middle" : "top";
					ctx.fillText(act.text, act.x, act.y);
				} else if (act.type == "sprite") {
					// Check if width and height are valid positive numbers before drawing
					if (act.sprite.width > 0 && act.sprite.height > 0) {
						const imageData = new ImageData(act.sprite.data, act.sprite.width, act.sprite.height);
						ctx.putImageData(imageData, act.x, act.y);
					}
				}
			}
		}
	}

	if (drawcount == 0 && !shutdowntimer) {
		shutdowntimer = setTimeout(e => window.close(), shutdowntimeout) as any;
	}
	if (drawcount != 0 && shutdowntimer) {
		clearTimeout(shutdowntimer);
		shutdowntimer = 0;
	}

	scheduleRedraw(newnextupdate);
}
