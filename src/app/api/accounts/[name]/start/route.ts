import { NextResponse } from "next/server";
import { engineManager } from "@/lib/engine/manager";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const ok = await engineManager.startAccount(name);
  if (!ok) {
    const state = engineManager.getAccountState(name);
    if (!state) {
      return NextResponse.json({ error: `未找到账户：${name}` }, { status: 404 });
    }
    const reason = state.error ? `：${state.error}` : "";
    return NextResponse.json({ error: `账户启动失败${reason}` }, { status: 400 });
  }
  return NextResponse.json({ status: "started", name });
}
