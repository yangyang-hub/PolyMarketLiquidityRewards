import { NextResponse } from "next/server";
import { engineManager } from "@/lib/engine/manager";
import { store } from "@/lib/store/memory-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const overrides = store.accountOverrides[name] || {};
  return NextResponse.json({ overrides });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await params;
    const body = await request.json();
    const { overrides } = body;
    engineManager.setAccountOverride(name, overrides || {});
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
