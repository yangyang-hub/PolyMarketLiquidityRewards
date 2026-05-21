#!/usr/bin/env node

import { execFileSync } from "child_process";
import { createRequire } from "module";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { assertNode26 } from "./script-utils.mjs";

const require = createRequire(import.meta.url);
const { appBuilderPath } = require("app-builder-bin");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SOURCE_ICON = resolve(ROOT, "public", "logo.png");
const CACHE = resolve(ROOT, ".cache", "electron");
const GENERATED_ICON = resolve(CACHE, "icon.ico");
const DESKTOP_ICON = resolve(CACHE, "logo.ico");

assertNode26();

if (!existsSync(SOURCE_ICON)) {
  throw new Error("未找到 public/logo.png，无法生成 Electron 桌面图标。");
}

mkdirSync(CACHE, { recursive: true });
rmSync(GENERATED_ICON, { force: true });
rmSync(DESKTOP_ICON, { force: true });

execFileSync(
  appBuilderPath,
  [
    "icon",
    "--format=ico",
    "--root",
    ROOT,
    "--input",
    "public/logo.png",
    "--out",
    CACHE,
  ],
  { cwd: ROOT, stdio: "ignore" },
);

if (!existsSync(GENERATED_ICON)) {
  throw new Error("Electron 图标生成失败：未产出 .cache/electron/icon.ico。");
}

copyFileSync(GENERATED_ICON, DESKTOP_ICON);
console.log("Electron 桌面图标准备完成：.cache/electron/logo.ico");
