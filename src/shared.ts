import { CaptureMode } from "./native";

export type FlatImageData = { data: Uint8ClampedArray, width: number, height: number };
export type SyncResponse<T> = { error: string } | { error: undefined, value: T };
export type Rectangle = { x: number, y: number, width: number, height: number };
export type RsClientState = {
	clientRect: Rectangle,
	active: boolean,
	lastActiveTime: number,
	ping: number,
	scaling: number,
	captureMode: CaptureMode,
	mousePosition: number,
}


type DrawBase = {};

type DrawLine = DrawBase & { type: "line", color: number, linewidth: number, x1: number, y1: number, x2: number, y2: number };
type DrawRect = DrawBase & { type: "rect", color: number, linewidth: number, x: number, y: number, width: number, height: number };
type DrawRectFill = DrawBase & { type: "rectfill", color: number, fillColor: number, linewidth: number, x: number, y: number, width: number, height: number };
type DrawText = DrawBase & { type: "text", color: number, size: number, text: string, font: string, shadow: boolean, center: boolean, x: number, y: number };
type DrawSprite = DrawBase & { type: "sprite", x: number, y: number, sprite: FlatImageData };

export type OverlayPrimitive = DrawLine | DrawRect | DrawRectFill | DrawText | DrawSprite;

type CommandBase = {}
type CommandDraw = CommandBase & { command: "draw", time: number, action: OverlayPrimitive };
type CommandSetGroup = CommandBase & { command: "setgroup", groupid: string };
type CommandClearGroup = CommandBase & { command: "cleargroup", groupid: string };
type CommandFreezeGroup = CommandBase & { command: "freezegroup", groupid: string };
type CommandContinueGroup = CommandBase & { command: "continuegroup", groupid: string };
type CommandRefreshGroup = CommandBase & { command: "refreshgroup", groupid: string };
type CommandSetgroupZindex = CommandBase & { command: "setgroupzindex", groupid: string, zindex: number };

export type OverlayCommand = CommandDraw | CommandSetGroup | CommandClearGroup | CommandFreezeGroup | CommandContinueGroup | CommandRefreshGroup | CommandSetgroupZindex;

export function imageDataFrom(
	src: ArrayBufferView,
	w: number,
	h: number
): ImageData {
	// Normalize to Uint8ClampedArray (usually zero-copy)
	const clamped =
	src instanceof Uint8ClampedArray
	? src
	: new Uint8ClampedArray(src.buffer, src.byteOffset, src.byteLength);

	// RGBA = 4 bytes per pixel
	const expected = w * h * 4;
	if (clamped.byteLength !== expected) {
		console.warn(
			`imageDataFrom: unexpected byteLength (got ${clamped.byteLength}, expected ${expected}) for ${w}x${h}`
		);
	}

	// ImageData requires ArrayBuffer-backed data in newer DOM typings
	const buf = clamped.buffer;
	const data =
	buf instanceof ArrayBuffer
	? new Uint8ClampedArray(buf, clamped.byteOffset, clamped.byteLength)
	: new Uint8ClampedArray(clamped); // copy if SharedArrayBuffer-backed

	return new ImageData(data, w, h);
}
