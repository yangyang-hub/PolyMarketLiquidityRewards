import { NextResponse } from "next/server";
import { engineManager } from "@/lib/engine/manager";

export async function GET() {
  const markets = engineManager.getDiscoveredMarkets();
  return NextResponse.json({ markets });
}
