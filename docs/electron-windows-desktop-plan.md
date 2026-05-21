# Electron Windows 桌面端打包方案

本文档描述当前项目的 Windows 桌面端实现方式、进程结构、前端设计边界和打包脚本。目标是让用户双击桌面图标即可启动完整应用，不再使用会弹出控制台窗口的批处理入口。

## 目标

- 使用 Electron 提供 Windows 桌面应用外壳。
- 将 Next.js 前端、接口路由、自定义 WebSocket、订单簿监控引擎一起打进安装包。
- 启动时不出现命令行窗口。
- 本地数据库和加密密钥放在用户数据目录，升级应用不覆盖交易数据。
- 保留当前信息架构：仪表盘、账户、撤单设置、订单簿、事件日志。

## 架构

当前采用“Electron 主进程 + 隐藏内置 Node 后端”的方案。

```text
PolyMarket 风控桌面端.exe
├─ Electron 主进程
│  ├─ 单实例锁
│  ├─ 创建主窗口和托盘
│  ├─ 分配本地端口
│  ├─ 隐藏启动 resources/server/node.exe
│  ├─ 设置 APP_DATA_DIR、PORT、HOST
│  └─ 打开 http://127.0.0.1:{port}
├─ 隐藏 Node 后端进程
│  ├─ Next.js standalone server
│  ├─ API Route
│  ├─ /ws WebSocket
│  ├─ 订单簿监控引擎
│  └─ 本地数据库
└─ Electron 渲染进程
   └─ 当前 Next.js React 页面
```

这样做的原因：

- Electron 打包后的 GUI 程序不会天然弹出命令行窗口。
- 后端通过 `spawn(node.exe, ["server.js"], { windowsHide: true, shell: false })` 隐藏启动，不经过 `.bat`、`.cmd` 或 PowerShell。
- 打包脚本从 `public/logo.png` 生成 `.cache/electron/logo.ico`，供安装包、卸载程序、桌面快捷方式和开始菜单快捷方式使用。
- 打包后的 Electron 托盘优先读取外部 `resources/logo.ico`；不要只依赖 app 包内的 `public/logo.png`。
- `better-sqlite3` 继续运行在内置 Node 26 环境，避免 Electron 主进程原生模块 ABI 不匹配；当前项目不再兼容低版本 Node。
- 页面顶部不绘制模拟窗口控制按钮，最小化、最大化和关闭由系统原生标题栏提供。
- 桌面端和内置后端统一使用 `Asia/Shanghai` 时区，文件日志和前端事件时间按上海时间展示。
- 服务端资源必须保留 Next standalone 依赖；打包脚本会把 `node_modules` 改名为 `server-vendor`，Electron 启动后端时通过 `NODE_PATH` 指向它，避免 Electron Builder 过滤 `node_modules` 后导致 `server.js` 无法 `require("next")`。
- 组装服务端资源时会剔除被 Next 追踪进 standalone 的本地 `data/`、`release/`、`dist*` 和 `.cache` 目录，避免发布本地数据库、密钥或旧构建产物。
- 打包脚本会在 `next build` 前为根目录 `node_modules/better-sqlite3` 准备 Node 26 Windows 预编译模块，避免构建期 API 路由导入数据库时触发 node-gyp。
- Electron Builder 关闭 `npmRebuild`，避免为根项目依赖触发 node-gyp/Python；Windows 后端原生模块由打包脚本下载并放入 `dist-server`。
- Electron Builder 通过 `win.signAndEditExecutable: false` 关闭 Windows exe 资源编辑，并通过 `win.signExts: ["!.exe"]` 跳过本地 `.exe` 签名，避免未开启符号链接权限时解压 `winCodeSign.7z` 失败。
- 后端崩溃日志写入本地日志目录，用户不用面对控制台。

## 项目结构

```text
electron/
├─ main.ts                  # Electron 主进程
└─ preload.ts               # 渲染进程白名单桌面能力

src/server/
└─ start-server.ts          # 可复用的 Next/HTTP/WebSocket 启动函数

scripts/
├─ build-electron.mjs       # 编译 Electron main/preload
├─ prepare-electron-resources.mjs
│                            # 构建 Next standalone 后端资源
├─ package-electron.mjs     # 组合准备步骤并调用 electron-builder
└─ electron-dev.mjs         # 桌面端开发启动
```

`server.ts` 现在只是普通 Web/开发模式入口，内部调用 `startServer()`；Electron 打包资源也复用同一套后端启动逻辑。

## 数据和日志目录

桌面端运行时由 Electron 设置：

