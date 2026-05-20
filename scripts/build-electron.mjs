#!/usr/bin/env node

import { rmSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { build } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(ROOT, "dist-electron");

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const common = {
  platform: "node",
  target: "node20",
  format: "cjs",
  bundle: true,
  external: ["electron"],
  logLevel: "info",
};

await build({
  ...common,
  entryPoints: [resolve(ROOT, "electron/main.ts")],
  outfile: resolve(OUT_DIR, "main.js"),
});

await build({
  ...common,
  entryPoints: [resolve(ROOT, "electron/preload.ts")],
  outfile: resolve(OUT_DIR, "preload.js"),
});

console.log("Electron 主进程构建完成：dist-electron/");
