import { Chain, ClobClient, SignatureTypeV2 } from "@polymarket/clob-client-v2";
import type { ApiKeyCreds } from "@polymarket/clob-client-v2";
import { ethers } from "ethers";
import type { AccountConfig } from "../types";
import { getClobHost, getChainId } from "../config";

function getChain(): Chain {
  const chainId = getChainId();
  if (chainId === Chain.POLYGON || chainId === Chain.AMOY) return chainId;
  return chainId as Chain;
}

export function createClobClient(account: AccountConfig, creds?: ApiKeyCreds): ClobClient {
  const wallet = new ethers.Wallet(account.privateKey);

  return new ClobClient({
    host: getClobHost(),
    chain: getChain(),
    signer: wallet,
    creds,
    signatureType: account.signatureType as SignatureTypeV2,
    funderAddress: account.proxyWallet,
    throwOnError: true,
  });
}
