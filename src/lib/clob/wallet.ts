import { createWalletClient, http, type Chain as ViemChain } from "viem";
import { polygon, polygonAmoy } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { Chain } from "@polymarket/clob-client-v2";

function normalizePrivateKey(privateKey: string): `0x${string}` {
  const value = privateKey.trim();
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("私钥格式不正确，需要 64 位十六进制字符串");
  }
  return normalized as `0x${string}`;
}

function getViemChain(chainId: number): ViemChain {
  if (chainId === Chain.POLYGON) return polygon;
  if (chainId === Chain.AMOY) return polygonAmoy;
  return {
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    rpcUrls: {
      default: { http: ["http://127.0.0.1"] },
    },
  };
}

export function getWalletAddress(privateKey: string): string {
  return privateKeyToAccount(normalizePrivateKey(privateKey)).address;
}

export function createClobWalletClient(privateKey: string, chainId: number) {
  const account = privateKeyToAccount(normalizePrivateKey(privateKey));
  return createWalletClient({
    account,
    chain: getViemChain(chainId),
    transport: http(),
  });
}
