import { NextResponse } from "next/server";
import { engineManager } from "@/lib/engine/manager";

export async function GET() {
  return NextResponse.json({ config: engineManager.getConfig() });
}

export async function PUT(request: Request) {
  const body = await request.json();
  engineManager.updateConfig(body);
  return NextResponse.json({ config: engineManager.getConfig() });
}
