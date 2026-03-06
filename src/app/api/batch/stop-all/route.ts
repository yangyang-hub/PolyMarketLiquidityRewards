import { NextResponse } from "next/server";
import { engineManager } from "@/lib/engine/manager";

export async function POST() {
  await engineManager.stopAll();
  return NextResponse.json({ status: "all_stopped" });
}
