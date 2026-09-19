import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageDir, "../..");
const minNode = { major: 22, minor: 19, patch: 0 };

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
	console.log(`Usage: node packages/desktop/scripts/start.mjs [--install] [--rebuild-electron]

Prepare and launch the Pi Desktop development app from the repository root.

  --install            Run npm install --ignore-scripts even if node_modules exists
  --rebuild-electron   Download the Electron binary even if one is already present
`);
	process.exit(0);
}

const forceInstall = args.includes("--install");
const forceRebuildElectron = args.includes("--rebuild-electron");

assertNodeVersion();

if (forceInstall || !existsSync(join(repoRoot, "node_modules"))) {
	console.log("Installing workspace dependencies (npm install --ignore-scripts)...");
	run(npmCommand(), ["install", "--ignore-scripts"], { cwd: repoRoot });
}

if (forceRebuildElectron || !electronBinaryExists()) {
	console.log("Downloading the Electron binary (npm rebuild electron). This runs Electron's install script.");
	run(npmCommand(), ["rebuild", "electron"], { cwd: repoRoot });
	if (!electronBinaryExists()) {
		fail("Electron binary is still missing after npm rebuild electron.");
	}
}

run(process.execPath, [join(packageDir, "scripts", "build.mjs")], { cwd: packageDir });

const electronCli = join(repoRoot, "node_modules", "electron", "cli.js");
if (!existsSync(electronCli)) {
	fail(`Electron CLI not found at ${electronCli}. Run npm install --ignore-scripts from the repo root.`);
}

const child = spawn(process.execPath, [electronCli, "."], {
	cwd: packageDir,
	stdio: "inherit",
	env: process.env,
});
child.on("exit", (code, signal) => {
	if (signal) process.exit(1);
	process.exit(code ?? 0);
});

function assertNodeVersion() {
	const [major, minor, patch] = process.versions.node.split(".").map((part) => Number(part));
	const tooOld =
		major < minNode.major ||
		(major === minNode.major && minor < minNode.minor) ||
		(major === minNode.major && minor === minNode.minor && patch < minNode.patch);
	if (tooOld) {
		fail(`Node.js ${minNode.major}.${minNode.minor}.${minNode.patch} or newer is required (found ${process.versions.node}).`);
	}
}

function electronBinaryExists() {
	const dist = join(repoRoot, "node_modules", "electron", "dist");
	return (
		existsSync(join(dist, "electron")) ||
		existsSync(join(dist, "electron.exe")) ||
		existsSync(join(dist, "Electron.app"))
	);
}

function npmCommand() {
	return process.platform === "win32" ? "npm.cmd" : "npm";
}

function run(command, commandArgs, options) {
	const result = spawnSync(command, commandArgs, {
		stdio: "inherit",
		...options,
	});
	if (result.error) fail(result.error.message);
	if (result.status !== 0) process.exit(result.status ?? 1);
}

function fail(message) {
	console.error(message);
	process.exit(1);
}
