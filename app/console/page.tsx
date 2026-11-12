"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import EventGrid, { gridTheme, type EventRow } from "@/components/EventGrid";
import { adminToken, api, fmt, setAdminToken } from "@/lib/client";

interface Step {
  id: string;
  label: string;
  percentOff: number;
  minQty?: number;
  returning?: boolean;
  clearance?: boolean;
}

interface AdminProduct {
  id: string;
  name: string;
  emoji: string;
  listPrice: number;
  floor: number;
  stock: number;
  clearance: boolean;
  ladder: Step[];
  check: { ok: boolean; errors: string[]; warnings: string[] };
}

interface OrderRow {
  id: string;
  quoteId: string;
  buyerId: string;
  paypalOrderId: string;
  captureId?: string;
  payerId?: string;
  amount: number;
  status: string;
  apiVerified: boolean;
  webhookVerified: boolean;
  createdAt: number;
  note?: string;
}

interface NaiveRow {
  id: string;
  description: string;
  amount: number;
  paid: boolean;
  paypalOrderId?: string;
  simulated: boolean;
  createdAt: number;
}

interface AdminState {
  products: AdminProduct[];
  orders: OrderRow[];
  naiveOrders: NaiveRow[];
  events: EventRow[];
}

type Tab = "events" | "orders" | "products";

