"use client";

// Browser-side helpers.

export function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function getBuyerId(): string {
  try {
    let id = window.localStorage.getItem("counter_buyer");
    if (!id) {
      id = `web_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
      window.localStorage.setItem("counter_buyer", id);
    }
    return id;
  } catch {
    return "web_guest";
  }
}

export function newBuyerId(): string {
  try {
    window.localStorage.removeItem("counter_buyer");
  } catch {
    /* ignore */
  }
  return getBuyerId();
}

export function adminToken(): string {
  try {
    return window.localStorage.getItem("counter_admin") || "";
  } catch {
    return "";
  }
}

export function setAdminToken(v: string) {
  try {
    window.localStorage.setItem("counter_admin", v);
  } catch {
    /* ignore */
  }
}

export async function api<T>(url: string, init?: { method?: string; body?: unknown; admin?: boolean }): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers["Content-Type"] = "application/json";
  if (init?.admin) headers["x-admin-token"] = adminToken();
  const res = await fetch(url, {
    method: init?.method || (init?.body !== undefined ? "POST" : "GET"),
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

export interface PublicStep {
  id: string;
  label: string;
  unitPrice: number;
  condition: string;
}

export interface PublicProduct {
  id: string;
  name: string;
  blurb: string;
  emoji: string;
  listPrice: number;
  stock: number;
  clearance: boolean;
  ladder: PublicStep[];
}

export interface PublicState {
  products: PublicProduct[];
  config: {
    paypal: boolean;
    webhook: boolean;
    llm: boolean;
    sellerModel: string;
    auxModel: string;
    paypalClientId: string | null;
    adminProtected: boolean;
  };
  buyer: null | {
    id: string;
    returning: boolean;
    orders: { id: string; quoteId: string; paypalOrderId: string; status: string; amount: number; note?: string }[];
  };
}
