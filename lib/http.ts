import { CheckoutError } from "./checkout";
import { PayPalError } from "./paypal";

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function originOf(req: Request): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (host) return `${proto || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https")}://${host}`;
  return new URL(req.url).origin;
}

/** Optional protection for seller-only routes. If ADMIN_TOKEN is unset the demo is open. */
export function adminDenied(req: Request): Response | null {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return null;
  if (req.headers.get("x-admin-token") === token) return null;
  return json({ error: "Seller token required" }, 401);
}

export function errorResponse(err: unknown): Response {
  if (err instanceof CheckoutError) return json({ error: err.message }, err.status);
  if (err instanceof PayPalError) return json({ error: err.message }, err.status >= 400 && err.status < 600 ? err.status : 502);
  const message = err instanceof Error ? err.message : "Unexpected error";
  console.error("[counter]", err);
  return json({ error: message }, 500);
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

export function cleanId(v: unknown, fallback = ""): string {
  const s = String(v ?? "").trim();
  return /^[A-Za-z0-9_:-]{1,80}$/.test(s) ? s : fallback;
}
