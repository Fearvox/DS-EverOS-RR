// HTTP utilities for request handling and response building

import type { ApiResponse } from "./types";

export function jsonResponse<T>(data: T, status = 200): Response {
  const body: ApiResponse<T> = { success: status < 400, data };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errorResponse(error: string, status: number): Response {
  const body: ApiResponse = { success: false, error };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function metaResponse<T>(data: T, meta: ApiResponse["meta"], status = 200): Response {
  const body: ApiResponse<T> = { success: true, data, meta };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function parseBody<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function getPathSegments(req: Request): string[] {
  const url = new URL(req.url);
  return url.pathname.split("/").filter(Boolean);
}

export function getQueryParams(req: Request): URLSearchParams {
  return new URL(req.url).searchParams;
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}
