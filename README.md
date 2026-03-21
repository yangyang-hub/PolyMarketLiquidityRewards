# PolyMarketLiquidityRewards

一个面向 Polymarket 的本地监控与撤单工具。

当前版本的核心能力是：

- 管理多个 Polymarket 账户
- 订阅并展示 CLOB 实时盘口
- 根据“买一 / 买二 / 买三...”档位自动撤单
- 本地保存账户配置与撤单参数
- 通过 WebSocket 向前端实时推送账户、盘口和事件状态

当前版本**不是**完整的自动做市机器人。项目里已经有下单能力封装，但主流程仍以“监控 + 撤单风控”为主。

## 功能概览

- 多账户管理
  - 支持添加、编辑、删除账户
  - 支持 EOA / Proxy / Gnosis Safe 签名类型配置
  - 支持账户启停，重启后自动恢复已启用账户
- 盘口监控
  - 后端订阅 Polymarket CLOB WebSocket
  - 前端实时显示订单簿、账户状态和事件日志
  - 后端对新订阅 token 会等待首个快照，不会从空盘口拼增量
- 自动撤单
  - 根据配置的撤单档位判断买单是否进入前 N 档
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
  - 后端到 Polymarket：CLOB WebSocket
  - 后端到浏览器：本项目自己的 `/ws`
- 数据源：
  - CLOB API / WebSocket：订单、订单簿、撤单、余额
  - Gamma API：市场元数据，例如 `slug`、`question`、`condition_id`
- 存储：`better-sqlite3`

## 目录结构

```text
.
├── server.ts                    # 自定义 HTTP + WebSocket 入口
├── src/app                      # Next.js 页面与 API 路由
├── src/lib/clob                 # CLOB 客户端、执行器、盘口订阅
├── src/lib/engine               # 账户引擎、订阅同步、撤单流程
├── src/lib/gamma                # Gamma API 市场信息映射
├── src/lib/db                   # SQLite 与私钥加密
├── src/lib/strategy             # 撤单策略
├── src/stores                   # 前端状态
├── data/                        # 运行时数据目录（自动生成）
└── scripts/package.mjs          # Windows 便携版打包脚本
```

## 环境要求

- Node.js 20+
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
| `PORT` | `3000` | 服务监听端口 |
| `CHAIN_ID` | `137` | Polygon 主网链 ID |
| `CLOB_HOST` | `https://clob.polymarket.com` | CLOB REST Host |
| `CLOB_WS_HOST` | `wss://ws-subscriptions-clob.polymarket.com` | CLOB WebSocket Host |
| `GAMMA_HOST` | `https://gamma-api.polymarket.com` | Gamma API Host |

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
- `proxyWallet`
  - 当使用 Proxy / Safe 模式时，填写 Polymarket Profile / Funder 地址

## 撤单策略说明

当前只有一个生效策略：`cancelDepthLevel`

- `0`：禁用自动撤单
- `1`：当买单进入买一时撤单
- `2`：当买单进入买二以内时撤单
- `3`：当买单进入买三以内时撤单
- 以此类推

注意：

- 当前策略只监控**买单**
- 判断基于订单价格在买盘中的档位，不是队列中的精确排队顺序
- 新订单有冷静期，不会刚进入系统就立刻被撤
- 撤单前会用 CLOB REST 再确认一次订单簿

## 数据来源说明

### 1. CLOB API / WebSocket

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

项目提供 Windows 便携版打包脚本：

```bash
npm run package
```

打包脚本会：

1. 执行 `next build`
2. 用 esbuild 打包 `server.ts`
3. 组装 `dist/`
4. 下载 Windows `node.exe`
5. 下载 `better-sqlite3` 预编译模块

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
npm run dev      # 开发模式
npm run build    # 生产构建
npm run start    # 生产启动
npm run lint     # ESLint
npm run package  # Windows 便携版打包
```
