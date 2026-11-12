import { captureAndReconcile } from "@/lib/checkout";
import { body, cleanId, errorResponse, json } from "@/lib/http";

export const dynamic = "force-dynamic";

// Called after the buyer approves at PayPal. Captures, then re-fetches the
// order from PayPal and compares it with the signed quote.
export async function POST(req: Request) {
  try {
    const input = await body<{ paypalOrderId?: string; buyerId?: string }>(req);
    const order = await captureAndReconcile(cleanId(input.paypalOrderId), cleanId(input.buyerId) || undefined);
    return json({
      orderId: order.id, paypalOrderId: order.paypalOrderId, status: order.status, amount: order.amount,
      apiVerified: order.apiVerified, webhookVerified: order.webhookVerified, note: order.note,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
