"use client";

import { useEffect, useState } from "react";

const TOOLS = [
  ["search_catalog", "List products, list prices and stock."],
  ["get_price_ladder", "The public price ladder for a product and what unlocks each step."],
  ["request_quote", "Ask for a signed quote, optionally with an offer. Accepted only at or above the ladder step you qualify for."],
  ["checkout", "Turn a signed quote into a PayPal order. Returns an approval link for a human."],
  ["order_status", "Verified payment status, straight from PayPal."],
  ["submit_payment_proof", "Claim a payment. Checked against PayPal's records, never taken on trust."],
  ["get_policies", "The approved returns, shipping and warranty text."],
];

export default function Connect() {
  const [origin, setOrigin] = useState("https://your-app.onrender.com");
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin}/api/mcp?key=my-agent`;

  const curl = `curl -s ${origin}/api/mcp?key=my-agent \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"request_quote","arguments":{"product_id":"kb-k2","quantity":2,"offer_unit_price":60}}}'`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Connect a buyer agent</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          This shop is also a Model Context Protocol server, so any AI agent can browse, negotiate and check out
          here. This is real agent-to-agent commerce: the buyer&apos;s agent talks to the seller&apos;s engine, and
          the buyer&apos;s human approves the PayPal payment.
        </p>
      </div>

      <div className="card space-y-3 p-5">
        <h2 className="font-bold">MCP endpoint (Streamable HTTP)</h2>
        <pre className="overflow-x-auto rounded-lg bg-ink p-3 text-sm text-white"><code>{url}</code></pre>
        <p className="text-sm text-muted">
          The <code>key</code> identifies your agent. Returning-customer pricing follows the key once it has a
          PayPal-verified order.
        </p>
        <h3 className="pt-2 text-sm font-bold">Add it to Claude Code</h3>
        <pre className="overflow-x-auto rounded-lg bg-ink p-3 text-sm text-white"><code>{`claude mcp add --transport http counter-shop "${url}"`}</code></pre>
        <h3 className="pt-2 text-sm font-bold">Or call it directly</h3>
        <pre className="overflow-x-auto rounded-lg bg-ink p-3 text-xs text-white"><code>{curl}</code></pre>
      </div>

      <div className="card p-5">
        <h2 className="font-bold">Tools</h2>
        <table className="mt-3 w-full text-left text-sm">
          <tbody>
            {TOOLS.map(([name, text]) => (
              <tr key={name} className="border-t border-line">
                <td className="mono whitespace-nowrap py-2 pr-4 font-semibold">{name}</td>
                <td className="py-2 text-muted">{text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card p-5 text-sm">
        <h2 className="font-bold">Why a hostile agent gets nowhere here</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
          <li>There is no free-text seller model on this channel, so there is nothing to jailbreak.</li>
          <li>Offers are compared with the public ladder only. Probing cannot reach the seller&apos;s floor.</li>
          <li>Checkout takes a quote ID and signature. Amounts in the request are ignored.</li>
          <li>Payment status comes from PayPal, not from anything the agent says.</li>
        </ul>
      </div>
    </div>
  );
}
