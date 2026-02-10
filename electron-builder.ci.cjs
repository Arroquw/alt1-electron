// electron-builder.ci.cjs
const pkg = require("./package.json");

const owner = process.env.GITHUB_REPOSITORY_OWNER;
const repo = (process.env.GITHUB_REPOSITORY || "").split("/")[1];

module.exports = {
	// start with normal electron-builder config
	...(pkg.build || {}),

	// override only publish target to the repo running the workflow
	publish: [
	{
		provider: "github",
		owner,
		repo,
		releaseType: "release"
	},
	],
};
