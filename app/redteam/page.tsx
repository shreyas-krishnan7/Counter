"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import EventGrid, { type EventRow } from "@/components/EventGrid";
import { api, type PublicState } from "@/lib/client";
import type { ProbePoint } from "@/components/ProbeChart";

const ProbeChart = dynamic(() => import("@/components/ProbeChart"), { ssr: false });

interface Attack {
  id: string;
  name: string;
  summary: string;
  usesLlm: boolean;
}

interface Run {
  id: string;
  attack: string;
  shields: "on" | "off";
  startedAt: number;
  finishedAt: number;
  transcript: { role: "attacker" | "seller" | "system"; text: string }[];
  breached: boolean;
  headline: string;
  detail: string;
  series?: ProbePoint[];
  trueFloor?: number;
  publicPrice?: number;
  llm: boolean;
}

type Pair = { off?: Run; on?: Run };

export default function RedTeam() {
  const [attacks, setAttacks] = useState<Attack[]>([]);
  const [selected, setSelected] = useState("jailbreak");
  const [results, setResults] = useState<Record<string, Pair>>({});
  const [running, setRunning] = useState<"" | "off" | "on">("");
  const [error, setError] = useState("");
  const [events, setEvents] = useState<EventRow[]>([]);
  const [cfg, setCfg] = useState<PublicState["config"] | null>(null);

  const loadEvents = useCallback(async () => {
    try {
      const d = await api<{ events: EventRow[] }>("/api/admin/state", { admin: true });
      setEvents(d.events);
    } catch {
      /* the console page handles token prompts */
    }
  }, []);

  useEffect(() => {
    api<{ attacks: Attack[]; runs: Run[] }>("/api/redteam", { admin: true })
      .then((d) => {
        setAttacks(d.attacks);
        const latest: Record<string, Pair> = {};
        for (const r of [...d.runs].reverse()) latest[r.attack] = { ...latest[r.attack], [r.shields]: r };
        setResults(latest);
      })
      .catch((e) => setError((e as Error).message));
    api<PublicState>("/api/state").then((s) => setCfg(s.config)).catch(() => {});
    loadEvents();
  }, [loadEvents]);

  async function run(shields: "off" | "on") {
    setRunning(shields);
    setError("");
    try {
      const { run: r } = await api<{ run: Run }>("/api/redteam", { admin: true, body: { attack: selected, shields } });
      setResults((prev) => ({ ...prev, [selected]: { ...prev[selected], [shields]: r } }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning("");
      loadEvents();
    }
  }

  async function runBoth() {
    await run("off");
    await run("on");
  }

  const attack = attacks.find((a) => a.id === selected);
  const pair = results[selected] ?? {};
  const runIds = [pair.off?.id, pair.on?.id].filter(Boolean) as string[];
  const runEvents = events.filter((e) => e.runId && runIds.includes(e.runId));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Red Team console</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Launch hostile buyer agents at your own shop. Each attack runs twice: against a deliberately unguarded
          agent that holds PayPal&apos;s Agent Toolkit directly, and against the same agent behind Counter.
        </p>
      </div>

      {cfg && (!cfg.llm || !cfg.paypal) && (
        <div className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn">
          {!cfg.llm && "No AI model key: the agents use a scripted rule-based stand-in. "}
          {!cfg.paypal && "No PayPal credentials: orders the unguarded agent creates are simulated and labelled as such. "}
          The quote engine, signatures, filter and webhook checks are real either way.
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-5">
        {attacks.map((a) => {
          const p = results[a.id];
          return (
            <button
              key={a.id}
              onClick={() => setSelected(a.id)}
              className={`card p-4 text-left transition ${selected === a.id ? "border-brand ring-2 ring-brand-soft" : "hover:border-[#c5ccd8]"}`}
            >
              <div className="font-bold leading-snug">{a.name}</div>
              <div className="mt-2 flex flex-wrap gap-1">
                {p?.off && <span className={`badge ${p.off.breached ? "badge-bad" : "badge-mute"}`}>off: {p.off.breached ? "breached" : "held"}</span>}
                {p?.on && <span className={`badge ${p.on.breached ? "badge-bad" : "badge-ok"}`}>on: {p.on.breached ? "breached" : "blocked"}</span>}
                {!p && <span className="badge badge-mute">not run</span>}
              </div>
            </button>
          );
        })}
      </div>

      {attack && (
        <div className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <h2 className="text-lg font-bold">{attack.name}</h2>
              <p className="mt-1 text-sm text-muted">{attack.summary}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-danger" disabled={!!running} onClick={() => run("off")}>
                {running === "off" ? "Running..." : "Run with shields off"}
              </button>
              <button className="btn btn-primary" disabled={!!running} onClick={() => run("on")}>
                {running === "on" ? "Running..." : "Run with shields on"}
              </button>
              <button className="btn" disabled={!!running} onClick={runBoth}>Run both</button>
            </div>
          </div>
          {error && <div className="mt-3 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{error}</div>}

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <RunPanel title="Shields off - unguarded agent" run={pair.off} busy={running === "off"} kind="off" />
            <RunPanel title="Shields on - behind Counter" run={pair.on} busy={running === "on"} kind="on" />
          </div>

          {selected === "probe" && (pair.off?.series || pair.on?.series) && (
            <div className="mt-5 space-y-3">
              <ProbeChart
                off={pair.off?.series}
                on={pair.on?.series}
                floor={pair.off?.trueFloor ?? pair.on?.trueFloor}
                publicPrice={pair.on?.publicPrice ?? pair.off?.publicPrice}
              />
              <p className="rounded-lg bg-ok-soft px-4 py-3 text-sm font-medium text-ok">
                Probing reveals only the ladder, which is public anyway. The floor is never involved in any decision a
                buyer can observe.
              </p>
            </div>
          )}
        </div>
      )}

      <div>
        <h2 className="mb-2 font-bold">Decision log for these runs</h2>
        <EventGrid rows={runEvents} height={360} />
      </div>
    </div>
  );
}

function RunPanel({ title, run, busy, kind }: { title: string; run?: Run; busy: boolean; kind: "on" | "off" }) {
  return (
    <div className={`rounded-xl border p-4 ${kind === "off" ? "border-bad/25 bg-bad-soft/40" : "border-ok/25 bg-ok-soft/40"}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold">{title}</h3>
        {run && <span className={`badge ${run.breached ? "badge-bad" : "badge-ok"}`}>{run.breached ? "BREACHED" : kind === "on" ? "BLOCKED" : "HELD"}</span>}
      </div>
      {busy && <p className="mt-3 text-sm text-muted">Attack in progress...</p>}
      {!run && !busy && <p className="mt-3 text-sm text-muted">Not run yet.</p>}
      {run && !busy && (
        <>
          <p className={`mt-3 font-bold ${run.breached ? "text-bad" : "text-ok"}`}>{run.headline}</p>
          <p className="mt-1 text-xs text-muted">{run.detail}</p>
          <div className="mt-3 max-h-72 space-y-2 overflow-y-auto rounded-lg bg-white p-3 text-xs">
            {run.transcript.map((l, i) => (
              <div key={i}>
                <span
                  className={`mr-2 font-bold uppercase ${
                    l.role === "attacker" ? "text-bad" : l.role === "seller" ? "text-brand" : "text-muted"
                  }`}
                >
                  {l.role === "attacker" ? "Attacker" : l.role === "seller" ? "Seller" : "Note"}
                </span>
                <span className="whitespace-pre-wrap">{l.text || "(no reply)"}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">
            {((run.finishedAt - run.startedAt) / 1000).toFixed(1)}s · {run.llm ? "live AI agents" : "scripted stand-in agents"}
          </p>
        </>
      )}
    </div>
  );
}
