# AGENT.md

This file is the working guide for coding agents maintaining this repository.
Keep it current with the codebase.

## Mandatory Documentation Sync

- After every code change, review this file in the same change set.
- If the change affects architecture, runtime behavior, commands, dependencies, API routes, environment variables, data storage, security assumptions, packaging, or user workflows, update the relevant section.
- If a code change does not require content changes here, still add a short entry under "Sync Log" saying the file was checked and no documentation update was needed.
- Do not commit or expose private keys, database files, encryption keys, local `.env` files, or generated build/runtime directories.

## Project Snapshot

PolyMarketLiquidityRewards is a local Polymarket monitoring and risk-control app. It manages multiple Polymarket accounts, subscribes to CLOB order books, displays live account/order-book state, and automatically cancels buy orders according to configured risk rules.

The current product boundary is "monitoring plus cancellation risk control". The code contains order placement wrappers and order-reset behavior, but this is not a full market-making, backtesting, or external-wallet copy-trading system.

## Stack

- Runtime: Node.js 26.x only. Common npm scripts enforce this through `scripts/assert-node.mjs`.
- App framework: Next.js 16 App Router, React 19, TypeScript.
- UI state: Zustand.
- Styling: Tailwind CSS 4 and DaisyUI.
- Server: custom Node HTTP server in `server.ts` and `src/server/start-server.ts`.
- Browser realtime channel: local WebSocket endpoint at `/ws`.
- Polymarket realtime channel: CLOB market WebSocket via `src/lib/clob/ws-feed.ts`.
- Storage: SQLite through `better-sqlite3`.
- Desktop packaging: Electron and `electron-builder`.
- Decimal math: `decimal.js`.
- Polymarket SDK: `@polymarket/clob-client-v2`.

## Main Commands

```bash
npm install
npm run dev
npm run build
npm run start
npm run lint
npm run package
```

Useful desktop commands:

```bash
npm run desktop:dev
npm run desktop:build-main
npm run desktop:prepare
npm run desktop:pack
npm run desktop:dist
npm run desktop:dist:portable
```

There is currently no dedicated test script in `package.json`; use `npm run lint` and `npm run build` as the default verification commands unless a task adds tests.

## Runtime Configuration

Supported environment variables:

- `HOST`: HTTP bind host, default `127.0.0.1`.
- `PORT`: HTTP bind port, default `3000`.
- `CHAIN_ID`: Polymarket chain id, default `137`.
- `CLOB_HOST`: CLOB REST host, default `https://clob.polymarket.com`.
- `CLOB_WS_HOST`: CLOB WebSocket host, default `wss://ws-subscriptions-clob.polymarket.com`.
- `GAMMA_HOST`: Gamma API host, default `https://gamma-api.polymarket.com`.
- `APP_DATA_DIR`: runtime data directory, default `data` under the current working directory.
- `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` / `WSS_PROXY` and lowercase variants: optional outbound proxy settings used by the Node backend for CLOB REST, Gamma API, and CLOB WebSocket connections. Packaged Electron attempts to translate Windows system HTTP/HTTPS/SOCKS proxy settings into these variables before starting the backend.

Runtime-generated local data:

- `data/app.db`: SQLite database for accounts and strategy config.
- `data/.encryption-key`: AES-256-GCM key used to decrypt private keys stored in the database.

The `data/` directory is gitignored. Keep `data/app.db` and `data/.encryption-key` together when backing up; the database is not recoverable without the matching encryption key.

## Architecture Map

