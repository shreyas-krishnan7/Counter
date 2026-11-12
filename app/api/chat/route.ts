import { sellerTurn } from "@/lib/agent";
import { logEvent } from "@/lib/store";
import { body, cleanId, errorResponse, json } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const input = await body<{ buyerId?: string; message?: string; shields?: string }>(req);
    const buyerId = cleanId(input.buyerId);
    const message = String(input.message || "").slice(0, 2000).trim();
    if (!buyerId || !message) return json({ error: "buyerId and message are required" }, 400);
    const shields = input.shields === "off" ? "off" : "on";
    logEvent({
      shields, channel: "chat", actor: buyerId, type: "buyer.message", verdict: "info",
      reason: "Buyer message received", detail: message.slice(0, 200),
    });
    const turn = await sellerTurn(message, shields, { buyerId, channel: "chat" });
    return json(turn);
  } catch (err) {
    return errorResponse(err);
  }
}
