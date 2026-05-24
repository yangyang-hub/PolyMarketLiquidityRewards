# PolyMarketLiquidityRewards

一个面向 Polymarket 的本地监控与撤单工具。

当前版本的核心能力是：

- 管理多个 Polymarket 账户
- 订阅并展示 CLOB V2 实时盘口
- 根据“买一 / 买二 / 买三...”档位自动撤单
- 本地保存账户配置与撤单参数
- 通过 WebSocket 向前端实时推送账户、盘口和事件状态

当前版本**不是**完整的自动做市机器人。项目里已经有下单能力封装，但主流程仍以“监控 + 撤单风控”为主。

协作维护说明见 [AGENT.md](./AGENT.md)。后续每次代码变更都需要同步检查并更新该文档。

## 功能概览

- 多账户管理
  - 支持添加、编辑、删除账户
  - 支持 EOA / Proxy / Gnosis Safe / POLY_1271 Deposit Wallet 签名类型配置
  - 支持账户启停，重启后自动恢复已启用账户
- 盘口监控
  - 后端订阅 Polymarket CLOB V2 WebSocket
  - 前端实时显示订单簿、账户状态和事件日志
  - 后端对新订阅 token 会等待首个快照，不会从空盘口拼增量
- 自动撤单
  - 根据配置的撤单档位判断买单是否进入前 N 档
  - 支持订单价格上方买盘金额不足时直接撤单
  - 支持检测买盘前方量骤降、推断买入吃单、买盘撤量跟随
  - 支持按随机时间窗口撤单并重新挂回队尾
  - 支持关闭自动撤单
  - 新订单有冷静期，避免刚发现就立刻撤掉
  - 真正撤单前会再用 CLOB REST 订单簿做一次确认，降低误撤单概率
- 本地持久化
  - SQLite 数据库存储在 `data/app.db`
  - 私钥使用 AES-256-GCM 加密
  - 本地加密密钥保存在 `data/.encryption-key`

## 技术架构

- 前端：Next.js 16 + React 19 + Zustand + DaisyUI
- 后端：自定义 Node HTTP Server + Next.js App Router
- 实时通道：
  - 后端到 Polymarket：CLOB V2 WebSocket
  - 后端到浏览器：本项目自己的 `/ws`
- 数据源：
  - CLOB V2 API / WebSocket：订单、订单簿、撤单、余额
  - Gamma API：市场元数据，例如 `slug`、`question`、`condition_id`
- 存储：`better-sqlite3`
- 交易 SDK：`@polymarket/clob-client-v2`

## 目录结构

```text
.
├── AGENT.md                     # 代码代理协作与维护规则
├── server.ts                    # 自定义 HTTP + WebSocket 入口
├── src/app                      # Next.js 页面与 API 路由
├── src/lib/clob                 # CLOB 客户端、执行器、盘口订阅
├── src/lib/engine               # 账户引擎、订阅同步、撤单流程
├── src/lib/gamma                # Gamma API 市场信息映射
├── src/lib/db                   # SQLite 与私钥加密
├── src/lib/strategy             # 撤单策略
├── src/stores                   # 前端状态
├── electron/                    # Electron 主进程与 preload
├── data/                        # 运行时数据目录（自动生成）
├── scripts/                     # Electron / legacy 打包脚本
└── vendor/                      # 依赖覆盖用本地 stub 包
```

## 环境要求

- Node.js 26.x
- npm 10+（或兼容版本）
- 能访问：
  - `https://clob.polymarket.com`
  - `wss://ws-subscriptions-clob.polymarket.com`
  - `https://gamma-api.polymarket.com`

## 安装

```bash
npm install
```

## 运行

开发模式：

```bash
npm run dev
```

生产构建：

```bash
npm run build
npm run start
```

默认地址：

- Web: `http://localhost:3000`
- Browser WebSocket: `ws://localhost:3000/ws`

## 可选环境变量

项目大多数配置都有默认值，不配也能跑。

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 服务监听地址；如需局域网访问再手动改为 `0.0.0.0` |
| `PORT` | `3000` | 服务监听端口 |
| `CHAIN_ID` | `137` | Polygon 主网链 ID |
| `CLOB_HOST` | `https://clob.polymarket.com` | CLOB REST Host |
| `CLOB_WS_HOST` | `wss://ws-subscriptions-clob.polymarket.com` | CLOB WebSocket Host |
| `GAMMA_HOST` | `https://gamma-api.polymarket.com` | Gamma API Host |
| `APP_DATA_DIR` | `data` | 运行时数据库和本地加密密钥目录 |

## 首次使用

