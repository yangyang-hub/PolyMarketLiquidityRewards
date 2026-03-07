import { NextResponse } from "next/server";
import { engineManager } from "@/lib/engine/manager";

export async function GET() {
  const markets = engineManager.getManagedMarkets();
  return NextResponse.json({ markets });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { input } = body;
    if (!input || typeof input !== "string" || !input.trim()) {
      return NextResponse.json({ error: "input is required" }, { status: 400 });
    }
    const market = await engineManager.addMarket(input.trim());
    return NextResponse.json({ market });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
