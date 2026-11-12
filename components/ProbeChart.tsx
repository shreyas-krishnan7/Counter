"use client";

import { AgCharts } from "ag-charts-react";
import { AllCommunityModule, ModuleRegistry, type AgChartOptions } from "ag-charts-community";

ModuleRegistry.registerModules([AllCommunityModule]);

export interface ProbePoint {
  n: number;
  offer: number;
  accepted: boolean;
  estimate: number;
}

interface Props {
  off?: ProbePoint[];
  on?: ProbePoint[];
  floor?: number;
  publicPrice?: number;
}

/**
 * The attacker's best estimate of the seller's minimum price after each offer.
 * Shields off: the estimate walks down to the secret floor.
 * Shields on: it never leaves the public list price.
 */
export default function ProbeChart({ off, on, floor, publicPrice }: Props) {
  const length = Math.max(off?.length ?? 0, on?.length ?? 0);
  const data = Array.from({ length }, (_, i) => ({
    n: i + 1,
    off: off?.[i] ? off[i].estimate / 100 : undefined,
    on: on?.[i] ? on[i].estimate / 100 : undefined,
    floor: floor !== undefined ? floor / 100 : undefined,
    list: publicPrice !== undefined ? publicPrice / 100 : undefined,
  }));

  const options: AgChartOptions = {
    data,
    height: 320,
    title: { text: "What the attacker learns with each offer" },
    subtitle: { text: "Attacker's estimate of the lowest acceptable price (USD)" },
    series: [
      { type: "line", xKey: "n", yKey: "off", yName: "Shields off: estimate", stroke: "#b42318", strokeWidth: 3, marker: { fill: "#b42318", stroke: "#b42318" } },
      { type: "line", xKey: "n", yKey: "on", yName: "Shields on: estimate", stroke: "#0f7a4a", strokeWidth: 3, marker: { fill: "#0f7a4a", stroke: "#0f7a4a" } },
      { type: "line", xKey: "n", yKey: "floor", yName: "Seller's secret floor", stroke: "#5b6477", strokeWidth: 2, lineDash: [6, 4], marker: { enabled: false } },
    ],
    legend: { position: "bottom" },
  };

  return (
    <div className="rounded-xl border border-line bg-white p-2">
      <AgCharts options={options} />
    </div>
  );
}
