import { NextResponse } from "next/server";
import { engineManager } from "@/lib/engine/manager";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const ok = await engineManager.cancelAllOrders(name);
  if (!ok) {
    return NextResponse.json({ error: `未找到账户：${name}` }, { status: 404 });
  }
  return NextResponse.json({ status: "all_cancelled", name });
}
