import { Chain, ClobClient, SignatureTypeV2 } from "@polymarket/clob-client-v2";
import type { ApiKeyCreds } from "@polymarket/clob-client-v2";
import type { AccountConfig } from "../types";
import { getClobHost, getChainId } from "../config";
import { createClobWalletClient } from "./wallet";

function getChain(): Chain {
  const chainId = getChainId();
  if (chainId === Chain.POLYGON || chainId === Chain.AMOY) return chainId;
  return chainId as Chain;
}

export function createClobClient(account: AccountConfig, creds?: ApiKeyCreds): ClobClient {
  const chain = getChain();
  const wallet = createClobWalletClient(account.privateKey, chain);

  return new ClobClient({
    host: getClobHost(),
    chain,
    signer: wallet,
    creds,
    signatureType: account.signatureType as SignatureTypeV2,
    funderAddress: account.proxyWallet,
    throwOnError: true,
  });
}
