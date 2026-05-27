import axios from "axios";
import http from "http";
import https from "https";
import { ProxyAgent } from "proxy-agent";

const PROXY_ENV_KEYS = [
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "ALL_PROXY",
  "WSS_PROXY",
  "https_proxy",
  "http_proxy",
  "all_proxy",
  "wss_proxy",
] as const;

let configured = false;
let proxyAgent: ProxyAgent | undefined;

function configuredProxyKeys(): string[] {
  return PROXY_ENV_KEYS.filter((key) => Boolean(process.env[key]));
}

function redactProxyValue(value: string | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.username) url.username = "***";
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return value.replace(/\/\/([^:@/]+):([^@/]+)@/, "//***:***@");
  }
}

function firstProxyEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return undefined;
}

function backfillWebSocketProxyEnv(): void {
  if (firstProxyEnv("WSS_PROXY", "wss_proxy", "ALL_PROXY", "all_proxy")) return;

  const proxy = firstProxyEnv("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy");
  if (!proxy) return;

  // proxy-from-env looks for WSS_PROXY/ALL_PROXY for wss:// URLs.
  process.env.WSS_PROXY = proxy;
  process.env.wss_proxy = proxy;
}

export function configureNodeOutboundProxy(): void {
  if (configured) return;
  configured = true;

  backfillWebSocketProxyEnv();
  const keys = configuredProxyKeys();
  if (keys.length === 0) {
    console.warn("[Proxy] No proxy environment variables found; outbound requests will connect directly");
    return;
  }

  proxyAgent = new ProxyAgent();

  http.globalAgent = proxyAgent as unknown as http.Agent;
  https.globalAgent = proxyAgent as unknown as https.Agent;

  // The Polymarket SDK uses axios internally. Disable axios' limited proxy
  // handling so HTTP, HTTPS, and SOCKS proxies all go through proxy-agent.
  axios.defaults.httpAgent = proxyAgent;
  axios.defaults.httpsAgent = proxyAgent;
  axios.defaults.proxy = false;

  console.log(`[Proxy] Node outbound proxy enabled via ${keys.join(", ")}`);
  for (const key of keys) {
    console.log(`[Proxy] ${key}=${redactProxyValue(process.env[key])}`);
  }
  if (process.env.NO_PROXY || process.env.no_proxy) {
    console.log(`[Proxy] NO_PROXY=${process.env.NO_PROXY || process.env.no_proxy}`);
  }
}

export function getNodeOutboundProxyAgent(): ProxyAgent | undefined {
  configureNodeOutboundProxy();
  return proxyAgent;
}
