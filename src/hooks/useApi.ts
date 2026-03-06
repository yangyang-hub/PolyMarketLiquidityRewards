"use client";

import { useCallback } from "react";

async function extractError(method: string, path: string, res: Response): Promise<Error> {
  let msg = `${method} ${path}: ${res.status}`;
  try {
    const body = await res.json();
    if (body.error) msg = body.error;
  } catch {}
  return new Error(msg);
}

export function useApi() {
  const get = useCallback(async <T = any>(path: string): Promise<T> => {
    const res = await fetch(path);
    if (!res.ok) throw await extractError("GET", path, res);
    return res.json();
  }, []);

  const post = useCallback(async <T = any>(path: string, body?: any): Promise<T> => {
    const res = await fetch(path, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw await extractError("POST", path, res);
    return res.json();
  }, []);

  const put = useCallback(async <T = any>(path: string, body: any): Promise<T> => {
    const res = await fetch(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await extractError("PUT", path, res);
    return res.json();
  }, []);

  const del = useCallback(async <T = any>(path: string): Promise<T> => {
    const res = await fetch(path, { method: "DELETE" });
    if (!res.ok) throw await extractError("DELETE", path, res);
    return res.json();
  }, []);

  return { get, post, put, del };
}