- `server.ts`: process entry point; resolves `HOST`, `PORT`, and development mode.
- `src/server/start-server.ts`: prepares Next.js, creates the HTTP server, handles `/ws` WebSocket upgrades, and initializes `engineManager`.
- `src/app`: Next.js pages and API routes.
- `src/components`: reusable UI components for accounts, order tables, order books, status, sidebar, and event logs.
- `src/hooks`: browser API and WebSocket hooks.
- `src/stores/appStore.ts`: browser-side Zustand state and WebSocket message reducer.
- `src/lib/types.ts`: server-side domain and WebSocket message types.
- `src/types/index.ts`: client-facing DTO/type definitions.
- `src/lib/engine/manager.ts`: singleton coordinator for account engines, browser clients, CLOB subscriptions, Gamma market discovery, and account/config APIs.
- `src/lib/engine/engine.ts`: per-account polling, realtime risk checks, cancellations, order reset, scoring checks, and balance/order refresh.
- `src/lib/clob/client.ts`: CLOB client factory.
- `src/lib/clob/executor.ts`: CLOB operations such as API key initialization, order placement, cancellation, open-order lookup, scoring, balance, and allowance refresh.
- `src/lib/clob/ws-feed.ts`: resilient Polymarket CLOB WebSocket feed with local order-book state, snapshot handling, price-change deltas, trade updates, heartbeat, stale detection, and reconnects.
- `src/lib/gamma/api.ts`: Gamma API lookups for market metadata by token id.
- `src/lib/db/database.ts`: SQLite schema, migrations, account persistence, enabled-account flags, and strategy config persistence.
- `src/lib/db/crypto.ts`: private-key encryption/decryption and local encryption-key management.
- `src/lib/strategy/depth-strategy.ts`: shared order-book notional and depth-position calculations used by cancellation rules.
- `electron/` and `scripts/`: Electron main/preload code plus build/package helpers.
- `scripts/script-utils.mjs`: shared helpers for invoking local Node CLIs without relying on `npx`; this avoids Windows `.cmd` resolution failures in packaging scripts.
- `vendor/ethersproject-*-stub`: local package overrides required by the current dependency tree.

## Startup Flow

1. `server.ts` calls `startServer`.
2. `startServer` prepares Next.js, creates the HTTP server, installs `/ws` upgrade handling, and initializes `engineManager`.
3. `engineManager.initialize()` loads account configs from SQLite, creates an `AccountEngine` per account, starts the CLOB WebSocket feed, broadcasts status, and auto-starts accounts that were enabled before restart.
4. Browser clients connecting to `/ws` are registered by `engineManager.addClient()` and immediately receive a snapshot: system status, account states, account configs without private keys, discovered markets, strategy config, and cached order books.

## Account And Market Flow

- Account management API calls delegate to `engineManager`.
- Private keys are encrypted before database storage and never sent to the browser after creation/update.
- EOA accounts (`signatureType = 0`) must not retain or submit a `proxyWallet`; Proxy/Safe/POLY_1271 accounts require a valid `0x` funder/deposit wallet address.
- Enabled accounts are persisted through the `enabled` column and auto-started on server restart.
- Running account engines poll CLOB open orders every 15 seconds, refresh the CLOB collateral balance/allowance cache before reading balance, check scoring status, and report active token ids.
- `engineManager.syncSubscriptions()` aggregates active token ids across running engines, subscribes/unsubscribes the shared CLOB WebSocket feed, fetches unknown market metadata from Gamma, and updates browser clients. Account stop/remove, manual cancel, and cancel-all paths must also resync subscriptions so stale order books and discovered markets are removed promptly.

## Risk And Cancellation Flow

Cancellation logic is buy-order focused. Core rules currently include:

- `cancelDepthLevel`: cancel when a buy order is within the configured bid depth.
- `minBookNotionalUsd`: cancel when bid notional above the order price is below the threshold.
- `volumeDropPercent` and `volumeDropWindowSec`: cancel on sharp reduction of protected/front bid notional in a window.
- `buyPressureUsd` and `buyPressureWindowSec`: cancel when recent BUY trades imply enough buy pressure.
- `cancelFollowDropPercent`, `cancelFollowWindowSec`, and `cancelFollowDepthLevels`: cancel when top bid levels show enough follow-on withdrawal.
- `orderResetEnabled`, `orderResetMinMinutes`, and `orderResetMaxMinutes`: optionally cancel and re-place orders after a random reset window.

Important behavior:

- New orders have a cooldown before most cancellation rules can remove them.
- High-priority low-book-notional checks can bypass cooldown.
- Depth and minimum-notional risk cancellations are confirmed with a fresh CLOB REST order book before the order is cancelled.
- The order book is price-level aggregate data; it is not a precise per-wallet queue.
- `Decimal` should be used for price, size, and notional calculations.

## API Surface

Current API route files:

