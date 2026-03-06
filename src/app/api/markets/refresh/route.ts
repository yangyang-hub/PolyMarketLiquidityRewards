import { NextResponse } from "next/server";
import { engineManager } from "@/lib/engine/manager";

export async function POST() {
  await engineManager.refreshMarkets();
  return NextResponse.json({ status: "refreshed" });
}
