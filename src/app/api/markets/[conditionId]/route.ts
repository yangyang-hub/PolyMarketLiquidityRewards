import { NextResponse } from "next/server";
import { engineManager } from "@/lib/engine/manager";
import { store } from "@/lib/store/memory-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ conditionId: string }> },
) {
  const { conditionId } = await params;
  const market = store.managedMarkets.find((m) => m.conditionId === conditionId);
  if (!market) {
    return NextResponse.json({ error: "Market not found" }, { status: 404 });
  }
  const overrides = store.marketOverrides[conditionId] || {};
  return NextResponse.json({ market, overrides });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ conditionId: string }> },
) {
  try {
    const { conditionId } = await params;
    engineManager.removeMarket(conditionId);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ conditionId: string }> },
) {
  try {
    const { conditionId } = await params;
    const body = await request.json();
    const { overrides } = body;
    engineManager.setMarketOverride(conditionId, overrides || {});
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
