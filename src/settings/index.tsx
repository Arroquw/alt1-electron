import { ipcRenderer } from "electron";
import type { Settings, Bookmark } from "../settings";
import type { CaptureMode } from "../native";
import * as React from "react";
import * as ReactDom from "react-dom";
import "../appframe/alt1api";
import * as a1lib from "alt1";
import { runCaptureDiagnostic } from "../readers/capturediagnostic";
import "./style.scss";
import "./index.html";

window.addEventListener("DOMContentLoaded", start);

async function start() {
	ReactDom.render(<SettingsComponent />, document.getElementById("root"));
}

function SettingsComponent() {
	let [tab, setTab] = React.useState<"apps" | "capture">("apps");
	let [settings, updateSettings] = React.useState<Settings | null>(null);

	React.useEffect(() => {
		let onchange = async () => updateSettings(await ipcRenderer.invoke("getsettings"));
		ipcRenderer.on("settings-changed", onchange);
		onchange();
		return () => { ipcRenderer.off("settings-changed", onchange); }
	}, [updateSettings]);

	let content = <h1>Invalid tab</h1>;

	if (tab == "apps" && settings) {
		content = <AppSettings bookmarks={settings.bookmarks} />
	}
	if (tab == "capture" && settings) {
		content = <CaptureSettings settings={settings} />
	}

	return (
		<React.Fragment>
			<button onClick={() => setTab("apps")}>Apps</button>
			<button onClick={() => setTab("capture")}>Capture</button>
			<hr />
			{content}
		</React.Fragment>
	);
}

interface AppSettingsProps {
	bookmarks: Array<Bookmark>;
}

interface AppSettingsState {
	configUrl: string;
	pending: null | { normalizedUrl: string; appName: string; description: string };
	status: string;
	error: string;
	busy: boolean;
}

class AppSettings extends React.Component<AppSettingsProps, AppSettingsState> {
	constructor(props) {
		super(props);
		this.state = {
			configUrl: "",
			pending: null,
			status: "",
			error: "",
			busy: false
		};
	}

	async addAppSubmit(e) {
		e.preventDefault();

		const input = this.state.configUrl.trim();
		if (!input) { return; }

		this.setState({ busy: true, error: "", status: "", pending: null });

		try {
		const res = await ipcRenderer.invoke("installapp_preview", input);
		// res: { normalizedUrl: string, config: AppConfigImport }
		this.setState({
			pending: {
			normalizedUrl: res.normalizedUrl,
			appName: res.config.appName,
			description: res.config.description || ""
			},
			busy: false
		});
		} catch (err: any) {
		this.setState({
			error: err?.message ?? String(err),
			busy: false
		});
		}
	}

	async confirmInstall() {
		if (!this.state.pending) { return; }

		this.setState({ busy: true, error: "", status: "" });
		try {
		await ipcRenderer.invoke("installapp_confirm", this.state.pending.normalizedUrl);
		this.setState({
			status: `Installed ${this.state.pending.appName}`,
			configUrl: "",
			pending: null,
			busy: false
		});
		} catch (err: any) {
		this.setState({
			error: err?.message ?? String(err),
			busy: false
		});
		}
	}

	cancelInstall() {
		this.setState({ pending: null, error: "", status: "" });
	}

	render() {
		let apps = this.props.bookmarks.map(i => {
			return <tr key={i.appUrl}>
				<td><img width={20} height={20} src={i.iconCached} /></td>
				<td><span>{i.appName}</span></td>
				<td><button onClick={() => ipcRenderer.invoke("openapp", i.configUrl)}>Open</button></td>
				<td><button onClick={() => ipcRenderer.invoke("removeapp", i.configUrl)}>Remove</button></td>
			</tr>;
		})

		return <React.Fragment>
			<table><tbody>{apps}</tbody></table>
			<hr />
			<form onSubmit={this.addAppSubmit.bind(this)}>
				<label>Config URL <input type="text" value={this.state.configUrl} onChange={e => this.setState({ configUrl: e.target.value })} /></label>
				<button type="submit">Add App</button>
			</form>
			{this.state.pending && (
				<div style={{ marginTop: "1rem" }}>
					<div>
						Install <b>{this.state.pending.appName}</b>?
					</div>
					{this.state.pending.description && <div>{this.state.pending.description}</div>}
					<div style={{ marginTop: ".5rem" }}>
						<button onClick={this.confirmInstall.bind(this)} disabled={this.state.busy}>Yes</button>
						<button onClick={this.cancelInstall.bind(this)} disabled={this.state.busy}>No</button>
					</div>
				</div>
			)}

			{this.state.status && <div style={{ marginTop: "1rem" }}>{this.state.status}</div>}
			{this.state.error && <div style={{ marginTop: "1rem" }}><b>Error:</b> {this.state.error}</div>}
		</React.Fragment>;
	}
}


function CaptureSettings(props: { settings: Settings }) {
	let modechange = (e: React.ChangeEvent<HTMLInputElement>) => {
		let captureMode = e.currentTarget.value as CaptureMode;
		ipcRenderer.invoke("setcapturemode", captureMode);
	}

	return (
		<React.Fragment>
			<p>Capture mode</p>
			<label><input type="radio" value="opengl" name="captmode" onChange={modechange} checked={props.settings.captureMode == "opengl"} />OpenGL</label>
			<label><input type="radio" value="window" name="captmode" onChange={modechange} checked={props.settings.captureMode == "window"} />Window</label>
			<label><input type="radio" value="desktop" name="captmode" onChange={modechange} checked={props.settings.captureMode == "desktop"} />Desktop</label>
			<CapturePreview mode={props.settings.captureMode} />
		</React.Fragment>
	);
}

function CapturePreview(p: { mode: CaptureMode }) {
	let [diag, setdiagnostic] = React.useState<ReturnType<typeof runCaptureDiagnostic> | null>(null);

	let reffnc = React.useMemo(() => {
		let interval = 0;
		return (cnv: HTMLCanvasElement | null) => {
			if (interval) { clearInterval(interval); }
			if (cnv) {
				let ctx = cnv.getContext("2d")!;
				let render = async () => {
					let img = await a1lib.captureAsync(0, 0, alt1.rsWidth, alt1.rsHeight);
					cnv.width = img.width;
					cnv.height = img.height;
					ctx.putImageData(img, 0, 0);
					setdiagnostic(runCaptureDiagnostic(new a1lib.ImgRefData(img)));
				}
				interval = +setInterval(render, 100);
				render();
			}
		}
	}, [p.mode]);

	return (
		<React.Fragment>
			<canvas ref={reffnc} style={{ maxWidth: "500px", maxHeight: "500px" }} />
			{diag && <div>{
				diag.homeportfound ? "Home teleport button found, capture seems to be working correctly!" : "Alt1 failed to find the home teleport button."
			}</div>}
		</React.Fragment>
	)
}
