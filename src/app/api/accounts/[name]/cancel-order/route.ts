import { NextResponse } from "next/server";
import { engineManager } from "@/lib/engine/manager";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const body = await request.json();
  const orderId = body.orderId;
  if (!orderId) {
    return NextResponse.json({ error: "订单编号不能为空" }, { status: 400 });
  }
  const ok = await engineManager.cancelOrder(name, orderId);
  if (!ok) {
    return NextResponse.json({ error: "撤单失败" }, { status: 400 });
  }
  return NextResponse.json({ status: "cancelled", orderId });
}
