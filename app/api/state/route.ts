import { db, getBuyer } from "@/lib/store";
import { publicLadder } from "@/lib/engine";
import { paypalConfigured, webhookConfigured } from "@/lib/paypal";
import { AUX_MODEL, llmAvailable, SELLER_MODEL } from "@/lib/llm";
import { cleanId, json } from "@/lib/http";

export const dynamic = "force-dynamic";

// Public state. Never includes the floor.
export async function GET(req: Request) {
  const buyerId = cleanId(new URL(req.url).searchParams.get("buyer"));
  const d = db();
  return json({
    products: d.products.map((p) => ({
      id: p.id, name: p.name, blurb: p.blurb, emoji: p.emoji, listPrice: p.listPrice,
      stock: p.stock, clearance: p.clearance, ladder: publicLadder(p),
    })),
    config: {
      paypal: paypalConfigured(),
      webhook: webhookConfigured(),
      llm: llmAvailable(),
      sellerModel: SELLER_MODEL,
      auxModel: AUX_MODEL,
      paypalClientId: process.env.PAYPAL_CLIENT_ID || null,
      adminProtected: Boolean(process.env.ADMIN_TOKEN),
    },
    buyer: buyerId
      ? {
          id: buyerId,
          returning: getBuyer(buyerId).paidOrders > 0,
          orders: d.orders
            .filter((o) => o.buyerId === buyerId)
            .map((o) => ({ id: o.id, quoteId: o.quoteId, paypalOrderId: o.paypalOrderId, status: o.status, amount: o.amount, note: o.note })),
        }
      : null,
  });
}
