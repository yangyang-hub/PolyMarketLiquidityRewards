#!/usr/bin/env node

/**
 * Windows portable distribution packaging script.
 *
 * Usage: node scripts/package.mjs
 *
 * Flow:
 *   1. next build (standalone mode)
 *   2. esbuild compile server.ts → server.js
 *   3. Assemble dist/ directory
 *   4. Download Windows node.exe + better-sqlite3 native module
 *   5. Generate 启动.bat, 停止说明.txt, .env
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  createWriteStream,
} from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { get as httpsGet } from "https";
import {
  assertPackagingEnvironment,
  betterSqliteBuildReleasePath,
  extractTarGzEntry,
  hasBetterSqliteNative,
  packageBin,
  runNodeCli,
} from "./script-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST = resolve(ROOT, "dist");
const CACHE = resolve(ROOT, ".cache", "electron");

assertPackagingEnvironment(ROOT);

const NODE_VERSION = "v26.2.0";
const NODE_EXE_URL = `https://nodejs.org/dist/${NODE_VERSION}/win-x64/node.exe`;

const packageJson = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));
const betterSqliteVersion = (packageJson.dependencies["better-sqlite3"] || "12.10.0").replace(/^[^\d]*/, "");
const BETTER_SQLITE3_VERSION = `v${betterSqliteVersion}`;
const NODE_ABI = "v147"; // Node 26 ABI
const BETTER_SQLITE3_URL =
  `https://github.com/WiseLibs/better-sqlite3/releases/download/${BETTER_SQLITE3_VERSION}/` +
  `better-sqlite3-${BETTER_SQLITE3_VERSION}-node-${NODE_ABI}-win32-x64.tar.gz`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Download a file via HTTPS, following redirects. */
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const request = (url) => {
      httpsGet(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); // drain redirect response body
          request(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Download failed: ${res.statusCode} for ${url}`));
          return;
        }
        const file = createWriteStream(dest);
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let downloaded = 0;
        res.on("data", (chunk) => {
          downloaded += chunk.length;
          if (total > 0) {
            const pct = ((downloaded / total) * 100).toFixed(1);
            process.stdout.write(`\r  Downloading... ${pct}%`);
          }
        });
        res.pipe(file);
        file.on("finish", () => {
          console.log();
          file.close(resolve);
        });
        file.on("error", reject);
      }).on("error", reject);
    };
    request(url);
  });
}

async function ensureCachedDownload(url, cacheName) {
  mkdirSync(CACHE, { recursive: true });
  const cached = resolve(CACHE, cacheName);
  if (!existsSync(cached)) {
    console.log(`  Downloading ${cacheName}`);
    await download(url, cached);
  } else {
    console.log(`  Using cached ${cacheName}`);
  }
  return cached;
}

async function ensureBuildTimeBetterSqliteNative() {
  if (process.platform !== "win32" || process.arch !== "x64" || hasBetterSqliteNative(ROOT)) {
    return;
  }

  if (!existsSync(packageBin(ROOT, "better-sqlite3", "package.json"))) {
    throw new Error("better-sqlite3 is missing. Run npm install first.");
  }

  console.log("\n========== Step 0: Build-time better-sqlite3 ==========");
  const cacheName = `better-sqlite3-${BETTER_SQLITE3_VERSION}-node-${NODE_ABI}-win32-x64.tar.gz`;
  const cachedTar = await ensureCachedDownload(BETTER_SQLITE3_URL, cacheName);
  const nativeDest = betterSqliteBuildReleasePath(ROOT);
  const nativeEntry = extractTarGzEntry(cachedTar, "build/Release/better_sqlite3.node", nativeDest);
  console.log(`  Installed ${nativeEntry} -> ${nativeDest}`);
}

// ---------------------------------------------------------------------------
// Step 1: Next.js build
// ---------------------------------------------------------------------------

await ensureBuildTimeBetterSqliteNative();

console.log("\n========== Step 1: Next.js build ==========");
runNodeCli(ROOT, "next", packageBin(ROOT, "next", "dist", "bin", "next"), ["build"]);

// ---------------------------------------------------------------------------
// Step 2: esbuild compile server.ts → server.js
// ---------------------------------------------------------------------------

console.log("\n========== Step 2: esbuild compile server.ts ==========");

// Read the nextConfig that Next.js generated during build.
// Setting __NEXT_PRIVATE_STANDALONE_CONFIG before require('next') tells Next.js
// to use this pre-built config instead of loading it from disk (which needs webpack).
const requiredServerFiles = JSON.parse(
  readFileSync(resolve(ROOT, ".next/required-server-files.json"), "utf-8"),
);
const nextConfigJson = JSON.stringify(JSON.stringify(requiredServerFiles.config));

const { build } = await import("esbuild");

await build({
  entryPoints: [resolve(ROOT, "server.ts")],
  bundle: true,
  platform: "node",
  target: "node26",
  format: "cjs",
  outfile: resolve(ROOT, "dist-server.js"),
  banner: {
    js: [
      `process.chdir(__dirname);`,
      `process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = ${nextConfigJson};`,
    ].join("\n"),
  },
  external: [
    // Only packages that exist in standalone node_modules (native modules + framework)
    "next",
    "react",
    "react-dom",
    "better-sqlite3",
    "bindings",
    "file-uri-to-path",
    // Everything else (ws, ethers, decimal.js, @polymarket/*, zustand, etc.)
    // is bundled into server.js by esbuild
  ],
  alias: { "@": resolve(ROOT, "src") },
  logLevel: "info",
});

// ---------------------------------------------------------------------------
// Step 3: Assemble dist/
// ---------------------------------------------------------------------------

console.log("\n========== Step 3: Assemble dist/ ==========");

// Clean previous build
if (existsSync(DIST)) {
  rmSync(DIST, { recursive: true });
}

// 3a. Copy standalone output as the base
const standaloneDir = resolve(ROOT, ".next/standalone");
if (!existsSync(standaloneDir)) {
  console.error("ERROR: .next/standalone not found. Is output: 'standalone' set in next.config.ts?");
  process.exit(1);
}
console.log("  Copying .next/standalone/ → dist/");
cpSync(standaloneDir, DIST, { recursive: true });

// 3b. Copy static assets
const staticSrc = resolve(ROOT, ".next/static");
const staticDest = resolve(DIST, ".next/static");
if (existsSync(staticSrc)) {
  console.log("  Copying .next/static/ → dist/.next/static/");
  cpSync(staticSrc, staticDest, { recursive: true });
}

// 3c. Copy public/
const publicSrc = resolve(ROOT, "public");
const publicDest = resolve(DIST, "public");
if (existsSync(publicSrc)) {
  console.log("  Copying public/ → dist/public/");
  cpSync(publicSrc, publicDest, { recursive: true });
}

// 3d. Place compiled server.js
console.log("  Placing compiled server.js");
cpSync(resolve(ROOT, "dist-server.js"), resolve(DIST, "server.js"));
rmSync(resolve(ROOT, "dist-server.js"));

// ---------------------------------------------------------------------------
// Step 4: Download Windows resources
// ---------------------------------------------------------------------------

console.log("\n========== Step 4: Download Windows resources ==========");

// 4a. node.exe
const nodeExeDest = resolve(DIST, "node.exe");
console.log(`  Downloading node.exe (${NODE_VERSION})...`);
await download(NODE_EXE_URL, nodeExeDest);

// 4b. better-sqlite3 prebuilt native module
console.log(`  Downloading better-sqlite3 prebuilt (${BETTER_SQLITE3_VERSION})...`);
const tarDest = resolve(DIST, "better-sqlite3-prebuilt.tar.gz");
await download(BETTER_SQLITE3_URL, tarDest);

// Extract the .node file from the tarball
// The tarball contains: build/Release/better_sqlite3.node
function findBetterSqlite3Dir(base) {
  const direct = resolve(base, "node_modules/better-sqlite3/build/Release");
  if (existsSync(resolve(base, "node_modules/better-sqlite3"))) {
    return direct;
  }
  return null;
}

const targetReleaseDir = findBetterSqlite3Dir(DIST);
const finalReleaseDir = targetReleaseDir || resolve(DIST, "node_modules/better-sqlite3/build/Release");
if (!targetReleaseDir) {
  console.warn("  WARNING: Could not find better-sqlite3 in node_modules, placing at default path");
}
mkdirSync(finalReleaseDir, { recursive: true });
const nativeModuleDest = resolve(finalReleaseDir, "better_sqlite3.node");
const nativeEntry = extractTarGzEntry(tarDest, "build/Release/better_sqlite3.node", nativeModuleDest);
console.log(`  Placed ${nativeEntry} → ${nativeModuleDest}`);

// Cleanup temp files
rmSync(tarDest);

// ---------------------------------------------------------------------------
// Step 5: Generate startup files
// ---------------------------------------------------------------------------

console.log("\n========== Step 5: Generate startup files ==========");

// 5a. 启动.bat
const batContent = `@echo off\r
chcp 65001 >nul\r
cd /d "%~dp0"\r
title PolyMarket 流动性挖矿\r
echo.\r
echo   PolyMarket 流动性挖矿系统\r
echo   ========================\r
echo   启动中，请稍候...\r
echo.\r
set NODE_ENV=production\r
start "" "http://localhost:3000"\r
"%~dp0node.exe" server.js\r
echo.\r
echo   程序已停止。按任意键关闭窗口...\r
pause >nul\r
`;
writeFileSync(resolve(DIST, "启动.bat"), batContent);
console.log("  Generated 启动.bat");

// 5b. 停止说明.txt
const stopContent = `如何停止程序\r
============\r
\r
直接关闭控制台窗口（黑色命令行窗口）即可停止程序。\r
\r
或者在控制台窗口中按 Ctrl+C 停止。\r
`;
writeFileSync(resolve(DIST, "停止说明.txt"), stopContent);
console.log("  Generated 停止说明.txt");

// 5c. .env
const envContent = readFileSync(resolve(ROOT, ".env.example"), "utf-8");
writeFileSync(resolve(DIST, ".env"), envContent, "utf-8");
console.log("  Generated .env (from .env.example)");

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

console.log("\n========================================");
console.log("  Packaging complete!");
console.log(`  Output: ${DIST}`);
console.log("");
console.log("  To distribute:");
console.log("  1. Compress dist/ into a zip file");
console.log("  2. Send to users");
console.log("  3. Users unzip → double-click 启动.bat");
console.log("========================================\n");
