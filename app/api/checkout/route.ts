import { createOrderFromQuote } from "@/lib/checkout";
import { body, cleanId, errorResponse, json, originOf } from "@/lib/http";

export const dynamic = "force-dynamic";

// Accepts ONLY a quote ID, its signature and the buyer ID. Any amount in the
// request is ignored: the amount sent to PayPal comes from the stored quote.
export async function POST(req: Request) {
  try {
    const input = await body<{ quoteId?: string; sig?: string; buyerId?: string }>(req);
    const order = await createOrderFromQuote({
      quoteId: cleanId(input.quoteId),
      sig: String(input.sig || ""),
      buyerId: cleanId(input.buyerId),
      origin: originOf(req),
      channel: "chat",
    });
    return json({ orderId: order.id, paypalOrderId: order.paypalOrderId, approveUrl: order.approveUrl, status: order.status });
  } catch (err) {
    return errorResponse(err);
  }
}