export default function Console() {
  const [data, setData] = useState<AdminState | null>(null);
  const [tab, setTab] = useState<Tab>("events");
  const [error, setError] = useState("");
  const [needToken, setNeedToken] = useState(false);
  const [token, setToken] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<AdminState>("/api/admin/state", { admin: true }));
      setError("");
      setNeedToken(false);
    } catch (err) {
      const msg = (err as Error).message;
      if (/token/i.test(msg)) setNeedToken(true);
      else setError(msg);
    }
  }, []);

  useEffect(() => {
    setToken(adminToken());
    load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [load]);

  async function refund(orderId: string) {
    if (!window.confirm("Refund this captured payment through PayPal?")) return;
    try {
      await api("/api/admin/refund", { body: { orderId }, admin: true });
      setNotice("Refund sent to PayPal.");
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function reset() {
    if (!window.confirm("Clear all demo quotes, orders, events and runs? PayPal is not touched.")) return;
    await api("/api/admin/reset", { body: {}, admin: true });
    setNotice("Demo data cleared.");
    load();
  }

  const stats = useMemo(() => {
    const ev = data?.events ?? [];
    return {
      blocked: ev.filter((e) => e.verdict === "block").length,
      breaches: ev.filter((e) => e.verdict === "breach").length,
      paid: (data?.orders ?? []).filter((o) => o.status === "paid").length,
      revenue: (data?.orders ?? []).filter((o) => o.status === "paid").reduce((a, o) => a + o.amount, 0),
    };
  }, [data]);

  const orderCols = useMemo<ColDef<OrderRow>[]>(
    () => [
      { field: "createdAt", headerName: "Created", width: 120, valueFormatter: (p) => new Date(p.value as number).toLocaleTimeString() },
      {
        field: "status", headerName: "Status", width: 150, filter: true,
        cellStyle: (p) => ({
          fontWeight: 700,
          color: p.value === "paid" ? "#0f7a4a" : /refund/.test(String(p.value)) ? "#b42318" : "#92600a",
        }),
      },
      { field: "amount", headerName: "Amount", width: 110, valueFormatter: (p) => fmt(p.value as number) },
      { field: "quoteId", headerName: "Signed quote", width: 160, cellClass: "mono" },
      { field: "paypalOrderId", headerName: "PayPal order", width: 190, cellClass: "mono" },
      { field: "apiVerified", headerName: "API match", width: 110, valueFormatter: (p) => (p.value ? "✓" : "–") },
      { field: "webhookVerified", headerName: "Webhook", width: 105, valueFormatter: (p) => (p.value ? "✓" : "–") },
      { field: "payerId", headerName: "PayPal payer ID", width: 160, cellClass: "mono" },
      { field: "note", headerName: "Note", flex: 1, minWidth: 220, tooltipField: "note" },
      {
        headerName: "Kill switch", width: 120, sortable: false,
        cellRenderer: (p: ICellRendererParams<OrderRow>) =>
          p.data && p.data.captureId && (p.data.status === "paid" || p.data.status === "captured") ? (
            <button className="text-xs font-bold text-bad underline" onClick={() => refund(p.data!.id)}>
              Refund
            </button>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  if (needToken) {
    return (
      <div className="mx-auto max-w-md py-10">
        <div className="card space-y-3 p-6">
          <h1 className="text-xl font-bold">Seller token required</h1>
          <p className="text-sm text-muted">This deployment protects seller pages with ADMIN_TOKEN.</p>
          <input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Seller token" />
          <button
            className="btn btn-primary"
            onClick={() => {
              setAdminToken(token);
              load();
            }}
          >
            Unlock
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Seller console</h1>
          <p className="mt-1 text-sm text-muted">Every decision the engine, the filter and the webhook handler make, live.</p>
        </div>
        <button className="btn" onClick={reset}>Reset demo data</button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Attacks and bad requests blocked" value={String(stats.blocked)} tone="info" />
        <Stat label="Breaches (shields off only)" value={String(stats.breaches)} tone="bad" />
        <Stat label="Verified paid orders" value={String(stats.paid)} tone="ok" />
        <Stat label="Verified revenue" value={fmt(stats.revenue)} tone="ok" />
      </div>

      {notice && <div className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">{notice}</div>}
      {error && <div className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{error}</div>}

      <div className="flex gap-1 border-b border-line">
        {(["events", "orders", "products"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-bold ${
              tab === t ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t === "events" ? "Decision log" : t === "orders" ? "Orders" : "Products and price ladders"}
          </button>
        ))}
      </div>

      {tab === "events" && <EventGrid rows={data?.events ?? []} height={600} />}

      {tab === "orders" && (
        <div className="space-y-6">
          <div style={{ height: 380 }}>
            <AgGridReact<OrderRow>
              theme={gridTheme}
              rowData={data?.orders ?? []}
              columnDefs={orderCols}
              getRowId={(p) => p.data.id}
              defaultColDef={{ sortable: true, resizable: true }}
              overlayNoRowsTemplate="No orders yet. Pay a signed quote in the storefront."
            />
          </div>
          <div className="card p-4">
            <h2 className="font-bold">Orders created by the unguarded agent (shields off)</h2>
            <p className="text-xs text-muted">Kept separate from real orders. These exist only to show what Counter prevents.</p>
            <table className="mt-3 w-full text-left text-sm">
              <thead className="text-xs uppercase text-muted">
                <tr>
                  <th className="py-1">Time</th><th>Item</th><th>Amount</th><th>Marked paid</th><th>PayPal order</th>
                </tr>
              </thead>
              <tbody>
                {(data?.naiveOrders ?? []).slice(0, 15).map((o) => (
                  <tr key={o.id} className="border-t border-line">
                    <td className="py-1.5">{new Date(o.createdAt).toLocaleTimeString()}</td>
                    <td>{o.description}</td>
                    <td className="font-bold text-bad">{fmt(o.amount)}</td>
                    <td>{o.paid ? "Yes, on the buyer's word" : "No"}</td>
                    <td className="mono text-xs">{o.simulated ? "simulated (no PayPal call)" : o.paypalOrderId}</td>
                  </tr>
                ))}
                {!data?.naiveOrders.length && (
                  <tr><td colSpan={5} className="py-3 text-muted">None yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "products" && (
        <div className="grid gap-4 lg:grid-cols-2">
          {data?.products.map((p) => (
            <ProductEditor key={p.id} product={p} onSaved={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "ok" | "bad" | "info" }) {
  const color = tone === "ok" ? "text-ok" : tone === "bad" ? "text-bad" : "text-brand";
  return (
    <div className="card p-4">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="mt-1 text-xs text-muted">{label}</div>
    </div>
  );
}

function ProductEditor({ product, onSaved }: { product: AdminProduct; onSaved: () => void }) {
  const [list, setList] = useState((product.listPrice / 100).toFixed(2));
  const [floor, setFloor] = useState((product.floor / 100).toFixed(2));
  const [clearance, setClearance] = useState(product.clearance);
  const [ladder, setLadder] = useState<Step[]>(product.ladder);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  function patch(i: number, change: Partial<Step>) {
    setDirty(true);
    setLadder((l) => l.map((s, idx) => (idx === i ? { ...s, ...change } : s)));
  }

  async function save() {
    try {
      const res = await api<{ check: { warnings: string[] } }>("/api/admin/product", {
        admin: true,
        body: {
          id: product.id,
          listPrice: Math.round(Number(list) * 100),
          floor: Math.round(Number(floor) * 100),
          clearance,
          ladder,
        },
      });
      setMsg({ ok: true, text: res.check.warnings.length ? `Saved. Warning: ${res.check.warnings.join(" ")}` : "Saved. Every step is at or above your floor." });
      setDirty(false);
      onSaved();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  }

  const listCents = Math.round(Number(list) * 100) || 0;

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center gap-2">
        <span className="text-2xl">{product.emoji}</span>
        <h3 className="font-bold">{product.name}</h3>
        <span className="badge badge-mute ml-auto">{product.stock} in stock</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-semibold text-muted">
          List price (USD)
          <input className="input mt-1" value={list} onChange={(e) => { setList(e.target.value); setDirty(true); }} />
        </label>
        <label className="text-xs font-semibold text-muted">
          Private floor (USD) - never shown to buyers
          <input className="input mt-1" value={floor} onChange={(e) => { setFloor(e.target.value); setDirty(true); }} />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={clearance} onChange={(e) => { setClearance(e.target.checked); setDirty(true); }} />
        Slow-moving item (unlocks clearance steps for everyone)
      </label>

      <div>
        <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Public price ladder</div>
        <div className="space-y-2">
          {ladder.map((s, i) => (
            <div key={i} className="grid grid-cols-12 items-center gap-2 rounded-lg bg-paper p-2 text-xs">
              <input className="input col-span-4" value={s.label} onChange={(e) => patch(i, { label: e.target.value })} aria-label="Step label" />
              <div className="col-span-2 flex items-center gap-1">
                <input className="input" value={s.percentOff} onChange={(e) => patch(i, { percentOff: Number(e.target.value) || 0 })} aria-label="Percent off" />%
              </div>
              <div className="col-span-2 flex items-center gap-1">
                qty≥
                <input className="input" value={s.minQty ?? 1} onChange={(e) => patch(i, { minQty: Number(e.target.value) || 1 })} aria-label="Minimum quantity" />
              </div>
              <label className="col-span-2 flex items-center gap-1">
                <input type="checkbox" checked={!!s.returning} onChange={(e) => patch(i, { returning: e.target.checked })} /> returning
              </label>
              <div className="mono col-span-2 text-right font-bold">{fmt(Math.round((listCents * (100 - s.percentOff)) / 100))}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <button
            className="btn"
            onClick={() => {
              setDirty(true);
              setLadder((l) => [...l, { id: `step${l.length}`, label: "New step", percentOff: 0, minQty: 2 }]);
            }}
          >
            Add step
          </button>
          {ladder.length > 1 && (
            <button className="btn" onClick={() => { setDirty(true); setLadder((l) => l.slice(0, -1)); }}>Remove last</button>
          )}
          <button className="btn btn-primary ml-auto" onClick={save} disabled={!dirty}>Validate and save</button>
        </div>
      </div>
      {msg && (
        <div className={`rounded-lg px-3 py-2 text-xs font-medium ${msg.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>{msg.text}</div>
      )}
      <p className="text-xs text-muted">
        The floor is checked here, once, when you save. It is never read when a buyer asks for a price.
      </p>
    </div>
  );
}
