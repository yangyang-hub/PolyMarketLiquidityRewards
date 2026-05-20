"use client";

import { useCallback } from "react";

async function extractError(res: Response): Promise<Error> {
  let msg = `请求失败：状态码 ${res.status}`;
  try {
    const body = await res.json() as { error?: string };
    if (body.error) msg = body.error;
  } catch {}
  return new Error(msg);
}

export function useApi() {
  const get = useCallback(async <T = unknown>(path: string): Promise<T> => {
    const res = await fetch(path);
    if (!res.ok) throw await extractError(res);
    return res.json();
  }, []);

  const post = useCallback(async <T = unknown>(path: string, body?: unknown): Promise<T> => {
    const res = await fetch(path, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw await extractError(res);
    return res.json();
  }, []);

  const put = useCallback(async <T = unknown>(path: string, body: unknown): Promise<T> => {
    const res = await fetch(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await extractError(res);
    return res.json();
  }, []);

  const del = useCallback(async <T = unknown>(path: string): Promise<T> => {
    const res = await fetch(path, { method: "DELETE" });
    if (!res.ok) throw await extractError(res);
    return res.json();
  }, []);

  return { get, post, put, del };
}
