import { NextResponse } from "next/server";
import { engineManager } from "@/lib/engine/manager";
import type { StrategyConfig } from "@/lib/types";

function numberInRange(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

function integerInRange(value: unknown, min: number, max: number): number | undefined {
  const n = numberInRange(value, min, max);
  return n == null ? undefined : Math.floor(n);
}

function sanitizeConfig(body: Record<string, unknown>): Partial<StrategyConfig> {
  const partial: Partial<StrategyConfig> = {};

  const cancelDepthLevel = integerInRange(body.cancelDepthLevel, 0, 20);
  if (cancelDepthLevel != null) partial.cancelDepthLevel = cancelDepthLevel;

  const minBookNotionalUsd = numberInRange(body.minBookNotionalUsd, 0, 1_000_000);
  if (minBookNotionalUsd != null) partial.minBookNotionalUsd = minBookNotionalUsd;

  const volumeDropWindowSec = numberInRange(body.volumeDropWindowSec, 1, 120);
  if (volumeDropWindowSec != null) partial.volumeDropWindowSec = volumeDropWindowSec;

  const volumeDropPercent = numberInRange(body.volumeDropPercent, 0, 100);
  if (volumeDropPercent != null) partial.volumeDropPercent = volumeDropPercent;

  const buyPressureWindowSec = numberInRange(body.buyPressureWindowSec, 1, 120);
  if (buyPressureWindowSec != null) partial.buyPressureWindowSec = buyPressureWindowSec;

  const buyPressureUsd = numberInRange(body.buyPressureUsd, 0, 1_000_000);
  if (buyPressureUsd != null) partial.buyPressureUsd = buyPressureUsd;

  const cancelFollowWindowSec = numberInRange(body.cancelFollowWindowSec, 1, 120);
  if (cancelFollowWindowSec != null) partial.cancelFollowWindowSec = cancelFollowWindowSec;

  const cancelFollowDropPercent = numberInRange(body.cancelFollowDropPercent, 0, 100);
  if (cancelFollowDropPercent != null) partial.cancelFollowDropPercent = cancelFollowDropPercent;

  const cancelFollowDepthLevels = integerInRange(body.cancelFollowDepthLevels, 1, 100);
  if (cancelFollowDepthLevels != null) partial.cancelFollowDepthLevels = cancelFollowDepthLevels;

  if (typeof body.orderResetEnabled === "boolean") {
    partial.orderResetEnabled = body.orderResetEnabled;
  }

  const orderResetMinMinutes = numberInRange(body.orderResetMinMinutes, 1, 1440);
  if (orderResetMinMinutes != null) partial.orderResetMinMinutes = orderResetMinMinutes;

  const orderResetMaxMinutes = numberInRange(body.orderResetMaxMinutes, 1, 1440);
  if (orderResetMaxMinutes != null) partial.orderResetMaxMinutes = orderResetMaxMinutes;

  if (
    partial.orderResetMinMinutes != null &&
    partial.orderResetMaxMinutes != null &&
    partial.orderResetMaxMinutes < partial.orderResetMinMinutes
  ) {
    partial.orderResetMaxMinutes = partial.orderResetMinMinutes;
  }

  return partial;
}

export async function GET() {
  return NextResponse.json({ config: engineManager.getConfig() });
}

export async function PUT(request: Request) {
  const body = await request.json();
  const configBody = typeof body === "object" && body !== null
    ? body as Record<string, unknown>
    : {};
  engineManager.updateConfig(sanitizeConfig(configBody));
  return NextResponse.json({ config: engineManager.getConfig() });
}
