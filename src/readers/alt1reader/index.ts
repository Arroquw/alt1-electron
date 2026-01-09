import { ImgRefData, Rect } from "alt1";
import * as OCR from "alt1/ocr";
import RightClickReader from "../rightclick";

const chatfonts: { name: TextResult["font"], font: OCR.FontDefinition }[] = [
	{ name: "10pt", font: require("alt1/fonts/chatbox/10pt.js") },
	{ name: "12pt", font: require("alt1/fonts/chatbox/12pt.js") },
	{ name: "14pt", font: require("alt1/fonts/chatbox/14pt.js") },
	{ name: "16pt", font: require("alt1/fonts/chatbox/16pt.js") },
	{ name: "18pt", font: require("alt1/fonts/chatbox/18pt.js") },
	{ name: "8px_digit", font: require("alt1/fonts/pixel_8px_digits.js") },
	{ name: "8px_allcaps", font: require("alt1/fonts/aa_8px_mono_allcaps.js") },
	{ name: "8px_mono", font: require("alt1/fonts/aa_8px_mono.js") },
	{ name: "8px", font: require("alt1/fonts/aa_8px.js") },
	{ name: "9px", font: require("alt1/fonts/aa_9px_mono_allcaps.js") },
	{ name: "10px", font: require("alt1/fonts/aa_10px_mono.js") },
	{ name: "12px", font: require("alt1/fonts/aa_12px_mono.js") },
];

type TextResult = {
	type: "text",
	font: "8px" | "8px_allcaps" | "8px_mono" | "8px_digit" | "10px" | "10pt" | "12pt" | "12px" | "9px" | "14pt" | "16pt" | "18pt",//larger than 18 has unreasonable perf cost
	line: ReturnType<typeof OCR["findReadLine"]>
}

type RightClickResult = {
	type: "rightclick",
	line: ReturnType<typeof OCR["findReadLine"]>,
	menu: ReturnType<InstanceType<typeof RightClickReader>["read"]>
}

function debugShowImage(img: ImageData) {
	const canvas = document.createElement("canvas");
	canvas.width = img.width;
	canvas.height = img.height;

	const ctx = canvas.getContext("2d")!;
	ctx.putImageData(img, 0, 0);

	canvas.style.border = "1px solid red";
	canvas.style.imageRendering = "pixelated"; // important
	document.body.appendChild(canvas);
}

function debugPoint(img: ImageData, x: number, y: number) {
	const canvas = document.createElement("canvas");
	canvas.width = img.width;
	canvas.height = img.height;

	const ctx = canvas.getContext("2d")!;
	ctx.putImageData(img, 0, 0);

	ctx.strokeStyle = "red";
	ctx.beginPath();
	ctx.arc(x, y, 2, 0, Math.PI * 2);
	ctx.stroke();

	document.body.appendChild(canvas);
}

function debugColorRect(img: ImageData, x: number, y: number, colorRect: Rect) {
	const canvas = document.createElement("canvas");
	canvas.width = img.width;
	canvas.height = img.height;

	const ctx = canvas.getContext("2d")!;
	ctx.putImageData(img, 0, 0);

	ctx.strokeStyle = "lime";
	ctx.strokeRect(colorRect.x, colorRect.y, colorRect.width, colorRect.height);

	document.body.appendChild(canvas);
}

//copied from alt1/chatbox
export const defaultcolors: OCR.ColortTriplet[] = [
	[0, 255, 0],
	[0, 255, 255],
	[0, 175, 255],
	[0, 0, 255],
	[255, 82, 86],
	[159, 255, 159],
	[0, 111, 0],
	[255, 143, 143],
	[255, 152, 31],
	[255, 111, 0],
	[255, 255, 0],
	//[239, 0, 0],//messes up broadcast detection [255,0,0]
	[239, 0, 175],
	[255, 79, 255],
	[175, 127, 255],
	//[48, 48, 48],//fuck this color, its unlegible for computers and people alike
	[191, 191, 191],
	[127, 255, 255],
	[128, 0, 0],
	[255, 255, 255],
	[127, 169, 255],
	[255, 140, 56], //orange drop received text
	[255, 0, 0], //red achievement world message
	[69, 178, 71], //blueish green friend broadcast
	[164, 153, 125], //brownish gray friends/fc/cc list name
	[215, 195, 119] //interface preset color
];

export function readAnything(img: ImageData, x: number, y: number, fontname?: string, color?: OCR.ColortTriplet) {
	//TODO: parse fontname
	let reader = new RightClickReader();
	if (reader.find(new ImgRefData(img))) {
		let menu = reader.read(img);
		return { type: "rightclick", line: menu.hoveredText, menu } as RightClickResult;
	}

	let colorRect = new Rect(x, y - 7, 20, 8);
	let col = color ?? OCR.getChatColor(img, colorRect, defaultcolors);
	if (col) {
		for (let font of chatfonts) {
			let text11pt = OCR.findReadLine(img, font.font, [col], x, y);
			let m = text11pt.text.match(/\w/g);
			if (m)
				return { type: "text", font: font.name, line: text11pt } as TextResult;
		}
	}

	// TODO: other alt+1-able things

	return null
}

