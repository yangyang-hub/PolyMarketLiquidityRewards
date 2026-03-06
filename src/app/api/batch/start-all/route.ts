import { NextResponse } from "next/server";
import { engineManager } from "@/lib/engine/manager";

export async function POST() {
  await engineManager.startAll();
  return NextResponse.json({ status: "all_started" });
}
