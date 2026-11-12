import { db } from "@/lib/store";
import { publicLadder, validateLadder } from "@/lib/engine";
import { adminDenied, json } from "@/lib/http";

export const dynamic = "force-dynamic";

// Seller-only view. This is the one response that includes the floor.
export async function GET(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  const d = db();
  return json({
    products: d.products.map((p) => ({ ...p, publicLadder: publicLadder(p), check: validateLadder(p) })),
    orders: [...d.orders].reverse(),
    naiveOrders: [...d.naiveOrders].reverse().slice(0, 100),
    events: d.events.slice(-800).reverse(),
    quotes: d.quotes.slice(-200).reverse().map(({ sig: _sig, ...q }) => { void _sig; return q; }),
    webhooks: d.webhooks.slice(-100).reverse(),
    buyers: Object.values(d.buyers).filter((b) => b.paidOrders > 0),
  });
}
