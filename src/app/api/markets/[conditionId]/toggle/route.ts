import { NextResponse } from "next/server";
import { engineManager } from "@/lib/engine/manager";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ conditionId: string }> },
) {
  const { conditionId } = await params;
  const enabled = engineManager.toggleMarket(conditionId);
  return NextResponse.json({ conditionId, enabled });
}
