import { NextResponse } from "next/server";
import { engineManager } from "@/lib/engine/manager";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  try {
    await engineManager.refreshAllowance(name);
    return NextResponse.json({ status: "approved", name });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