1. 启动服务：`npm run dev`
2. 打开浏览器访问 `http://localhost:3000`
3. 进入账户页添加账户
4. 配置撤单档位
5. 启动账户后，系统会：
   - 初始化 API Key
   - 拉取余额
   - 拉取当前 open orders
   - 自动订阅这些订单对应的 token 盘口

## 账户字段说明

添加账户时需要以下字段：

- `name`
  - 本地账户名称
  - 仅用于 UI 和本地数据库标识
- `privateKey`
  - 用于 Polymarket/CLOB API 鉴权
  - 存储前会被本地加密
- `signatureType`
  - `0`: EOA
  - `1`: Proxy
  - `2`: Gnosis Safe
  - `3`: POLY_1271 / Deposit Wallet
- `proxyWallet`
  - 当使用 Proxy / Safe / Deposit Wallet 模式时，填写 Polymarket Profile / Funder 地址
  - V2 新 API 用户通常应选择 `3`，这里填写 Polymarket 设置页显示的 Deposit Wallet 地址；私钥仍填写该 Deposit Wallet owner/signer 的私钥

## 撤单策略说明

当前策略配置包括：

- `cancelDepthLevel`
  - `0`：禁用档位撤单
  - `1`：当买单进入买一时撤单
  - `2`：当买单进入买二以内时撤单
  - `3`：当买单进入买三以内时撤单
  - 以此类推
- `minBookNotionalUsd`
  - 订单价格上方买盘金额低于该值时直接撤单
  - `0` 表示禁用
- `volumeDropPercent` / `volumeDropWindowSec`
  - 在窗口期内，订单价格前方买盘金额骤降达到该比例时撤单
  - 比例为 `0` 表示禁用
- `buyPressureUsd` / `buyPressureWindowSec`
  - 通过 ask 侧盘口减少推断连续买入吃单，窗口期内金额达到该值时撤单
  - 金额为 `0` 表示禁用
- `cancelFollowDropPercent` / `cancelFollowWindowSec` / `cancelFollowDepthLevels`
  - 监测买盘前 N 档撤量比例，达到阈值时跟随撤单
  - 比例为 `0` 表示禁用
- `orderResetEnabled` / `orderResetMinMinutes` / `orderResetMaxMinutes`
  - 启用后，订单在随机时间窗口到期时撤单并按原价格和剩余数量重新挂单
  - 只有定时重置触发的撤单会重新挂单，其他风控撤单不会重挂

注意：

- 当前策略只监控**买单**
- 判断基于订单价格在买盘中的档位，不是队列中的精确排队顺序
- 档位撤单有新订单冷静期；最低盘口量属于最高风控，会绕过冷静期
- 档位撤单和最低盘口量撤单前会用 CLOB REST 再确认一次订单簿
- 成交速度检测基于订单簿 ask 侧减少推断，不等同于逐笔成交明细

## 数据来源说明

### 1. CLOB V2 API / WebSocket

用于：

- 获取 open orders
- 获取实时订单簿
- 下单 / 撤单
- 获取余额

### 2. Gamma API

用于：

- 根据 `tokenId` 反查市场信息
- 获取市场 `slug`、`question`、`condition_id`
- 构建前端可读的市场列表

Gamma API **不负责盘口数据**。

## 持久化与安全

运行时会自动生成：

- `data/app.db`
  - SQLite 数据库
  - 保存账户配置和策略配置
- `data/.encryption-key`
  - 本地加密密钥
  - 用于加密数据库中的私钥

注意事项：

- 请妥善备份 `data/app.db` 和 `data/.encryption-key`
- 只备份数据库不备份密钥，私钥将无法解密
- 删除 `data/.encryption-key` 会导致已保存账户无法恢复

## 打包

项目提供 Electron 桌面端打包脚本。默认 `npm run package` 会执行 Windows NSIS 安装包构建：

```bash
npm run package
```

Windows 打包注意：

