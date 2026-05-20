import { NextResponse } from "next/server";
import { engineManager } from "@/lib/engine/manager";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const ok = await engineManager.startAccount(name);
  if (!ok) {
    return NextResponse.json({ error: `账户启动失败或未找到：${name}` }, { status: 400 });
  }
  return NextResponse.json({ status: "started", name });
}
