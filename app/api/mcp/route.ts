import crypto from "node:crypto";
import { db, getProduct, logEvent } from "@/lib/store";
import { publicLadder, requestQuote } from "@/lib/engine";
import { checkPaymentClaim, createOrderFromQuote, findOrder, reconcile } from "@/lib/checkout";
import { POLICIES } from "@/lib/filter";
import { fmt } from "@/lib/money";
import { originOf } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The MCP storefront: a Model Context Protocol server (Streamable HTTP,
// stateless, JSON responses) so any buyer agent can shop here.
// Every tool goes through the same quote engine and checkout as the web chat.
// There is no free-text seller model on this channel at all: a buyer agent
// gets structured answers only, so there is nothing to jailbreak.

const TOOLS = [
  {
    name: "search_catalog",
    description: "List products sold by this shop with list prices (USD) and stock.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "get_price_ladder",
    description: "Get the public price ladder for a product: each price and the verifiable condition that unlocks it.",
    inputSchema: { type: "object", properties: { product_id: { type: "string" } }, required: ["product_id"], additionalProperties: false },
  },
  {
    name: "request_quote",
    description:
      "Request a signed quote. Optionally include offer_unit_price (USD). The offer is accepted only if it is at or above the ladder step you qualify for. Returns a quote_id and signature to pass to checkout.",
    inputSchema: {
      type: "object",
      properties: {
        product_id: { type: "string" },
        quantity: { type: "integer", minimum: 1 },
        offer_unit_price: { type: "number" },
      },
      required: ["product_id", "quantity"],
      additionalProperties: false,
    },
  },
  {
    name: "checkout",
    description: "Create a PayPal order from a signed quote. Returns an approval URL for the buyer's human to open and approve.",
    inputSchema: {
      type: "object",
      properties: { quote_id: { type: "string" }, signature: { type: "string" } },
      required: ["quote_id", "signature"],
      additionalProperties: false,
    },
  },
  {
    name: "order_status",
    description: "Get the verified payment status of an order, as confirmed by PayPal.",
    inputSchema: { type: "object", properties: { order_id: { type: "string" } }, required: ["order_id"], additionalProperties: false },
  },
  {
    name: "submit_payment_proof",
    description: "Claim that a payment was made. The claim is checked against PayPal's records; text or screenshots are not accepted as proof.",
    inputSchema: { type: "object", properties: { transaction_id: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "get_policies",
    description: "Get the shop's approved returns, shipping and warranty policies.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

/* eslint-disable @typescript-eslint/no-explicit-any */
async function callTool(name: string, args: any, buyerId: string, origin: string): Promise<unknown> {
  switch (name) {
    case "search_catalog":
      return db().products.map((p) => ({
        product_id: p.id, name: p.name, about: p.blurb, list_price_usd: p.listPrice / 100, in_stock: p.stock > 0,
      }));
    case "get_price_ladder": {
      const p = getProduct(String(args?.product_id || ""));
      if (!p) throw new Error("Unknown product");
      return publicLadder(p).map((s) => ({ label: s.label, unit_price_usd: s.unitPrice / 100, unlocked_by: s.condition }));
    }
    case "request_quote": {
      const offer = args?.offer_unit_price;
      const res = requestQuote({
        buyerId,
        productId: String(args?.product_id || ""),
        qty: Number(args?.quantity || 1),
        offerUnit: offer === undefined || offer === null ? undefined : Math.round(Number(offer) * 100),
        channel: "mcp",
      });
      if (res.decision === "decline") return { accepted: false, message: res.message, hint: "See get_price_ladder for public prices." };
      const q = res.quote;
      return {
        accepted: true, quote_id: q.id, signature: q.sig, unit_price_usd: q.unitAmount / 100, total_usd: q.total / 100,
        quantity: q.qty, ladder_step: res.stepLabel, expires_at: new Date(q.expiresAt).toISOString(),
      };
    }
    case "checkout": {
      const order = await createOrderFromQuote({
        quoteId: String(args?.quote_id || ""), sig: String(args?.signature || ""), buyerId, origin, channel: "mcp",
      });
      return {
        order_id: order.id, paypal_order_id: order.paypalOrderId, total: fmt(order.amount), approval_url: order.approveUrl,
        next: "A human must open approval_url and approve the payment. Then call order_status.",
      };
    }
    case "order_status": {
      const order = findOrder(String(args?.order_id || ""));
      if (!order || order.buyerId !== buyerId) throw new Error("Unknown order");
      if (order.status === "created" || order.status === "captured") {
        try { await reconcile(order); } catch { /* keep last known state */ }
      }
      return { order_id: order.id, status: order.status, paid: order.status === "paid", note: order.note ?? null };
    }
    case "submit_payment_proof": {
      const res = await checkPaymentClaim({ buyerId, claimedId: String(args?.transaction_id || ""), channel: "mcp" });
      return { verified: res.verified, message: res.reason };
    }
    case "get_policies":
      return POLICIES;
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function rpc(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function handle(msg: any, buyerId: string, origin: string): Promise<unknown | null> {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg?.id, -32600, "Invalid request");
  const isNotification = msg.id === undefined || msg.id === null;
  switch (msg.method) {
    case "initialize":
      return rpc(msg.id, {
        protocolVersion: typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "counter-storefront", version: "1.0.0" },
        instructions:
          "A shop protected by Counter. Use request_quote then checkout. Prices come only from signed quotes; payment is confirmed only by PayPal.",
      });
    case "ping":
      return rpc(msg.id, {});
    case "tools/list":
      return rpc(msg.id, { tools: TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name || "");
      try {
        const out = await callTool(name, msg.params?.arguments || {}, buyerId, origin);
        return rpc(msg.id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], isError: false });
      } catch (err) {
        return rpc(msg.id, { content: [{ type: "text", text: (err as Error).message }], isError: true });
      }
    }
    default:
      if (isNotification) return null;
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || req.headers.get("x-agent-key") || "anonymous";
  const buyerId = `mcp_${crypto.createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }
  const origin = originOf(req);
  if (Array.isArray(payload)) {
    const out = (await Promise.all(payload.map((m) => handle(m, buyerId, origin)))).filter((x) => x !== null);
    return out.length ? Response.json(out) : new Response(null, { status: 202 });
  }
  if (payload?.method === "tools/call") {
    logEvent({
      shields: "on", channel: "mcp", actor: buyerId, type: `mcp.${payload.params?.name}`, verdict: "info",
      reason: "Buyer agent called a storefront tool", detail: JSON.stringify(payload.params?.arguments || {}).slice(0, 200),
    });
  }
  const out = await handle(payload, buyerId, origin);
  return out === null ? new Response(null, { status: 202 }) : Response.json(out);
}

export async function GET() {
  // This server answers every request directly and does not open SSE streams.
  return new Response("This MCP endpoint accepts JSON-RPC over POST.", { status: 405, headers: { Allow: "POST" } });
}