```text
APP_DATA_DIR = app.getPath("userData")
```

Windows 默认位置类似：

```text
%APPDATA%/PolyMarket 风控桌面端/
├─ app.db
├─ .encryption-key
└─ logs/
   ├─ electron-main.log
   ├─ backend.log
   └─ backend-error.log
```

这可以避免把数据库写到安装目录，也避免应用升级时覆盖本地私钥和账户配置。

## 打包输出

`npm run desktop:dist` 会生成：

```text
release/
└─ PolyMarket 风控桌面端-Setup-0.1.0.exe
```

安装后的目录结构核心部分：

```text
安装目录/
├─ PolyMarket 风控桌面端.exe
└─ resources/
   ├─ app.asar
   └─ server/
      ├─ node.exe
      ├─ server.js
      ├─ .next/
      ├─ public/
      └─ node_modules/
         └─ better-sqlite3/build/Release/better_sqlite3.node
```

## 打包脚本

已加入以下脚本：

```json
{
  "desktop:dev": "node scripts/electron-dev.mjs",
  "desktop:build-main": "node scripts/build-electron.mjs",
  "desktop:prepare": "node scripts/prepare-electron-resources.mjs",
  "desktop:pack": "node scripts/package-electron.mjs --win --dir",
  "desktop:dist": "node scripts/package-electron.mjs --win nsis",
  "desktop:dist:portable": "node scripts/package-electron.mjs --win portable",
  "package": "npm run desktop:dist"
}
```

常用命令：

```bash
# 桌面端开发模式
npm run desktop:dev

# 只编译 Electron 主进程和 preload
npm run desktop:build-main

# 只准备内置后端资源
npm run desktop:prepare

# 生成 Windows 解包目录，适合快速检查
npm run desktop:pack

# 生成 Windows 安装包
npm run desktop:dist

# 生成 Windows 便携包
npm run desktop:dist:portable
```

`desktop:dist` 会依次执行：

1. 从 `public/logo.png` 生成 `.cache/electron/logo.ico`
2. `next build`
3. 复制 `.next/standalone`、`.next/static`、`public`
4. 用 esbuild 编译 `server.ts` 为 `dist-server/server.js`
5. 下载 Windows `node.exe`
6. 下载 Windows 版 `better_sqlite3.node`
7. 编译 Electron 主进程和 preload
8. 调用 `electron-builder --win nsis`

## 无控制台窗口策略

生产环境不会再使用 `启动.bat`。后端启动由 Electron 主进程完成：

```ts
spawn(nodePath, [serverEntry], {
  cwd: serverDir,
  env: {
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    APP_DATA_DIR: dataDir,
  },
  shell: false,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
```

后端 HTTP 服务应先完成监听，随后后台恢复上次启用的账户。账户自动启动中的网络请求不能阻塞 Electron 的本地健康检查。

日志会写入：

- `backend.log`
- `backend-error.log`
- `electron-main.log`

日志时间使用 `YYYY-MM-DD HH:mm:ss.SSS +08:00` 格式。

如果后端在就绪前退出或启动超时，主窗口会显示日志目录，并附带 `backend-error.log` / `backend.log` 尾部内容。

## 前端设计边界

桌面端前端仍复用当前 Next.js 页面。前端可以通过 preload 暴露的 `window.desktopApp` 读取桌面运行信息：

```text
window.desktopApp.getRuntimeInfo()
window.desktopApp.openDataDir()
window.desktopApp.openLogDir()
```

建议前端增加这些桌面端入口：

- 顶栏或设置页显示数据目录入口。
- 后端启动失败时显示“打开日志目录”。
- 退出确认页保持“最小化到托盘 / 停止账户并退出 / 直接退出”三种动作。
- 风险确认页说明自动恢复账户会影响真实订单。

## 验收标准

- 双击桌面图标启动，不出现命令行窗口。
- 主窗口加载当前中文前端页面。
- 后端接口和 `/ws` 正常工作。
- 数据写入用户数据目录，而不是安装目录。
- 关闭窗口默认可最小化到托盘。
- 退出应用后隐藏后端进程被停止。
- `better-sqlite3` 在打包后的 Windows 环境能正常加载。

## 注意事项

- 在 Linux/macOS 上交叉生成 Windows 安装包可能需要 Wine；如果环境缺失，可在 Windows 机器执行 `npm run desktop:dist`。
- 当前 `public/logo.png` 用作窗口和托盘图标，并在打包时自动生成 Windows `.ico` 给安装包和快捷方式使用。
- `package:legacy` 保留旧的便携脚本，但正式桌面版应使用 `desktop:dist`。