- `GET/POST /api/accounts`
- `GET/PUT/DELETE /api/accounts/[name]`
- `POST /api/accounts/[name]/start`
- `POST /api/accounts/[name]/stop`
- `POST /api/accounts/[name]/cancel-order`
- `POST /api/accounts/[name]/cancel-all`
- `POST /api/batch/start-all`
- `POST /api/batch/stop-all`
- `GET/PUT /api/config`
- `GET /api/markets`
- `GET /api/markets/orderbooks`

The browser WebSocket endpoint is `/ws`. Client messages currently only use `"PING"` and receive `"PONG"`; server-to-client application messages are JSON `WsMessage` payloads. Cache removal is explicit: deleted accounts use `account_removed`, and unsubscribed token order books use `orderbooks_removed`.

## Change Guidelines

- Preserve the custom server singleton model. Next.js API routes and the custom server must share `engineManager` and `store` through `globalThis`.
- Keep server-only code out of client components and browser hooks.
- Keep private keys server-side. Browser DTOs must not include `privateKey`.
- Use structured route handlers and typed DTOs rather than ad hoc JSON shapes when adding API behavior.
- For CLOB and strategy math, avoid JavaScript floating-point comparisons where precision matters; use `Decimal`.
- When changing strategy config, update `StrategyConfig`, defaults in `src/lib/config.ts`, database load/save behavior if needed, API validation in `src/app/api/config/route.ts`, client DTOs, UI settings, and this file.
- When adding a WebSocket message type, update both server-side and client-side `WsMessage` types plus `src/stores/appStore.ts`.
- When adding persistent fields, include SQLite migration logic in `src/lib/db/database.ts`.
- Respect the existing dirty worktree. Do not revert unrelated user changes.

## Verification Checklist

Before handing off code changes, run the most relevant commands:

- `npm run lint` for TypeScript/ESLint issues.
- `npm run build` for production build and Next.js integration issues.
- For desktop packaging changes, run the relevant `desktop:*` script.
- On Windows, run packaging from a local drive path, not a UNC path such as `\\tsclient\...`; `cmd.exe` falls back to `C:\Windows` for UNC working directories.
- Windows packaging requires Node.js 26.x and platform-specific optional native packages such as `lightningcss-win32-x64-msvc`; after switching Node versions, reinstall dependencies with `npm install --include=optional`.
- Packaged Electron should inherit Windows system HTTP/HTTPS/SOCKS proxy settings for the bundled Node backend. For development or manual overrides, set `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, or `WSS_PROXY` before starting the app. `wss://` subscriptions require `WSS_PROXY` or `ALL_PROXY`; the backend backfills `WSS_PROXY` from HTTP/HTTPS proxy variables when needed.
- `scripts/prepare-electron-icons.mjs` generates `.cache/electron/logo.ico` from `public/logo.png` before Electron Builder runs; `electron/installer.nsh` reapplies that icon to desktop and Start Menu shortcuts.
- `scripts/prepare-electron-resources.mjs` prunes traced `data`, `release`, `dist*`, and `.cache` directories from `.next/standalone`/`dist-server`; it renames standalone `node_modules` to `server-vendor` because Electron Builder filters `node_modules` inside `extraResources`.
- Windows packaging extracts the downloaded `better-sqlite3` tarball through Node.js code in `scripts/script-utils.mjs`, not the system `tar` command.
- Before `next build`, Windows packaging ensures root `node_modules/better-sqlite3` has the Node 26 native module so build-time API route imports do not require Python/node-gyp.
- Electron Builder has `npmRebuild` disabled because packaged `better-sqlite3` runs in the bundled Node 26 backend from `dist-server`, not in Electron's main process.
- Electron Builder disables Windows exe resource editing with `win.signAndEditExecutable: false` and skips `.exe` signing via `win.signExts: ["!.exe"]`; local unsigned Windows packages should not need `winCodeSign.7z` or symlink privileges.
- Packaged Electron uses external `resources/logo.ico` for tray icons; do not point packaged tray creation only at `public/logo.png` inside app files.
- The local HTTP server should become reachable before enabled accounts auto-start; account auto-start runs in the background to avoid desktop startup timeouts.
- Do not add simulated in-page window controls to the top bar; the desktop app uses native OS minimize, maximize, and close controls.
- Runtime time zone is `Asia/Shanghai`. Use `src/lib/time.ts` for user-visible or file-log timestamps, and pass `TZ: APP_TIME_ZONE` to bundled backend processes.
- Docker builds use `.dockerignore` to exclude local runtime data, generated builds, caches, and environment files. Keep `data/`, `dist*/`, `release/`, `.cache/`, `.next/`, and private env/key material out of Docker build contexts.

