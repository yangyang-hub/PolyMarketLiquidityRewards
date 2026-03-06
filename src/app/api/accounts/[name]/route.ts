import { NextResponse } from "next/server";
import { engineManager } from "@/lib/engine/manager";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await params;
    const body = await request.json();
    const { privateKey, signatureType, proxyWallet } = body;

    await engineManager.updateAccountConfig(
      name,
      privateKey || null,
      signatureType ?? 0,
      proxyWallet || undefined,
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await params;
    await engineManager.removeAccount(name);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
