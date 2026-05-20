#!/usr/bin/env node

import { execFileSync } from "child_process";
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "fs";
import { get as httpsGet } from "https";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { build } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST = resolve(ROOT, "dist-server");
const CACHE = resolve(ROOT, ".cache", "electron");

const args = new Set(process.argv.slice(2));
const skipNextBuild = args.has("--skip-next-build");
const skipDownloads = args.has("--skip-downloads");

const NODE_VERSION = "v20.18.0";
const NODE_EXE_URL = `https://nodejs.org/dist/${NODE_VERSION}/win-x64/node.exe`;

const packageJson = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));
const betterSqliteVersion = (packageJson.dependencies["better-sqlite3"] || "12.6.2").replace(/^[^\d]*/, "");
const BETTER_SQLITE3_VERSION = `v${betterSqliteVersion}`;
const NODE_ABI = "v115";
const BETTER_SQLITE3_URL =
  `https://github.com/WiseLibs/better-sqlite3/releases/download/${BETTER_SQLITE3_VERSION}/` +
  `better-sqlite3-${BETTER_SQLITE3_VERSION}-node-${NODE_ABI}-win32-x64.tar.gz`;

function run(file, args) {
  console.log(`\n> ${file} ${args.join(" ")}`);
  execFileSync(file, args, { cwd: ROOT, stdio: "inherit" });
}

function download(url, dest) {
  return new Promise((resolveDone, reject) => {
    const request = (target) => {
      httpsGet(target, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          request(res.headers.location);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`下载失败：${res.statusCode} ${target}`));
          return;
        }

        const file = createWriteStream(dest);
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let downloaded = 0;
        res.on("data", (chunk) => {
          downloaded += chunk.length;
          if (total > 0) {
            const pct = ((downloaded / total) * 100).toFixed(1);
            process.stdout.write(`\r  下载中... ${pct}%`);
          }
        });
        res.pipe(file);
        file.on("finish", () => {
          console.log();
          file.close(resolveDone);
        });
        file.on("error", reject);
      }).on("error", reject);
    };

    request(url);
  });
}

async function cachedDownload(url, cacheName, dest) {
  mkdirSync(CACHE, { recursive: true });
  const cached = resolve(CACHE, cacheName);
  if (!existsSync(cached)) {
    console.log(`  下载 ${cacheName}`);
    await download(url, cached);
  } else {
    console.log(`  使用缓存 ${cacheName}`);
  }
  cpSync(cached, dest);
}

console.log("\n========== 1. 构建 Next.js ==========");
if (!skipNextBuild) {
  run("npx", ["next", "build"]);
} else {
  console.log("  已跳过 Next.js 构建");
}

console.log("\n========== 2. 生成后端资源 ==========");
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const standaloneDir = resolve(ROOT, ".next", "standalone");
if (!existsSync(standaloneDir)) {
  throw new Error("未找到 .next/standalone，请确认 next.config.ts 已设置 output: 'standalone'");
}

cpSync(standaloneDir, DIST, { recursive: true });

const staticSrc = resolve(ROOT, ".next", "static");
const staticDest = resolve(DIST, ".next", "static");
if (existsSync(staticSrc)) {
  cpSync(staticSrc, staticDest, { recursive: true });
}

const publicSrc = resolve(ROOT, "public");
const publicDest = resolve(DIST, "public");
if (existsSync(publicSrc)) {
  cpSync(publicSrc, publicDest, { recursive: true });
}

const requiredServerFiles = JSON.parse(
  readFileSync(resolve(ROOT, ".next", "required-server-files.json"), "utf-8"),
);
const nextConfigJson = JSON.stringify(JSON.stringify(requiredServerFiles.config));

await build({
  entryPoints: [resolve(ROOT, "server.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: resolve(DIST, "server.js"),
  banner: {
    js: [
      "process.chdir(__dirname);",
      `process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = ${nextConfigJson};`,
    ].join("\n"),
  },
  external: [
    "next",
    "react",
    "react-dom",
    "better-sqlite3",
    "bindings",
    "file-uri-to-path",
  ],
  logLevel: "info",
});

console.log("\n========== 3. 准备 Windows 运行时 ==========");
if (skipDownloads) {
  console.log("  已跳过 Windows node.exe 和 better-sqlite3 原生模块下载");
} else {
  await cachedDownload(NODE_EXE_URL, `node-${NODE_VERSION}-win-x64.exe`, resolve(DIST, "node.exe"));

  const tarDest = resolve(DIST, "better-sqlite3-win32-x64.tar.gz");
  await cachedDownload(BETTER_SQLITE3_URL, `better-sqlite3-${BETTER_SQLITE3_VERSION}-node-${NODE_ABI}-win32-x64.tar.gz`, tarDest);

  const extractDir = resolve(DIST, "_better_sqlite3");
  mkdirSync(extractDir, { recursive: true });
  execFileSync("tar", ["xzf", tarDest, "-C", extractDir], { stdio: "inherit" });

  const nativeSrc = resolve(extractDir, "build", "Release", "better_sqlite3.node");
  const nativeDestDir = resolve(DIST, "node_modules", "better-sqlite3", "build", "Release");
  mkdirSync(nativeDestDir, { recursive: true });
  cpSync(nativeSrc, resolve(nativeDestDir, "better_sqlite3.node"));

  rmSync(tarDest, { force: true });
  rmSync(extractDir, { recursive: true, force: true });
}

console.log("\n后端资源准备完成：dist-server/");
