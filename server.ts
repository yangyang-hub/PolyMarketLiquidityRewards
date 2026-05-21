import { APP_TIME_ZONE, formatShanghaiDateTime } from "./src/lib/time";

process.env.TZ ||= APP_TIME_ZONE;

function patchConsoleTimestamp(): void {
  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  console.log = (...args: unknown[]) => originalLog(`[${formatShanghaiDateTime()}]`, ...args);
  console.warn = (...args: unknown[]) => originalWarn(`[${formatShanghaiDateTime()}]`, ...args);
  console.error = (...args: unknown[]) => originalError(`[${formatShanghaiDateTime()}]`, ...args);
}

patchConsoleTimestamp();

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "127.0.0.1";
const port = parseInt(process.env.PORT || "3000", 10);

void import("./src/server/start-server").then(({ startServer }) => {
  startServer({ dev, host: hostname, port }).then((started) => {
    console.log(`> Ready on ${started.url}`);
    console.log(`> WebSocket on ws://${started.host}:${started.port}/ws`);
  }).catch((e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[Server] Startup failed:", message);
    process.exit(1);
  });
});
