# Electron Windows 桌面端方案

本文档用于把当前 Next.js + Node 后端项目改造成 Windows 桌面端，并为前端设计提供页面、状态和交互边界。

## 目标

- 使用 Electron 提供 Windows 桌面应用外壳。
- 将 Next.js 前端、API Route、自定义 WebSocket、Polymarket CLOB 监控引擎一起打包进安装包。
- 用户双击桌面图标启动，不出现 cmd/PowerShell 窗口。
- 保留当前 Web UI 的主要信息架构：仪表盘、账户、撤单设置、订单簿、事件日志。
- 本地数据仍保存在用户机器上，私钥继续加密存储。

## 推荐架构

推荐采用“Electron 主进程内启动内置 Next Server”的方案。

```text
PolyMarket Desktop.exe
├─ Electron main process
│  ├─ 启动本地 Next/Node HTTP server
│  ├─ 启动 /ws 浏览器 WebSocket
│  ├─ 初始化 engineManager
│  ├─ 管理窗口、托盘、退出确认和日志
│  └─ 打开 BrowserWindow → http://127.0.0.1:{port}
└─ Electron renderer
   └─ 当前 Next.js React UI
```

不推荐继续使用 `启动.bat + node.exe server.js` 作为桌面端入口。bat 会天然暴露控制台窗口，也不利于托盘、单实例、自动更新和崩溃恢复。

## 为什么这样做

- Electron 本身是 GUI 应用，打包后的 `.exe` 正常启动不会弹出命令行窗口。
- Next.js 后端跑在 Electron 主进程内，避免额外 node 子进程和窗口闪烁。
- 如果未来必须拆成子进程，也应使用 Node `spawn/execFile` 的 `windowsHide: true`，并且不要通过 `.bat` 启动。
- BrowserWindow 使用 `nodeIntegration: false`、`contextIsolation: true`、preload 白名单 API，降低渲染进程风险。

参考：

- Electron BrowserWindow: https://www.electronjs.org/docs/api/browser-window
- Electron Security: https://www.electronjs.org/docs/latest/tutorial/security
- Electron single instance lock: https://www.electronjs.org/docs/latest/api/app
- Node child_process `windowsHide`: https://nodejs.org/api/child_process.html

## 当前项目需要的结构调整

### 1. 抽离 server 启动函数

当前 [server.ts](../server.ts) 是 CLI 入口，导入后会直接启动服务。Electron 需要一个可控的函数：

```text
src/server/start-server.ts
server.ts
electron/main.ts
```

建议拆分：

- `src/server/start-server.ts`
  - 导出 `startServer(options)`。
  - 创建 Next app、HTTP server、`/ws` WebSocket。
  - 初始化 `engineManager`。
  - 返回 `{ server, port, url, close }`。
- `server.ts`
  - 仅用于开发/原有 Web 启动。
  - 调用 `startServer({ host: "0.0.0.0", port: getPort() })`。
- `electron/main.ts`
  - 调用 `startServer({ host: "127.0.0.1", port: 0 })`。
  - 获取真实端口后 `mainWindow.loadURL(url)`。

`port: 0` 可以让系统分配空闲端口，避免 3000 被占用。当前前端 WebSocket 使用 `window.location.host` 拼 `/ws`，所以动态端口不影响前端。

### 2. 生产构建输出

保留 Next standalone 思路，但 Electron 打包时不再下载 Windows `node.exe`，而是把 server bundle 放进 Electron resources：

```text
release/
└─ win-unpacked/
   ├─ PolyMarket Desktop.exe
   └─ resources/
      ├─ app.asar
      ├─ server/
      │  ├─ server.js
      │  ├─ .next/
      │  └─ public/
      └─ native/
         └─ better_sqlite3.node
```

注意：`better-sqlite3` 是 native module，不能只塞进 asar 后就完事。需要配置 `asarUnpack` 或把 native module 放在 unpacked resources 下。

### 3. 数据目录

当前数据库路径基于 `process.cwd()/data/app.db`。桌面端应改为 Electron 用户数据目录：

```text
%APPDATA%/PolyMarketLiquidityRewards/
├─ app.db
├─ .encryption-key
├─ logs/
└─ config.json
```