If verification cannot be run because of missing network, credentials, platform requirements, or long-running packaging constraints, state that clearly in the final response.

## Sync Log

- 2026-05-21: Updated packaging scripts to avoid nested `npm run` and `npx` so Windows builds resolve local CLIs reliably. Documented the UNC-path packaging limitation in `README.md` and ignored generated Electron packaging directories.
- 2026-05-21: Added a Windows packaging preflight for missing native CSS optional dependencies and documented the `lightningcss-win32-x64-msvc` recovery path.
- 2026-05-21: Replaced system `tar` extraction for the Windows `better-sqlite3` prebuild with a Node.js tar.gz entry extractor to avoid `C:\...` path handling failures.
- 2026-05-21: Disabled Electron Builder `npmRebuild` so packaging does not invoke node-gyp/Python for root `better-sqlite3`.
- 2026-05-21: Added a pre-Next-build Windows `better-sqlite3` native module bootstrap so fresh `npm install` runs can package without local Python/node-gyp.
- 2026-05-21: Added Electron icon preparation from `public/logo.png` and an NSIS install hook so installer, uninstaller, desktop shortcut, and Start Menu shortcut use the project logo.
- 2026-05-21: Fixed packaged tray icon lookup to use external `resources/logo.ico` and made enabled-account auto-start run in the background so it cannot block backend readiness.
- 2026-05-21: Staged Next standalone dependencies as `server-vendor`, added `NODE_PATH` for the bundled backend, and pruned traced local runtime/build directories to avoid missing `next` and leaking local data.
- 2026-05-21: Removed simulated `-- □ ×` controls from the web top bar because the packaged desktop window already provides native OS controls.
- 2026-05-21: Standardized desktop/backend runtime timestamps on `Asia/Shanghai`, including Electron main log prefixes, backend console prefixes, frontend event times, and SQLite local update timestamps.
- 2026-05-21: Disabled Electron Builder Windows exe resource editing in addition to `.exe` signing to avoid `winCodeSign.7z` extraction on machines without symlink privileges.
- 2026-05-21: Configured Electron Builder to skip `.exe` signing for local Windows packages, avoiding `winCodeSign.7z` symlink extraction failures.
- 2026-05-21: Migrated the project baseline from Node 20 to Node 26 only, including package engines, Docker image, esbuild targets, Windows bundled `node.exe`, and `better-sqlite3` Node ABI.
- 2026-05-21: Created this `AGENT.md` from the current README, package scripts, and source structure. No business code was changed in this update.
- 2026-05-25: Fixed account signature/funder normalization, restored depth-cancel cooldown behavior, added explicit WebSocket cache-removal messages, resynced subscriptions after stop/remove/manual cancellation paths, and added `.dockerignore` protection for local runtime/build data.
- 2026-05-26: Added Node backend outbound proxy support for CLOB REST, Gamma API, and CLOB WebSocket connections, including Electron inheritance of Windows system SOCKS proxies through `ALL_PROXY`. Pinned the Next.js workspace root so standalone packaging is not confused by parent lockfiles.
- 2026-05-27: Strengthened packaged proxy handling by installing the proxy agent as Node's global HTTP/HTTPS agent, resolving system proxy rules for CLOB REST, Gamma, and CLOB WebSocket targets, and logging resolved proxy decisions for desktop troubleshooting.
- 2026-05-27: Fixed a CLOB WebSocket proxy gap by mapping inherited HTTP/HTTPS proxies to `WSS_PROXY`/`ALL_PROXY`, since `wss://` URLs do not use `HTTPS_PROXY` in `proxy-from-env`.
- 2026-05-26: Fixed account balance refresh so CLOB balance/allowance cache is synced before reading collateral balances, preventing newly connected wallets from continuing to show stale zero balances.
- 2026-05-26: Fixed POLY_1271 Deposit Wallet CLOB authentication so API keys and L2 headers bind to the deposit/funder address while order signatures are still produced by the configured owner private key.
