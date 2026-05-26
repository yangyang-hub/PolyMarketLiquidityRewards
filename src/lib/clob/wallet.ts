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

function normalizeAddress(address: string): `0x${string}` {
  const value = address.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error("钱包地址格式不正确，需要 0x + 40 位十六进制字符串");
  }
  return value as `0x${string}`;
}

export function getWalletAddress(privateKey: string): string {
  return privateKeyToAccount(normalizePrivateKey(privateKey)).address;
}

export function createClobWalletClient(
  privateKey: string,
  chainId: number,
  authAddress?: string,
) {
  const account = privateKeyToAccount(normalizePrivateKey(privateKey));
  const wallet = createWalletClient({
    account,
    chain: getViemChain(chainId),
    transport: http(),
  });

  if (!authAddress || authAddress.toLowerCase() === account.address.toLowerCase()) {
    return wallet;
  }

  const normalizedAuthAddress = normalizeAddress(authAddress);

  return {
    ...wallet,
    account: {
      ...account,
      address: normalizedAuthAddress,
    },
    signTypedData: (parameters: Parameters<typeof wallet.signTypedData>[0]) =>
      wallet.signTypedData({
        ...parameters,
        account,
      }),
  } as typeof wallet;
}
