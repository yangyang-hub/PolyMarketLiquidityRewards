import { startServer } from "./src/server/start-server";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "127.0.0.1";
const port = parseInt(process.env.PORT || "3000", 10);

startServer({ dev, host: hostname, port }).then((started) => {
  console.log(`> Ready on ${started.url}`);
  console.log(`> WebSocket on ws://${started.host}:${started.port}/ws`);
}).catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  console.error("[Server] Startup failed:", message);
  process.exit(1);
});
