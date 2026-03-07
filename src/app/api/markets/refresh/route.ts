import { NextResponse } from "next/server";
import { engineManager } from "@/lib/engine/manager";

export async function POST() {
  await engineManager.refreshMarketRewards();
  return NextResponse.json({ status: "refreshed" });
}
