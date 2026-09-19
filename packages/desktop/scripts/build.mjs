import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(packageDir, "src");
const outputDir = join(packageDir, "dist");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await Promise.all([
	build({
		entryPoints: [join(sourceDir, "main.ts")],
		outfile: join(outputDir, "main.js"),
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node24",
		external: ["electron"],
		sourcemap: true,
	}),
	build({
		entryPoints: [join(sourceDir, "preload.ts")],
		outfile: join(outputDir, "preload.cjs"),
		bundle: true,
		platform: "node",
		format: "cjs",
		target: "node24",
		external: ["electron"],
		sourcemap: true,
	}),
	build({
		entryPoints: [join(sourceDir, "renderer.ts")],
		outfile: join(outputDir, "renderer.js"),
		bundle: true,
		platform: "browser",
		format: "iife",
		target: "chrome152",
		sourcemap: true,
	}),
	build({
		entryPoints: [join(sourceDir, "agent-host.ts")],
		outfile: join(outputDir, "agent-host.js"),
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node22",
		external: ["@earendil-works/pi-agent-core", "@earendil-works/pi-coding-agent"],
		sourcemap: true,
	}),
	cp(join(sourceDir, "index.html"), join(outputDir, "index.html")),
	cp(join(sourceDir, "styles.css"), join(outputDir, "styles.css")),
]);
