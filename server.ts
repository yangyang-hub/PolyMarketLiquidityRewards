import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer } from "ws";
import { engineManager } from "./src/lib/engine/manager";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url!);
    if (pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        engineManager.addClient(ws);
        ws.on("close", () => engineManager.removeClient(ws));
      });
    } else {
      socket.destroy();
    }
  });

  // Initialize engine manager
  try {
    await engineManager.initialize();
  } catch (e: any) {
    console.error("[Server] Engine initialization failed:", e.message);
    console.error("[Server] The app will start but engine features may not work");
  }

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> WebSocket on ws://${hostname}:${port}/ws`);
  });
});
