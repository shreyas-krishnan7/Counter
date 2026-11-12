import { resetDb } from "@/lib/store";
import { resetChats } from "@/lib/agent";
import { adminDenied, json } from "@/lib/http";

export const dynamic = "force-dynamic";

// Clears demo data (quotes, orders, events, runs) and restores the seed catalog.
// It does not touch anything in PayPal.
export async function POST(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  resetDb();
  resetChats();
  return json({ ok: true });
}
