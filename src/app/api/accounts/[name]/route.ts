import { NextResponse } from "next/server";
import { engineManager } from "@/lib/engine/manager";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 400 });
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
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 400 });
  }
}
