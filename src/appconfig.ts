import { readJsonWithBOM, sameDomainResolve, UserError } from "./lib";
import fetch from "node-fetch";
import { Bookmark } from "./settings";
import Checks, { UservarType } from "../tempexternal/typecheck";
import { TypedEmitter } from "./typedemitter";

export type AppConfigImport = UservarType<typeof checkAppConfigImport>;

var checkAppConfigImport = Checks.obj({
	appName: Checks.str(),
	description: Checks.str(""),
	appUrl: Checks.str(),
	configUrl: Checks.str(),
	iconUrl: Checks.str(""),
	defaultWidth: Checks.num(400),
	defaultHeight: Checks.num(500),
	minWidth: Checks.num(0),
	minHeight: Checks.num(0),
	maxWidth: Checks.num(10000),
	maxHeight: Checks.num(10000),
	permissions: Checks.arr(Checks.strenum({ pixel: "Pixel", game: "Gamestate", overlay: "Overlay" }))
});

async function tryUpdateIcon(bm: Bookmark) {
	try {
		const cacheduration = 1000 * 60 * 60 * 5;
		if (bm.iconCachedTime > Date.now() - cacheduration) { return; }
		let res = await fetch(bm.iconUrl);
		let imgbuf = await res.arrayBuffer();
		let mimetype = res.headers.get("Content-Type")!;
		if (["image/png", "image/jpeg"].indexOf(mimetype) == -1) { throw new UserError("unexpected image mimetype, only jpeg and png accepted"); }
		let base64 = "data:" + mimetype + ";base64," + Buffer.from(imgbuf).toString("base64");
		bm.iconCached = base64;
		bm.iconCachedTime = Date.now();
	} catch (e) {
		console.error(e);
	}
}

type AppConfigEvents = {
	"changed": []
}

export class AppConfig extends TypedEmitter<AppConfigEvents> {
	private bookmarks: Bookmark[];

	constructor(bookmarks: Bookmark[]) {
		super();
		this.bookmarks = bookmarks;
	}

	setBookmarks(bookmarks: Bookmark[]) {
		this.bookmarks = bookmarks;
		this.emit("changed");
	}

	resetWasOpen() {
		for (let b of this.bookmarks) {
			b.wasOpen = false;
		}
		this.emit("changed");
	}

	async installApp(url: URL, res: AppConfigImport) {
		if (this.bookmarks.find(a => a.configUrl == url.href)) {
			throw new UserError("App is already installed");
		}
		let config: Bookmark = {
			appName: "",
			description: "",
			configUrl: url.href,
			appUrl: "",
			iconUrl: "",
			iconCached: "",
			iconCachedTime: 0,
			defaultHeight: 500,
			defaultWidth: 370,
			minHeight: 20,
			minWidth: 20,
			maxWidth: 0,
			maxHeight: 0,
			permissions: [],
			lastRect: null,
			wasOpen: false
		};
		
		this.bookmarks.push(config);
		await this.updateAppconfig(config, res);
		return config;
	}

	private async updateAppconfig(prev: Bookmark, config: AppConfigImport) {
		let entryurl = sameDomainResolve(prev.configUrl, config.appUrl);
		let iconurl = sameDomainResolve(prev.configUrl, config.iconUrl);
	
		prev.appName = config.appName;
		prev.description = config.description;
		prev.appUrl = entryurl.href;
		prev.iconUrl = iconurl.href;
		prev.minWidth = config.minWidth;
		prev.minHeight = config.minHeight;
		prev.maxWidth = config.maxWidth;
		prev.maxHeight = config.maxHeight;
		prev.defaultWidth = config.defaultWidth;
		prev.defaultHeight = config.defaultHeight;
	
		await tryUpdateIcon(prev);
		this.emit("changed");
	}

	async identifyApp(url: URL) {
		try {
			let res: unknown = await fetch(url.href).then(r => readJsonWithBOM(r));
			var config = checkAppConfigImport.load(res, { defaultOnError: true });
		} catch (e) {
			console.log("failed to load appconfig from url: " + url);
			return;
		}
		//TODO typecheck result
		let app = this.bookmarks.find(q => q.configUrl == url.href);
		if (!app) {
			//throw new Error("App is not installed yet");
			//TODO add app confirm ui
			app = await this.installApp(url, config);
		} else {
			await this.updateAppconfig(app, config);
		}
		return app;
	}

	uninstallApp(url: string) {
		let idx = this.bookmarks.findIndex(a => a.configUrl == url);
		if (idx == -1) {
			throw new UserError("App is already uninstalled");
		}

		this.bookmarks.splice(idx, 1);
		this.emit("changed");
	}

	private normalizeInstallInput(raw: string): string {
		let s = (raw ?? "").trim();
		if (!s) { throw new UserError("Paste an app URL or an appconfig.json URL."); }

		if (s.toLowerCase().startsWith("alt1://addapp/")) {
			s = s.slice("alt1://addapp/".length);
		} else if (s.toLowerCase().startsWith("alt1://")) {
			throw new UserError("Paste the app's appconfig.json URL (not an alt1:// link).");
		}

		// Assume https if user pasted bare domain/path
		if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) {
			s = `https://${s}`;
		}
		return s;
	}

	private candidateConfigUrls(input: string): URL[] {
		const base = new URL(input);
		const p = base.pathname.toLowerCase();

		if (p.endsWith("/appconfig.json") || p.endsWith(".json")) {
			return [base];
		}

		const baseHref = base.href.endsWith("/") ? base.href : `${base.href}/`;
		return [
			new URL("appconfig.json", baseHref),
			new URL("dist/appconfig.json", baseHref),
		];
	}

	async previewInstall(raw: string) {
		const normalizedInput = this.normalizeInstallInput(raw);
		const candidates = this.candidateConfigUrls(normalizedInput);

		for (const url of candidates) {
			try {
				const res: unknown = await fetch(url.href).then(r => readJsonWithBOM(r));
				const config = checkAppConfigImport.load(res, { defaultOnError: true });
				return { normalizedUrl: url.href, config };
			} catch {
				// try next candidate
			}
		}
		throw new UserError("Could not find a valid appconfig.json at that URL.");
	}

	async confirmInstall(normalizedUrl: string) {
		const app = await this.identifyApp(new URL(normalizedUrl));
		if (!app) { throw new UserError("Install failed."); }
		return app;
	}
}
