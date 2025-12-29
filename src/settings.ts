import Checks, { UservarType } from "../tempexternal/typecheck";
import * as fs from "fs";
import * as os from 'os';
import * as path from 'path';
import { readJsonWithBOM, weborigin } from "./lib";
import fetch from "node-fetch";
import { CaptureMode } from "./native";
import { TypedEmitter } from "./typedemitter";
import { AppConfig } from "./appconfig";

export type AppPermission = UservarType<typeof checkPermission>;
export type PinRect = UservarType<typeof checkPinRect>;
export type Bookmark = UservarType<typeof checkBookmark>;
export type Settings = UservarType<typeof checkSettings>;

var checkPermission = Checks.strenum({ "pixel": "Pixel", "overlay": "Overlay", "game": "Game Data" });

var checkPinRect = Checks.obj({
	left: Checks.num(),
	right: Checks.num(),
	bot: Checks.num(),
	top: Checks.num(),
	width: Checks.num(),
	height: Checks.num(),
	pinning: Checks.arr(Checks.strenum({ "left": "Left", "top": "Top", "right": "Right", "bot": "Bottom" }))
});

var checkBookmark = Checks.obj({
	appName: Checks.str(),
	description: Checks.str(),
	appUrl: Checks.str(),
	configUrl: Checks.str(),
	iconUrl: Checks.str(),
	defaultWidth: Checks.num(undefined, 0),
	defaultHeight: Checks.num(undefined, 0),
	minWidth: Checks.num(undefined, 0),
	minHeight: Checks.num(undefined, 0),
	maxWidth: Checks.num(undefined, 0),
	maxHeight: Checks.num(undefined, 0),
	permissions: Checks.arr(checkPermission),
	lastRect: Checks.opt(checkPinRect),
	wasOpen: Checks.bool(),
	iconCached: Checks.str(),
	iconCachedTime: Checks.num(),
});

var checkSettings = Checks.obj({
	captureMode: Checks.strenum<CaptureMode>({ desktop: "Desktop", opengl: "OpenGL", window: "Window" }, "window"),
	bookmarks: Checks.arr(checkBookmark)
});

type SettingsEvents = {
	changed: []
}

function getPlatformConfigPath(filename: string): string {
	const platform = process.platform;
	const home = os.homedir();
	const appName = "alt1";

	if (platform === 'win32') {
		const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
		return path.join(appData, appName, filename);
	}
	else if (platform === 'darwin') {
		return path.join(home, 'Library', 'Preferences', appName, filename);
	}
	else {
		// Linux and other Unix-like systems
		const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
		return path.join(xdgConfig, appName, filename);
	}
}

const configFileName = "config.json";
const configFile = process.env.ALT1_CONFIG_FILE ||
	getPlatformConfigPath(configFileName);


// Ensure the config directory exists
try {
	const configDir = path.dirname(configFile);
	if (!fs.existsSync(configDir)) {
		fs.mkdirSync(configDir, { recursive: true });
	}
} catch (e) {
	console.error("Could not create config directory:", e);
}

class ManagedSettings extends TypedEmitter<SettingsEvents> {
	settings: Settings;
	appconfig: AppConfig;
	path: string;

	private saveTimer: NodeJS.Timeout | null = null;

	private scheduleSave() {
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			try {
				this.save();
			} catch (e) {
				console.error("Failed to save settings:", e);
			}
		}, 250);
	}

	constructor(path: string) {
		super();
		this.path = path;
		this.settings = checkSettings.default();
		this.appconfig = new AppConfig(this.settings.bookmarks);
		this.appconfig.on("changed", () => {
			this.scheduleSave();
			this.emit("changed");
		});
	}

	/**
	 * Load settings from file, or fetch the default if it fails.
	 * Called on top-level, where await is not possible. Default settings are loaded in the background.
	 */
	loadOrFetch() {
		console.log("Reading from path: ", this.path);
		try {
			let file = JSON.parse(fs.readFileSync(this.path, "utf8"));
			this.settings = checkSettings.load(file, { defaultOnError: true });
			this.appconfig.setBookmarks(this.settings.bookmarks);
		} catch (e) {
			console.log("couldn't load config");
			console.log(e);
			this.settings = checkSettings.default();
			this.appconfig.setBookmarks(this.settings.bookmarks);

			fetch(`${weborigin}/data/alt1/defaultapps.json`).then(r => readJsonWithBOM(r)).then(async (r: { folder: string, name: string, url: string }[]) => {
				for (let appbase of r) {
					await this.appconfig.identifyApp(new URL(`${weborigin}${appbase.url}`));
				}
			});
		}
		this.emit("changed");
	}

	save() {
		let data = JSON.stringify(checkSettings.store(this.settings), undefined, "\t");
		fs.writeFileSync(this.path, data, { encoding: "utf8" });
	}

	get captureMode() {
		return this.settings.captureMode;
	}


	set captureMode(mode: CaptureMode) {
		if (!Object.keys(checkSettings.props.captureMode.opts).includes(mode)) {
			console.log("unknown capture mode", mode);
			return;
		}
		this.settings.captureMode = mode;
		this.scheduleSave();
		this.emit("changed");
	}

	/**
	 * Emit the "changed" event on AppConfig if the contents of this array are modified.
	 */
	get bookmarks() {
		return this.settings.bookmarks;
	}
}

export var settings = new ManagedSettings(configFile);