建议新增环境变量：

- `APP_DATA_DIR`
  - Web/开发模式默认 `process.cwd()/data`
  - Electron 模式由 main process 设置为 `app.getPath("userData")`

这样可避免安装目录只读、升级覆盖数据、不同工作目录导致私钥找不到等问题。

### 4. CLOB 引擎启动安全

当前 `engineManager.initialize()` 会自动恢复数据库中 enabled 的账户。桌面端第一次启动建议增加一个“交易引擎确认”门槛：

- 首次启动只打开 UI，不自动启动账户。
- 用户在欢迎/风险确认页点击“启用自动恢复”后，后续才允许自动恢复。
- 如果应用异常退出，下次启动显示“上次可能未正常退出”的状态提示。

这个逻辑不影响 Web 版本，但对桌面用户更安全。

## Electron 进程设计

### Main Process

职责：

- 单实例锁：防止重复启动两个交易引擎。
- 启动/关闭内置 Next server。
- 创建主窗口。
- 控制托盘、最小化到托盘、退出确认。
- 写本地日志。
- 设置 `APP_DATA_DIR`、`NODE_ENV=production`、`PORT`。
- 捕获 `uncaughtException` / `unhandledRejection` 并落盘。

主窗口建议：

```ts
new BrowserWindow({
  width: 1280,
  height: 820,
  minWidth: 1100,
  minHeight: 700,
  title: "PolyMarket 风控桌面端",
  show: false,
  webPreferences: {
    preload: path.join(__dirname, "preload.js"),
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
  },
});
```

### Preload

只暴露桌面能力，不暴露 Node：

```text
window.desktopApp
├─ getVersion()
├─ openLogsFolder()
├─ getRuntimeStatus()
├─ onServerStatus(callback)
└─ restartBackend()
```

当前 Web UI 绝大多数功能仍走 HTTP API 和 `/ws`，不需要大量 IPC。

### Renderer

继续使用现有 Next.js 页面。前端只需要新增少量桌面体验组件：

- 顶部运行状态条。
- 后端启动中/启动失败页面。
- 日志目录入口。
- 托盘/退出说明。
- 本地数据目录提示。

## 无 cmd 窗口策略

优先级从高到低：

1. 最推荐：后端在 Electron main process 内启动，不 spawn 外部命令。
2. 备用：如必须启动独立 Node 后端，用 `child_process.execFile` 或 `spawn` 直接执行二进制，配置：
   - `windowsHide: true`
   - `shell: false`
   - `stdio` 写入日志文件，不 `inherit`
   - 不启动 `.bat`、`.cmd`、PowerShell
3. 不使用当前 `启动.bat` 作为桌面入口。

安装后的用户启动方式：

- 开始菜单快捷方式
- 桌面快捷方式
- 托盘恢复

## 打包工具建议

建议使用 `electron-builder`：

- Windows `nsis` 安装包：适合普通用户安装、开始菜单、桌面快捷方式。
- `portable` 包：适合不想安装的用户，但自动更新和数据路径要更谨慎。

建议新增脚本：

```json
{
  "scripts": {
    "desktop:dev": "concurrently \"npm run dev\" \"electron .\"",
    "desktop:build": "npm run build && npm run desktop:bundle",
    "desktop:bundle": "electron-builder --win nsis"
  }
}
```

实际实现时可以继续复用现有 `scripts/package.mjs` 的 standalone/esbuild 逻辑，但输出目标从 `dist/启动.bat + node.exe` 改成 Electron resources。

## 前端设计页面清单

### 1. 启动页

显示阶段：

- 正在启动本地服务
- 正在初始化数据库
- 正在连接 Polymarket
- 启动失败，可查看日志/重试/退出

设计重点：

- 不展示技术堆栈细节。
- 给出明确状态，不让用户面对空白窗口。
- “查看日志”是辅助入口，不是主按钮。

### 2. 桌面状态栏

位置建议：主界面顶部或侧边栏底部。

状态项：

- 本地后端：运行中 / 启动中 / 异常
- Polymarket WS：已连接 / 重连中 / 断开
- 当前账户数
- 当前监控市场数
- 数据目录入口

