const path = require("path");

/** @type {import("webpack").Configuration} */
const common = {
	resolve: {
		extensions: [".wasm", ".tsx", ".ts", ".mjs", ".jsx", ".js", ".json"],
		alias: {
			"electron/main": "electron",
			"electron/renderer": "electron",
			"electron/common": "electron",
		},
	},
	module: {
		parser: { javascript: { commonjsMagicComments: true } },
		rules: [
			{ test: /\.(ts|tsx)$/, use: [{ loader: "ts-loader" }] },
			{ test: /\.css$/, use: ["style-loader", "css-loader"] },
			{ test: /\.scss$/, use: ["style-loader", "css-loader", "sass-loader"] },

			{ test: /\.data\.png$/i, use: [{ loader: "alt1/imagedata-loader" }] },
			{
				test: /\.(png|jpg|gif)$/i,
				exclude: /\.data\.png$/i,
				use: [
					{
						loader: "url-loader",
						options: {
							limit: 8192,
							esModule: false,
							name: "[path][name].[ext]",
						},
					},
				],
			},

			{
				test: /\.json$/,
				type: "javascript/auto",
				use: [{ loader: "json-loader" }],
			},
			{
				test: /\.fontmeta\.json$/,
				type: "javascript/auto",
				use: [{ loader: "alt1/font-loader" }],
			},

			{
				test: /\.html$/,
				use: [
					{ loader: "file-loader", options: { name: "[path][name].[ext]" } },
				],
			},
		],
	},
};

module.exports = (env = {}) => {
	const prod = !!(
		env.prod ??
		env.production ??
		(env.mode ? env.mode === "prod" : false)
	);

	const mode = prod ? "production" : "development";
	const devtool = prod ? "source-map" : "eval-source-map";

	const output = {
		path: path.resolve(__dirname, "dist"),
		filename: "[name].bundle.js",
		chunkFilename: prod ? "[name]_[chunkhash].bundle.js" : "[name].bundle.js",
		globalObject: "(typeof self!='undefined'?self:this)",
	};

	const externalsCommon = {
		fs: "commonjs2 fs",
		path: "commonjs2 path",
		os: "commonjs2 os",
		canvas: "commonjs2 canvas",
		sharp: "commonjs2 sharp",
	};

	const externalsAll = {
		...externalsCommon,
		electron: "commonjs2 electron",
		"electron/main": "commonjs2 electron",
		"electron/renderer": "commonjs2 electron",
		"electron/common": "commonjs2 electron",
		"@electron/remote": "commonjs2 @electron/remote",
	};

	return [
		{
			// Main process bundle
			...common,
			mode,
			devtool,
			target: "electron-main",
			context: path.resolve(__dirname, "./src/"),
			entry: { alt1lite: "./main.ts" },
			output,
			externals: externalsAll,
		},
		{
			// preload
			...common,
			mode,
			devtool,
			target: "electron-preload",
			context: path.resolve(__dirname, "./src/"),
			entry: {
				"appframe/preload": "./appframe/preload.ts",
				"appframe/alt1api": "./appframe/alt1api.ts",
			},
			output,
			externals: externalsAll,
		},
		{
			// Renderer bundles
			...common,
			mode,
			devtool,
			target: "web",
			context: path.resolve(__dirname, "./src/"),
			entry: {
				"appframe/index": "./appframe/index.tsx",
				"overlayframe/index": "./overlayframe/index.tsx",
				"settings/index": "./settings/index.tsx",
				"tooltip/index": "./tooltip/index.tsx",
				"tests/index": "./tests/index.ts",
			},
			output,
			externals: externalsAll,
		},
	];
};
