import { execFileSync, spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { gunzipSync } from "zlib";

export function packageBin(root, ...segments) {
  return resolve(root, "node_modules", ...segments);
}

export function runNode(root, args, label = `node ${args.join(" ")}`) {
  console.log(`\n> ${label}`);
  execFileSync(process.execPath, args, { cwd: root, stdio: "inherit" });
}

export function runNodeCli(root, name, cliPath, args = []) {
  assertCliExists(name, cliPath);
  console.log(`\n> ${name} ${args.join(" ")}`);
  execFileSync(process.execPath, [cliPath, ...args], { cwd: root, stdio: "inherit" });
}

export function spawnNodeCli(root, name, cliPath, args = [], env = {}) {
  assertCliExists(name, cliPath);
  console.log(`\n> ${name} ${args.join(" ")}`);
  return spawn(process.execPath, [cliPath, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
}

export function assertNode26() {
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] || "0", 10);
  if (nodeMajor !== 26) {
    throw new Error(
      `[Node] 当前项目只支持 Node.js 26.x。当前为 ${process.version}，请切换到 Node.js 26 后重新安装依赖。`,
    );
  }
}

export function assertPackagingEnvironment(root) {
  assertNode26();
  if (process.platform === "win32" && process.arch === "x64") {
    assertWindowsX64NativeDeps(root);
  }
}

export function extractTarGzEntry(archivePath, entrySuffix, destPath) {
  const archive = gunzipSync(readFileSync(archivePath));
  const wanted = normalizeTarPath(entrySuffix);
  let nextLongName = null;

  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    if (isZeroBlock(header)) break;

    const rawName = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const entryPath = normalizeTarPath(nextLongName || (prefix ? `${prefix}/${rawName}` : rawName));
    nextLongName = null;

    const sizeText = readTarString(header, 124, 12).trim();
    const size = Number.parseInt(sizeText || "0", 8);
    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`无法解析 tar 条目大小：${entryPath || "(unknown)"}`);
    }

    const typeFlag = header[156] === 0 ? "0" : String.fromCharCode(header[156]);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > archive.length) {
      throw new Error(`tar 归档已截断：${archivePath}`);
    }

    if (typeFlag === "L") {
      nextLongName = readTarString(archive, dataStart, size);
    } else if ((typeFlag === "0" || typeFlag === "") && matchesTarEntry(entryPath, wanted)) {
      mkdirSync(dirname(destPath), { recursive: true });
      writeFileSync(destPath, archive.subarray(dataStart, dataEnd));
      return entryPath;
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }

  throw new Error(`未在 ${archivePath} 中找到 ${entrySuffix}`);
}

function assertCliExists(name, cliPath) {
  if (!existsSync(cliPath)) {
    throw new Error(`未找到 ${name} CLI：${cliPath}。请先运行 npm install。`);
  }
}

function isZeroBlock(block) {
  return block.every((byte) => byte === 0);
}

function matchesTarEntry(entryPath, wanted) {
  return entryPath === wanted || entryPath.endsWith(`/${wanted}`);
}

function normalizeTarPath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\0+$/, "");
}

function readTarString(buffer, start, length) {
  const slice = buffer.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? length : end).toString("utf8");
}

function assertWindowsX64NativeDeps(root) {
  const required = [
    {
      name: "lightningcss-win32-x64-msvc",
      file: packageBin(root, "lightningcss-win32-x64-msvc", "lightningcss.win32-x64-msvc.node"),
    },
    {
      name: "@tailwindcss/oxide-win32-x64-msvc",
      file: packageBin(root, "@tailwindcss", "oxide-win32-x64-msvc", "tailwindcss-oxide.win32-x64-msvc.node"),
    },
  ];

  const missing = required.filter((item) => !existsSync(item.file));
  if (missing.length === 0) return;

  throw new Error([
    "[Package] Windows x64 原生 CSS 依赖缺失，Next/Tailwind 构建无法继续。",
    "",
    "缺失：",
    ...missing.map((item) => `- ${item.name}: ${item.file}`),
    "",
    "这通常是因为 node_modules 来自 Linux/WSL/共享目录，或 npm install 时跳过了 optional dependencies。",
    "请先确认正在使用 Node.js 26.x，然后在 Windows 本地盘符路径的项目根目录重新安装依赖：",
    "",
    "CMD:",
    "  node -v",
    "  rmdir /s /q node_modules",
    "  npm install --include=optional",
    "  npm run package",
    "",
    "PowerShell:",
    "  node -v",
    "  Remove-Item -Recurse -Force node_modules",
    "  npm install --include=optional",
    "  npm run package",
  ].join("\n"));
}
