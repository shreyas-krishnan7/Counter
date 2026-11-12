import Anthropic from "@anthropic-ai/sdk";

// Model access. Two providers are supported:
//   - Groq (OpenAI-compatible chat completions), used when GROQ_API_KEY is set
//   - Claude (Anthropic SDK), used when ANTHROPIC_API_KEY is set
// Set LLM_PROVIDER=groq or LLM_PROVIDER=anthropic to force one when both keys exist.
// The seller agent runs on SELLER_MODEL; the red-team attacker and the outbound
// policy check run on the smaller AUX_MODEL.

export type Provider = "groq" | "anthropic" | "none";

export function provider(): Provider {
  const forced = (process.env.LLM_PROVIDER || "").toLowerCase();
  const hasGroq = Boolean(process.env.GROQ_API_KEY);
  const hasClaude = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  if (forced === "groq" && hasGroq) return "groq";
  if (forced === "anthropic" && hasClaude) return "anthropic";
  if (hasGroq) return "groq";
  if (hasClaude) return "anthropic";
  return "none";
}

const DEFAULTS: Record<Exclude<Provider, "none">, { seller: string; aux: string }> = {
  groq: { seller: "openai/gpt-oss-120b", aux: "openai/gpt-oss-20b" },
  anthropic: { seller: "claude-opus-5-5", aux: "claude-haiku-5-5" },
};

function pick(kind: "seller" | "aux"): string {
  const override = kind === "seller" ? process.env.SELLER_MODEL : process.env.AUX_MODEL;
  if (override) return override;
  const p = provider();
  return p === "none" ? "offline" : DEFAULTS[p][kind];
}

export const SELLER_MODEL = pick("seller");
export const AUX_MODEL = pick("aux");

export function llmAvailable(): boolean {
  return provider() !== "none";
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Msg = { role: string; content: any; [key: string]: any };

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AgentResult {
  text: string;
  refused: boolean;
  steps: number;
}

interface AgentOpts {
  model: string;
  system: string;
  history: Msg[];
  userText: string;
  tools: ToolDef[];
  exec: (name: string, input: any) => Promise<string>;
  maxSteps?: number;
}

// ---------------------------------------------------------------------------
// Groq (OpenAI-compatible)
// ---------------------------------------------------------------------------

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// The gpt-oss models reason before answering; keep that short for a chat UI.
function groqExtras(model: string): Record<string, unknown> {
  return /gpt-oss/.test(model) ? { reasoning_effort: "low" } : {};
}

async function groqCall(body: Record<string, unknown>, attempt = 0): Promise<any> {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 429 && attempt < 3) {
    const wait = Math.min(Number(res.headers.get("retry-after")) || 2 + attempt * 2, 15);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return groqCall(body, attempt + 1);
  }
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    // The model sometimes emits a malformed tool call; one retry usually fixes it.
    if (res.status === 400 && json?.error?.code === "tool_use_failed" && attempt < 2) return groqCall(body, attempt + 1);
    throw new Error(`Groq error ${res.status}: ${json?.error?.message || "request failed"}`);
  }
  return json;
}

