import { NextResponse } from "next/server";
import { engineManager } from "@/lib/engine/manager";
import { dbGetAllAccountMetas } from "@/lib/db/database";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET() {
  const states = engineManager.getAccountStates();
  const configs = dbGetAllAccountMetas();
  return NextResponse.json({ accounts: states, configs });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, privateKey, signatureType, proxyWallet } = body;

    if (!name || !privateKey) {
      return NextResponse.json(
        { error: "账户名称和私钥不能为空" },
        { status: 400 },
      );
    }

    await engineManager.addAccount(
      name,
      privateKey,
      signatureType ?? 0,
      proxyWallet || undefined,
    );

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 400 });
  }
}
