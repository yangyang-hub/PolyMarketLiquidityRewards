import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell } from "electron";
import { spawn, type ChildProcess } from "child_process";
import { createWriteStream, existsSync, mkdirSync } from "fs";
import { get, request } from "http";
import net from "net";
import path from "path";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverProcess: ChildProcess | null = null;
let serverUrl = "";
let isQuitting = false;
let logDir = "";
let dataDir = "";

function getAssetPath(...segments: string[]): string {
  const appRoot = process.env.APP_ROOT || app.getAppPath();
  return app.isPackaged
    ? path.join(process.resourcesPath, ...segments)
    : path.join(appRoot, ...segments);
}

function getServerDir(): string {
  const appRoot = process.env.APP_ROOT || app.getAppPath();
  return app.isPackaged
    ? path.join(process.resourcesPath, "server")
    : path.join(appRoot, "dist-server");
}

function getNodePath(serverDir: string): string {
  if (process.platform === "win32") {
    return path.join(serverDir, "node.exe");
  }
  return process.execPath;
}

function setupRuntimeDirs() {
  dataDir = app.getPath("userData");
  logDir = path.join(dataDir, "logs");
  mkdirSync(logDir, { recursive: true });
}

function patchConsoleToFile() {
  const logFile = createWriteStream(path.join(logDir, "electron-main.log"), { flags: "a" });
  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  const write = (level: string, args: unknown[]) => {
    const line = `[${new Date().toISOString()}] [${level}] ${args.map(String).join(" ")}\n`;
    logFile.write(line);
  };

  console.log = (...args: unknown[]) => {
    write("信息", args);
    originalLog(...args);
  };
  console.warn = (...args: unknown[]) => {
    write("警告", args);
    originalWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    write("错误", args);
    originalError(...args);
  };
}