async function groqAgent(opts: AgentOpts): Promise<AgentResult> {
  const { history } = opts;
  history.push({ role: "user", content: opts.userText });
  const maxSteps = opts.maxSteps ?? 6;
  const tools = opts.tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
  let text = "";

  for (let step = 1; step <= maxSteps; step++) {
    const json = await groqCall({
      model: opts.model,
      messages: [{ role: "system", content: opts.system }, ...history],
      ...(tools.length ? { tools, tool_choice: "auto" } : {}),
      temperature: 0.3,
      max_tokens: 4000,
      ...groqExtras(opts.model),
    });
    const msg = json.choices?.[0]?.message || {};
    const calls: any[] = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    text = String(msg.content || "").trim();
    history.push({ role: "assistant", content: msg.content ?? "", ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length) return { text, refused: false, steps: step };

    for (const call of calls) {
      let content: string;
      try {
        const args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
        content = await opts.exec(String(call.function?.name || ""), args ?? {});
      } catch (err) {
        content = `Tool error: ${(err as Error).message}`;
      }
      history.push({ role: "tool", tool_call_id: call.id, content });
    }
  }
  return { text, refused: false, steps: maxSteps };
}

async function groqText(system: string, user: string, maxTokens: number): Promise<string | null> {
  const json = await groqCall({
    model: AUX_MODEL,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    temperature: 0.4,
    max_tokens: Math.max(maxTokens, 2000),
    ...groqExtras(AUX_MODEL),
  });
  const out = String(json.choices?.[0]?.message?.content || "").trim();
  return out || null;
}

// ---------------------------------------------------------------------------
// Claude (Anthropic SDK)
// ---------------------------------------------------------------------------

type G = typeof globalThis & { __anthropic?: Anthropic };
const g = globalThis as G;

function claude(): Anthropic {
  if (!g.__anthropic) g.__anthropic = new Anthropic({ timeout: 60_000, maxRetries: 2 });
  return g.__anthropic;
}

// Server-side refusal fallback is offered on these model families only.
function supportsFallbacks(model: string): boolean {
  return /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);
}

async function claudeCall(args: { model: string; system: string; messages: Msg[]; tools?: ToolDef[]; maxTokens?: number }): Promise<any> {
  const base: any = {
    model: args.model,
    max_tokens: args.maxTokens ?? 8000,
    system: args.system,
    messages: args.messages,
    output_config: { effort: "low" },
  };
  if (args.tools?.length) base.tools = args.tools;

  if (supportsFallbacks(args.model)) {
    try {
      return await claude().beta.messages.create({
        ...base,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    } catch (err) {
      // If this account or platform rejects the fallback beta, retry the plain request.
      if (!(err instanceof Anthropic.BadRequestError)) throw err;
    }
  }
  return claude().messages.create(base);
}

async function claudeAgent(opts: AgentOpts): Promise<AgentResult> {
  const { history } = opts;
  history.push({ role: "user", content: opts.userText });
  const maxSteps = opts.maxSteps ?? 6;
  let text = "";

  for (let step = 1; step <= maxSteps; step++) {
    const res = await claudeCall({ model: opts.model, system: opts.system, messages: history, tools: opts.tools });

    if (res.stop_reason === "refusal") {
      // Keep the history valid: a user turn must be followed by an assistant turn.
      history.push({ role: "assistant", content: [{ type: "text", text: "(no reply)" }] });
      return { text: "", refused: true, steps: step };
    }

    history.push({ role: "assistant", content: res.content });
    text = res.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();

    if (res.stop_reason === "pause_turn") continue;
    const toolUses = res.content.filter((b: any) => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !toolUses.length) return { text, refused: false, steps: step };

    const results = [];
    for (const tu of toolUses) {
      let content: string;
      let isError = false;
      try {
        content = await opts.exec(tu.name, tu.input ?? {});
      } catch (err) {
        content = `Tool error: ${(err as Error).message}`;
        isError = true;
      }
      results.push({ type: "tool_result", tool_use_id: tu.id, content, is_error: isError });
    }
    history.push({ role: "user", content: results });
  }
  return { text, refused: false, steps: maxSteps };
}

async function claudeText(system: string, user: string, maxTokens: number): Promise<string | null> {
  const res = await claudeCall({ model: AUX_MODEL, system, messages: [{ role: "user", content: user }], maxTokens });
  if (res.stop_reason === "refusal") return null;
  return res.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n")
    .trim();
}

// ---------------------------------------------------------------------------

/**
 * A tool loop. `history` is mutated so the conversation persists across turns.
 * Its message format belongs to the active provider; callers treat it as opaque.
 */
export async function runAgent(opts: AgentOpts): Promise<AgentResult> {
  return provider() === "groq" ? groqAgent(opts) : claudeAgent(opts);
}

/** One-shot text completion on the auxiliary model. Returns null when the model gives no answer. */
export async function quickText(system: string, user: string, maxTokens = 2000): Promise<string | null> {
  return provider() === "groq" ? groqText(system, user, maxTokens) : claudeText(system, user, maxTokens);
}
