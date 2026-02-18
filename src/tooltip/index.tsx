import "./style.scss";
import "./index.html";

const ipcRenderer = window.electronIPC;

ipcRenderer.on("settooltip", (e, text: string) => {
	let el = document.getElementById("content")!;
	el.innerText = text;
	window.resizeTo(el.offsetWidth, el.offsetHeight);
});
