"use client";

import { BrandKey, BRAND_ORDER } from "../../lib/types";
import { fmtAmt } from "../../lib/utils";
import { ArrowDownIcon, ArrowUpIcon } from "./Icons";

interface Props {
  inboundPrev: Record<string, number>;
  inboundCurr: Record<string, number>;
  retailPrev: Record<string, number>;
  retailCurr: Record<string, number>;
  stockPrev: Record<string, number>;
  stockCurr: Record<string, number>;
  brand?: BrandKey;
}

function fmtPct(value: number): string {
  return `${value.toFixed(0)}%`;
}

function calcYoyPct(prev: number, curr: number): number | null {
  if (prev === 0) return null;
  return (curr / prev) * 100;
}

interface BrandMetricCardProps {
  brand: BrandKey;
  inboundPrev: Record<string, number>;
  inboundCurr: Record<string, number>;
  retailPrev: Record<string, number>;
  retailCurr: Record<string, number>;
  stockPrev: Record<string, number>;
  stockCurr: Record<string, number>;
}

function BrandMetricCard({
  brand,
  inboundPrev,
  inboundCurr,
  retailPrev,
  retailCurr,
  stockPrev,
  stockCurr,
}: BrandMetricCardProps) {
  const tdData = "px-4 py-2.5 text-right text-sm font-medium text-slate-700 tabular-nums whitespace-nowrap";
  const tdCurr = "px-4 py-2.5 text-right text-sm font-semibold text-slate-800 tabular-nums whitespace-nowrap";

  function YoYCell({ pct }: { pct: number | null }) {
    if (pct === null) return <td className={tdData}><span className="text-slate-400">—</span></td>;
    const up = pct >= 100;
    return (
      <td className={`${tdData} text-center`}>
        <span className={`inline-flex h-7 min-w-[2.5rem] items-center justify-center gap-0.5 rounded-full px-2 text-xs font-semibold tabular-nums ${
          up ? "bg-emerald-500/15 text-emerald-700" : "bg-red-500/15 text-red-600"
        }`}>
          {up ? <ArrowUpIcon className="h-3 w-3" /> : <ArrowDownIcon className="h-3 w-3" />}
          {fmtPct(pct)}
        </span>
      </td>
    );
  }

  const metrics = [
    { label: "입고", prev: inboundPrev[brand] ?? 0, curr: inboundCurr[brand] ?? 0 },
    { label: "리테일 판매", prev: retailPrev[brand] ?? 0, curr: retailCurr[brand] ?? 0 },
    { label: "기말재고", prev: stockPrev[brand] ?? 0, curr: stockCurr[brand] ?? 0 },
  ] as const;

  return (
    <div className="min-w-[220px] flex-1 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_4px_20px_rgba(15,23,42,0.08)]">
      <div className="bg-[#1e3a5f] px-4 py-3">
        <h3 className="text-sm font-bold tracking-tight text-white">
          {brand}
        </h3>
      </div>
      <table className="w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500 whitespace-nowrap border-b border-slate-200/60 bg-slate-100/80">지표</th>
            <th className="px-4 py-2.5 text-center text-[11px] font-medium uppercase tracking-wider text-slate-500 whitespace-nowrap border-b border-slate-200/60 bg-slate-100/80">전년</th>
            <th className="px-4 py-2.5 text-center text-[11px] font-medium uppercase tracking-wider text-slate-500 whitespace-nowrap border-b border-slate-200/60 bg-slate-100/80">당년 Rolling</th>
            <th className="px-4 py-2.5 text-center text-[11px] font-medium uppercase tracking-wider text-slate-500 whitespace-nowrap border-b border-slate-200/60 bg-slate-100/80">YoY (금액)</th>
            <th className="px-4 py-2.5 text-center text-[11px] font-medium uppercase tracking-wider text-slate-500 whitespace-nowrap border-b border-slate-200/60 bg-slate-100/80">YoY (%)</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map(({ label, prev, curr }) => {
            const amt = curr - prev;
            const pct = calcYoyPct(prev, curr);
            return (
              <tr key={label} className="bg-white hover:bg-slate-50/60 transition-colors last:border-b-0">
                <td className="whitespace-nowrap px-4 py-2.5 text-sm font-medium text-slate-700">{label}</td>
                <td className={tdData}>{fmtAmt(prev)}</td>
                <td className={tdCurr}>{fmtAmt(curr)}</td>
                <td className={`${tdData} ${amt >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {amt >= 0 ? "+" : ""}{fmtAmt(amt)}
                </td>
                <YoYCell pct={pct} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function KeyMetricsTable({
  inboundPrev, inboundCurr,
  retailPrev, retailCurr,
  stockPrev, stockCurr,
  brand,
}: Props) {
  const brands = brand ? [brand] : BRAND_ORDER;
  return (
    <div className="mb-6 flex flex-1 flex-wrap gap-4">
      {brands.map((b) => (
        <BrandMetricCard
          key={b}
          brand={b}
          inboundPrev={inboundPrev}
          inboundCurr={inboundCurr}
          retailPrev={retailPrev}
          retailCurr={retailCurr}
          stockPrev={stockPrev}
          stockCurr={stockCurr}
        />
      ))}
    </div>
  );
}
