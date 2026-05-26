import axios from "axios";
import { ProxyAgent } from "proxy-agent";

const PROXY_ENV_KEYS = [
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "ALL_PROXY",
  "https_proxy",
  "http_proxy",
  "all_proxy",
] as const;

let configured = false;
let proxyAgent: ProxyAgent | undefined;

function configuredProxyKeys(): string[] {
  return PROXY_ENV_KEYS.filter((key) => Boolean(process.env[key]));
}

export function configureNodeOutboundProxy(): void {
  if (configured) return;
  configured = true;

  const keys = configuredProxyKeys();
  if (keys.length === 0) return;

  proxyAgent = new ProxyAgent();

  // The Polymarket SDK uses axios internally. Disable axios' limited proxy
  // handling so HTTP, HTTPS, and SOCKS proxies all go through proxy-agent.
  axios.defaults.httpAgent = proxyAgent;
  axios.defaults.httpsAgent = proxyAgent;
  axios.defaults.proxy = false;

  console.log(`[Proxy] Node outbound proxy enabled via ${keys.join(", ")}`);
}

export function getNodeOutboundProxyAgent(): ProxyAgent | undefined {
  configureNodeOutboundProxy();
  return proxyAgent;
}
