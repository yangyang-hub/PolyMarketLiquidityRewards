#!/usr/bin/env node

import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { packageBin, runNode, runNodeCli } from "./script-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const args = process.argv.slice(2);
const skipBuilder = args.includes("--skip-builder");
const prepareArgs = args.filter((arg) => arg === "--skip-downloads" || arg === "--skip-next-build");
const builderArgs = args.filter((arg) =>
  arg !== "--skip-builder" &&
  arg !== "--skip-downloads" &&
  arg !== "--skip-next-build"
);
const finalBuilderArgs = builderArgs.length > 0 ? builderArgs : ["--win", "nsis"];

runNode(
  ROOT,
  ["scripts/prepare-electron-resources.mjs", ...prepareArgs],
  `node scripts/prepare-electron-resources.mjs ${prepareArgs.join(" ")}`.trim(),
);
runNode(ROOT, ["scripts/build-electron.mjs"], "node scripts/build-electron.mjs");

if (skipBuilder) {
  console.log("\n已跳过 electron-builder。");
} else {
  runNodeCli(
    ROOT,
    "electron-builder",
    packageBin(ROOT, "electron-builder", "cli.js"),
    finalBuilderArgs,
  );
}
