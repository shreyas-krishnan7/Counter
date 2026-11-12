"use client";

import { useMemo } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);

export interface EventRow {
  id: string;
  ts: number;
  shields: "on" | "off";
  channel: string;
  actor: string;
  type: string;
  verdict: "allow" | "block" | "info" | "breach";
  reason: string;
  detail?: string;
  runId?: string;
}

const VERDICT_STYLE: Record<string, { background: string; color: string }> = {
  allow: { background: "#e3f5ec", color: "#0f7a4a" },
  block: { background: "#e8edfb", color: "#1d3a8a" },
  breach: { background: "#fde8e6", color: "#b42318" },
  info: { background: "transparent", color: "#5b6477" },
};

const VERDICT_LABEL: Record<string, string> = { allow: "ALLOWED", block: "BLOCKED", breach: "BREACH", info: "info" };

export const gridTheme = themeQuartz.withParams({
  fontFamily: "inherit",
  fontSize: 13,
  headerFontWeight: 700,
  borderRadius: 10,
  wrapperBorderRadius: 12,
});

/** The live decision log: every quote, block, webhook verdict and breach. */
export default function EventGrid({ rows, height = 520 }: { rows: EventRow[]; height?: number }) {
  const cols = useMemo<ColDef<EventRow>[]>(
    () => [
      {
        field: "ts", headerName: "Time", width: 110, sort: "desc",
        valueFormatter: (p) => new Date(p.value as number).toLocaleTimeString(),
      },
      {
        field: "verdict", headerName: "Verdict", width: 115, filter: true,
        valueFormatter: (p) => VERDICT_LABEL[p.value as string] ?? String(p.value),
        cellStyle: (p) => ({ ...VERDICT_STYLE[p.value as string], fontWeight: 700 }),
      },
      {
        field: "shields", headerName: "Shields", width: 100, filter: true,
        valueFormatter: (p) => String(p.value).toUpperCase(),
        cellStyle: (p) => ({ color: p.value === "off" ? "#b42318" : "#0f7a4a", fontWeight: 700 }),
      },
      { field: "channel", headerName: "Channel", width: 110, filter: true },
      { field: "actor", headerName: "Actor", width: 170, filter: true },
      { field: "type", headerName: "Event", width: 220, filter: true, cellClass: "mono" },
      { field: "reason", headerName: "Reason", flex: 2, minWidth: 260, filter: true, tooltipField: "reason" },
      { field: "detail", headerName: "Detail", flex: 2, minWidth: 240, filter: true, tooltipField: "detail" },
    ],
    []
  );
  return (
    <div style={{ height, width: "100%" }}>
      <AgGridReact<EventRow>
        theme={gridTheme}
        rowData={rows}
        columnDefs={cols}
        getRowId={(p) => p.data.id}
        defaultColDef={{ sortable: true, resizable: true }}
        tooltipShowDelay={300}
        animateRows
        pagination
        paginationPageSize={50}
        overlayNoRowsTemplate="No events yet. Use the storefront or run a Red Team attack."
      />
    </div>
  );
}
