import { createServer, type Server } from "http";
import next from "next";
import { WebSocketServer } from "ws";
import { APP_TIME_ZONE } from "../lib/time";
import { engineManager } from "../lib/engine/manager";
import { configureNodeOutboundProxy } from "../lib/net/proxy";

process.env.TZ ||= APP_TIME_ZONE;

export interface StartServerOptions {
  dev?: boolean;
  host?: string;
  port?: number;
}

export interface StartedServer {
  server: Server;
  port: number;
  host: string;
  url: string;
  close: () => Promise<void>;
}

export async function startServer(options: StartServerOptions = {}): Promise<StartedServer> {
  configureNodeOutboundProxy();

  const dev = options.dev ?? process.env.NODE_ENV !== "production";
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const port = options.port ?? parseInt(process.env.PORT || "3000", 10);

  const app = next({ dev, hostname: host, port });
  const handle = app.getRequestHandler();

  await app.prepare();
  const nextUpgradeHandler = app.getUpgradeHandler();

  const server = createServer((req, res) => {
    handle(req, res);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    if (pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        engineManager.addClient(ws);

        ws.on("message", (data) => {
          if (data.toString() === "PING") {
            ws.send("PONG");
          }
        });

        ws.on("close", () => engineManager.removeClient(ws));
      });
    } else if (dev && pathname === "/_next/webpack-hmr") {
      await nextUpgradeHandler(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  try {
    await engineManager.initialize();
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[Server] Engine initialization failed:", message);
    console.error("[Server] The app will start but engine features may not work");
  }

  await new Promise<void>((resolve) => {
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : port;
  const urlHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  const url = `http://${urlHost}:${resolvedPort}`;

  return {
    server,
    port: resolvedPort,
    host,
    url,
    close: () =>
      new Promise((resolve, reject) => {
        wss.close(() => {
          server.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }),
  };
}