- 请在本地盘符路径下运行，例如 `C:\workspace\node\PolyMarketLiquidityRewards`。
- 不要从 `\\tsclient\...` 这类 UNC 共享路径直接运行 `npm run package`；Windows `cmd.exe` 不支持把 UNC 路径作为当前目录，会退回到 `C:\Windows` 并导致找不到 `package.json`。
- 打包脚本会直接调用 `node_modules` 里的本地 CLI，不依赖全局 `npx`。
- 打包脚本会从 `public/logo.png` 生成临时 `.cache/electron/logo.ico`，安装包、卸载程序、桌面快捷方式和开始菜单快捷方式都会使用这个图标。
- 打包脚本会把 Next standalone 运行所需的 `node_modules` 暂存为 `server-vendor`，避免 Electron Builder 过滤依赖，同时从服务端资源里剔除本地 `data/`、`release/`、`dist*` 等运行或构建产物。
- 打包脚本使用 Node.js 直接解压 `better-sqlite3` 预编译包，不依赖系统 `tar`，避免 `C:\...` 路径被当成远程归档地址。
- 如果 `npm install` 没有生成根目录 `node_modules/better-sqlite3` 的 `.node` 文件，打包脚本会在 `next build` 前自动安装 Node 26 Windows 预编译模块，避免构建期加载数据库时报错。
- Electron Builder 已关闭 `npmRebuild`；后端使用 `dist-server` 中的 Node 26 预编译 `better-sqlite3`，不需要本机 Python/node-gyp。
- Electron Builder 已关闭 Windows exe 资源编辑并跳过 `.exe` 签名；本地未签名安装包不会下载 `winCodeSign.7z`，也不需要 Windows 符号链接权限。
- 页面顶部不再绘制模拟窗口控制按钮，桌面端使用系统原生最小化、最大化和关闭按钮。
- 桌面端和内置后端统一使用 `Asia/Shanghai` 时区；`electron-main.log`、`backend.log` 和前端事件时间都会按上海时间显示。
- 桌面端启动时会先让本地后端监听端口，再在后台恢复上次启用的账户，避免账户网络请求阻塞应用启动。
- 如果本地后端启动失败，主窗口会显示日志目录路径，并把 `backend-error.log` / `backend.log` 尾部写入错误详情。
- 当前项目只支持 Node.js 26.x；常用 npm scripts 会在启动前检查 Node 主版本。切换 Node 版本后请重新运行 `npm install --include=optional`。
- 如果出现 `Cannot find module '../lightningcss.win32-x64-msvc.node'`，说明 Windows 原生 optional dependency 没装完整。请在 Windows 本地路径下删除 `node_modules` 后运行 `npm install --include=optional`，再重新打包。

常用桌面端命令：

```bash
npm run desktop:dev            # Electron 开发模式
npm run desktop:pack           # Windows dir 目录包
npm run desktop:dist           # Windows NSIS 安装包
npm run desktop:dist:portable  # Windows portable 包
```

旧版自定义便携打包脚本仍保留为：

```bash
npm run package:legacy
```

Electron 打包流程会：

1. 从 `public/logo.png` 生成 Windows `.ico` 图标
2. 执行 `next build`
3. 准备服务端运行资源
4. 构建 Electron 主进程代码
5. 通过 `electron-builder` 生成 Windows 安装包或便携包

## 常见问题

### 1. `[GammaAPI] Batch fetch error: 422`

表示批量请求 Gamma 市场信息时，某一批 `clob_token_ids` 参数被服务端判定为非法。

通常不影响盘口本身，但会导致：

- 市场 `slug` / `question` 缺失
- `discoveredMarkets` 不完整

不直接影响 CLOB 订单簿抓取。

### 2. “禁用”是什么意思？

撤单设置里的“禁用”表示 `cancelDepthLevel = 0`，即完全关闭自动撤单。

### 3. 能不能跟某个地址的挂单？

当前公开订单簿是聚合价位，不包含外部地址的单笔 open order 明细。

因此可以做“跟买三这一档的大额量”，但不能精确绑定“某个别人地址的某一张挂单”。

## 当前边界

当前版本已具备：

- 订单监控
- 实时盘口同步
- 自动撤单
- 市场信息映射

当前版本暂未实现完整：

- 自动跟单挂单策略
- 完整做市报价引擎
- 基于指定外部地址的订单跟踪
- 回测或策略仿真模块

## 开发命令

```bash
npm run dev                    # 开发模式
npm run build                  # 生产构建
npm run start                  # 生产启动
npm run lint                   # ESLint
npm run package                # 默认 Windows Electron 安装包
npm run desktop:dev            # Electron 开发模式
npm run desktop:dist:portable  # Windows Electron 便携包
```

当前 `package.json` 没有独立 `test` 脚本。常规变更优先使用 `npm run lint` 和 `npm run build` 验证。

## 开发协作约定

- 代码代理维护规则写在 [AGENT.md](./AGENT.md)。
- 每次代码变更后都要同步检查 `AGENT.md`。
- 如果变更影响架构、命令、依赖、API、环境变量、数据存储、安全假设、打包流程或用户工作流，需要同步更新 `AGENT.md` 的对应章节。
- 如果代码变更不需要修改 `AGENT.md` 正文，也要在该文件的 `Sync Log` 记录已检查。
- 不要提交私钥、`.env`、`data/app.db`、`data/.encryption-key`、`.next/`、`dist/`、`dist-server/`、`dist-electron/`、`release/` 等本地运行或构建产物。