function loadingHtml(message: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <style>
          body { margin: 0; height: 100vh; display: grid; place-items: center; background: #0d111a; color: #d7def2; font-family: "Microsoft YaHei", Arial, sans-serif; }
          section { width: 520px; border: 1px solid #293246; background: #151b28; padding: 32px; }
          h1 { margin: 0 0 14px; font-size: 24px; }
          p { margin: 0; color: #8f9ab4; line-height: 1.7; }
        </style>
      </head>
      <body>
        <section>
          <h1>流动性风控终端</h1>
          <p>${message}</p>
        </section>
      </body>
    </html>
  `)}`;
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

function waitForHttp(url: string, timeoutMs = 45_000): Promise<void> {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const poll = () => {
      const req = get(url, (res) => {
        res.resume();
        if ((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 500) {
          resolve();
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
        reject(new Error("本地后端启动超时"));
        return;
      }
      setTimeout(poll, 500);
    };

    poll();
  });
}

function postLocal(pathname: string, timeoutMs = 10_000): Promise<void> {
  if (!serverUrl) return Promise.resolve();

  const target = new URL(pathname, serverUrl);

  return new Promise((resolve, reject) => {
    const req = request(target, { method: "POST" }, (res) => {
      res.resume();
      if ((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300) {
        resolve();
        return;
      }
      reject(new Error(`本地接口返回状态码 ${res.statusCode || "未知"}`));
    });

    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("本地接口请求超时"));
    });
    req.end();
  });
}

async function stopAccountsBeforeQuit(): Promise<void> {
  await postLocal("/api/batch/stop-all");
}

async function stopAccountsAndQuit(): Promise<void> {
  mainWindow?.loadURL(loadingHtml("正在停止账户并退出...")).catch(() => {});

  try {
    await stopAccountsBeforeQuit();
    isQuitting = true;
    app.quit();
  } catch (e: unknown) {
    const options: Electron.MessageBoxOptions = {
      type: "error",
      title: "停止账户失败",
      message: "退出前停止账户失败。",
      detail: e instanceof Error ? e.message : String(e),
      buttons: ["返回应用", "仍然退出"],
      defaultId: 0,
      cancelId: 0,
    };
    const result = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);

    if (result.response === 1) {
      isQuitting = true;
      app.quit();
      return;
    }

    mainWindow?.show();
  }
}

async function startBackend(): Promise<string> {
  if (process.env.ELECTRON_DEV_SERVER_URL) {
    serverUrl = process.env.ELECTRON_DEV_SERVER_URL;
    await waitForHttp(serverUrl);
    return serverUrl;
  }

  const serverDir = getServerDir();
  const serverEntry = path.join(serverDir, "server.js");
  const nodePath = getNodePath(serverDir);

  if (!existsSync(serverEntry)) {
    throw new Error(`未找到后端入口：${serverEntry}`);
  }
  if (process.platform === "win32" && !existsSync(nodePath)) {
    throw new Error(`未找到内置运行时：${nodePath}`);
  }

  const port = await getFreePort();
  serverUrl = `http://127.0.0.1:${port}`;

  const stdout = createWriteStream(path.join(logDir, "backend.log"), { flags: "a" });
  const stderr = createWriteStream(path.join(logDir, "backend-error.log"), { flags: "a" });

  serverProcess = spawn(nodePath, [serverEntry], {
    cwd: serverDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(port),
      APP_DATA_DIR: dataDir,
    },
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout?.pipe(stdout);
  serverProcess.stderr?.pipe(stderr);

  serverProcess.on("exit", (code) => {
    console.warn(`后端进程已退出，代码：${code ?? "未知"}`);
  });

  await waitForHttp(serverUrl);
  return serverUrl;
}

function createWindow() {
  const icon = getAssetPath("public", "logo.png");
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 700,
    title: "流动性风控终端",
    show: false,
    icon: existsSync(icon) ? icon : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.loadURL(loadingHtml("正在启动本地服务，请稍候..."));

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("close", async (event) => {
    if (isQuitting) return;
    event.preventDefault();
    const result = await dialog.showMessageBox(mainWindow!, {
      type: "question",
      title: "退出确认",
      message: "是否退出流动性风控终端？",
      detail: "最小化到托盘会保持本地后端继续运行。直接退出会停止内置后端进程。",
      buttons: ["最小化到托盘", "停止并退出", "取消"],
      defaultId: 0,
      cancelId: 2,
    });

    if (result.response === 0) {
      mainWindow?.hide();
      return;
    }
    if (result.response === 1) {
      void stopAccountsAndQuit();
    }
  });
}

function createTray() {
  const icon = getAssetPath("public", "logo.png");
  if (!existsSync(icon)) return;

  tray = new Tray(icon);
  tray.setToolTip("流动性风控终端");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "显示主窗口", click: () => mainWindow?.show() },
    { type: "separator" },
    { label: "打开数据目录", click: () => shell.openPath(dataDir) },
    { label: "打开日志目录", click: () => shell.openPath(logDir) },
    { type: "separator" },
    {
      label: "停止账户并退出",
      click: () => {
        void stopAccountsAndQuit();
      },
    },
  ]));

  tray.on("double-click", () => mainWindow?.show());
}

async function bootstrap() {
  setupRuntimeDirs();
  patchConsoleToFile();
  createWindow();
  createTray();

  try {
    const url = await startBackend();
    await mainWindow?.loadURL(url);
  } catch (e) {
    const message = e instanceof Error ? e.message : "本地后端启动失败";
    console.error(message);
    await mainWindow?.loadURL(loadingHtml(`${message}。请从托盘菜单打开日志目录排查。`));
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(bootstrap);
}

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
});

ipcMain.handle("desktop:get-runtime-info", () => ({
  version: app.getVersion(),
  dataDir,
  logDir,
  serverUrl,
  packaged: app.isPackaged,
}));

ipcMain.handle("desktop:open-data-dir", () => shell.openPath(dataDir));
ipcMain.handle("desktop:open-log-dir", () => shell.openPath(logDir));