### 3. 风险确认页

首次启动或版本升级后显示：

- 本工具会读取本地加密私钥。
- 启动账户后会连接 Polymarket CLOB。
- 自动撤单/重挂会影响真实订单。
- 可选择是否允许启动时自动恢复上次启用账户。

按钮：

- 进入应用
- 进入应用并允许自动恢复

### 4. 托盘菜单

菜单项：

- 显示主窗口
- 启动所有账户
- 停止所有账户
- 取消所有订单
- 打开日志目录
- 退出

危险动作如“取消所有订单”需要二次确认。

### 5. 退出确认

关闭窗口时不要直接杀掉交易引擎。建议弹出：

- 最小化到托盘
- 停止所有账户并退出
- 直接退出

默认动作建议是“最小化到托盘”。

## 前端设计约束

- 桌面端不需要营销式首页，打开后直接进入可操作界面。
- 保持信息密度，适合交易监控，不做大面积装饰卡片。
- 危险操作使用明确颜色和确认弹窗：启动账户、停止账户、取消订单、取消全部订单、自动重挂开关。
- 启动中和错误状态要有完整空状态，不要只显示 spinner。
- 主窗口最小宽度建议 1100px；小于该宽度时侧边栏可折叠，但订单表格仍应可横向滚动。
- 日志/数据目录这类桌面能力放在设置或状态栏，不混入交易主操作区。

## 后端和桌面状态 API

现有 HTTP/API 可继续保留。建议新增桌面状态 endpoint 或 IPC：

```text
GET /api/desktop/status
{
  "mode": "desktop",
  "appVersion": "0.1.0",
  "serverStartedAt": 1710000000000,
  "dataDir": "...",
  "logsDir": "...",
  "autoRestoreEnabled": false
}
```

也可以通过 preload IPC 暴露同样数据。前端只需要消费一个稳定模型。

## 实施里程碑

### M1：结构拆分

- 抽离 `startServer()`。
- `server.ts` 改成 CLI wrapper。
- Electron main process 可以启动 server 并打开窗口。
- 数据目录支持 `APP_DATA_DIR`。

验收：

- `npm run dev` 仍可用。
- Electron dev 模式可打开当前 UI。
- `/ws` 正常连接。

### M2：Windows 无控制台包

- 引入 Electron 和打包配置。
- 打包 Windows `.exe`。
- 移除 bat 入口。
- 确认双击启动不出现 cmd 窗口。
- `better-sqlite3` native module 在打包后可加载。

验收：

- 新机器安装后能打开主窗口。
- 数据写入 `%APPDATA%`。
- 退出后没有残留后端进程。

### M3：桌面体验

- 启动页。
- 状态栏。
- 托盘菜单。
- 退出确认。
- 日志目录入口。

验收：

- 后端启动失败时 UI 能提示并打开日志。
- 关闭窗口不会误停交易引擎。
- 停止所有账户并退出可正常执行。

### M4：安全和发布

- 单实例锁。
- 首次启动风险确认。
- 自动恢复开关。
- 崩溃日志。
- 代码签名和版本号。

验收：

- 双开应用只聚焦已有窗口。
- 异常退出后下次启动有提示。
- 安装包版本和应用内版本一致。

## 关键风险

- `better-sqlite3` native module 打包路径错误会导致启动失败。
- Next standalone 和 Electron asar 路径处理不当会导致静态资源 404。
- 自动恢复账户在桌面端风险更高，需要明确开关。
- 如果使用固定 3000 端口，容易和本机其他服务冲突。
- 如果后端用子进程并通过 `.bat` 启动，会重新出现 cmd 窗口。

## 推荐最终形态

- 一个 Windows 安装包：`PolyMarketLiquidityRewards Setup x.y.z.exe`
- 一个桌面图标：`PolyMarket 风控桌面端`
- 用户数据目录：`%APPDATA%/PolyMarketLiquidityRewards`
- UI 访问方式：只通过 Electron 窗口，不要求用户打开浏览器
- 后端生命周期：跟随 Electron 主进程启动和退出
- 默认关闭自动恢复账户，用户确认后再启用
