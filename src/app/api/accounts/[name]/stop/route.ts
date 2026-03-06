import { NextResponse } from "next/server";
import { engineManager } from "@/lib/engine/manager";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const ok = await engineManager.stopAccount(name);
  if (!ok) {
    return NextResponse.json({ error: `Account '${name}' not found` }, { status: 404 });
  }
  return NextResponse.json({ status: "stopped", name });
}
