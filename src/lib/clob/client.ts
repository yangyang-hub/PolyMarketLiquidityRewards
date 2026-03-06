import { ClobClient } from "@polymarket/clob-client";
import { ethers } from "ethers";
import type { AccountConfig } from "../types";
import { getClobHost, getChainId } from "../config";

export function createClobClient(account: AccountConfig): ClobClient {
  const wallet = new ethers.Wallet(account.privateKey);
  const chainId = getChainId();

  return new ClobClient(
    getClobHost(),
    chainId,
    wallet,
    undefined,
    account.signatureType,
    account.proxyWallet
  );
}
