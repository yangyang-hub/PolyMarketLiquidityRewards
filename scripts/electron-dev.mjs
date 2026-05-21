#!/usr/bin/env node

import { spawn } from "child_process";
import { get } from "http";
import net from "net";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { packageBin, runNode, spawnNodeCli } from "./script-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function run(file, args, env = {}) {
  return spawn(file, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
    stdio: "inherit",
  });
}

function getFreePort() {
  return new Promise((resolveDone, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 3000;
      server.close(() => resolveDone(port));
    });
  });
}

function waitForHttp(url, timeoutMs = 45_000) {
  const startedAt = Date.now();
  return new Promise((resolveDone, reject) => {
    const poll = () => {
      const req = get(url, (res) => {
        res.resume();
        if ((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 500) {
          resolveDone();
          return;
        }
        retry();
      });
      req.on("error", retry);
      req.setTimeout(2_000, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error("开发后端启动超时"));
        return;
      }
      setTimeout(poll, 500);
    };

    poll();
  });
}

const port = await getFreePort();
const url = `http://127.0.0.1:${port}`;
const dataDir = resolve(ROOT, "data", "electron-dev");

runNode(ROOT, ["scripts/build-electron.mjs"], "node scripts/build-electron.mjs");

const server = run("npm", ["run", "dev"], {
  HOST: "127.0.0.1",
  PORT: String(port),
  APP_DATA_DIR: dataDir,
});

await waitForHttp(url);

const electron = spawnNodeCli(
  ROOT,
  "electron",
  packageBin(ROOT, "electron", "cli.js"),
  ["dist-electron/main.js"],
  {
    ELECTRON_DEV_SERVER_URL: url,
    APP_DATA_DIR: dataDir,
    APP_ROOT: ROOT,
  },
);

electron.on("exit", (code) => {
  server.kill();
  process.exit(code ?? 0);
});
