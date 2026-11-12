import { getProduct, logEvent, save } from "@/lib/store";
import { validateLadder } from "@/lib/engine";
import { adminDenied, body, json } from "@/lib/http";
import type { LadderStep, Product } from "@/lib/types";

export const dynamic = "force-dynamic";

// Saving a product is the single moment the floor is consulted: the ladder is
// rejected if any step would sell below it.
export async function POST(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  const input = await body<Partial<Product>>(req);
  const current = getProduct(String(input.id || ""));
  if (!current) return json({ error: "Unknown product" }, 404);

  const ladder: LadderStep[] = Array.isArray(input.ladder)
    ? input.ladder.slice(0, 8).map((s, i) => ({
        id: String(s.id || `step${i}`).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20) || `step${i}`,
        label: String(s.label || `Step ${i + 1}`).slice(0, 60),
        percentOff: Number(s.percentOff) || 0,
        ...(Number(s.minQty) > 1 ? { minQty: Math.floor(Number(s.minQty)) } : {}),
        ...(s.returning ? { returning: true } : {}),
        ...(s.clearance ? { clearance: true } : {}),
      }))
    : current.ladder;

  const candidate: Product = {
    ...current,
    listPrice: Number.isFinite(Number(input.listPrice)) ? Math.round(Number(input.listPrice)) : current.listPrice,
    floor: Number.isFinite(Number(input.floor)) ? Math.round(Number(input.floor)) : current.floor,
    stock: Number.isFinite(Number(input.stock)) ? Math.max(0, Math.floor(Number(input.stock))) : current.stock,
    clearance: typeof input.clearance === "boolean" ? input.clearance : current.clearance,
    ladder,
  };
  const check = validateLadder(candidate);
  if (!check.ok) {
    logEvent({
      shields: "on", channel: "admin", actor: "seller", type: "ladder.rejected", verdict: "block",
      reason: check.errors[0], detail: candidate.name,
    });
    return json({ error: check.errors.join(" "), check }, 400);
  }
  Object.assign(current, candidate);
  save();
  logEvent({
    shields: "on", channel: "admin", actor: "seller", type: "ladder.saved", verdict: "allow",
    reason: "Ladder validated against the floor and saved", detail: candidate.name,
  });
  return json({ ok: true, check });
}
