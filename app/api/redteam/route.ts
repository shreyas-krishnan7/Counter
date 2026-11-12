import { ATTACKS, runAttack, type AttackId } from "@/lib/redteam";
import { db } from "@/lib/store";
import { adminDenied, body, errorResponse, json } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  return json({ attacks: ATTACKS, runs: db().runs.slice(-20).reverse() });
}

export async function POST(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  try {
    const input = await body<{ attack?: string; shields?: string }>(req);
    const attack = ATTACKS.find((a) => a.id === input.attack);
    if (!attack) return json({ error: "Unknown attack" }, 400);
    const run = await runAttack(attack.id as AttackId, input.shields === "off" ? "off" : "on");
    return json({ run });
  } catch (err) {
    return errorResponse(err);
  }
}
