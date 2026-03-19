"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";
import { AppOtbAccountRow, AppOtbSeasonData } from "../../lib/types";

const TARGET_SEASONS = ["27F", "27S", "26F", "26S"] as const;

function fmtK(v: number): string {
  if (!v) return "—";
  const r = Math.round(v);
  if (r === 0) return "—";
  return r.toLocaleString("ko-KR");
}

function seasonSum(acc: AppOtbAccountRow, key: keyof AppOtbSeasonData): number {
  return TARGET_SEASONS.reduce((s, sesn) => s + ((acc.seasons[sesn]?.[key] as number) ?? 0), 0);
}

interface Props {
  acc: AppOtbAccountRow;
  idx: number;
  planMonths: number[];
  cumLabel: string;
}

export default function AppOtbAccountSection({ acc, idx, planMonths, cumLabel }: Props) {
  const [open, setOpen] = useState(false);

  const totalOtb = seasonSum(acc, "otb");
  const totalCum2025 = seasonSum(acc, "cum2025");
  const totalCum2026 = seasonSum(acc, "cum2026");
  const totalPlanned = seasonSum(acc, "planned");

  const rowBg = idx % 2 === 0 ? "bg-white" : "bg-stone-50/80";

  return (
    <>
      {/* 대리상 행 */}
      <tr
        className={`group cursor-pointer transition-colors ${rowBg}`}
        onClick={() => setOpen((v) => !v)}
      >
        <td className={`sticky left-0 z-10 min-w-[240px] border-b border-stone-200 px-6 py-3 text-sm transition-colors ${rowBg} group-hover:bg-sky-50/60`}>
          <div className="inline-flex items-center gap-1.5 font-medium text-slate-800 leading-tight">
            {open
              ? <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
              : <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            }
            <span className="truncate">{acc.account_nm_en}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400 pl-5">
            <span>{acc.account_id}</span>
          </div>
        </td>
        <td className="whitespace-nowrap border-b border-stone-200 px-3 py-3 text-right text-sm tabular-nums text-slate-700 group-hover:bg-sky-50/60">{fmtK(totalOtb)}</td>
        <td className="whitespace-nowrap border-b border-stone-200 px-3 py-3 text-right text-sm tabular-nums text-slate-700 group-hover:bg-sky-50/60">{fmtK(totalCum2025)}</td>
        <td className="whitespace-nowrap border-b border-stone-200 px-3 py-3 text-right text-sm tabular-nums text-slate-700 group-hover:bg-sky-50/60">{fmtK(totalCum2026)}</td>
        <td className="whitespace-nowrap border-b border-stone-200 px-3 py-3 text-right text-sm tabular-nums text-slate-700 group-hover:bg-sky-50/60">{fmtK(totalPlanned)}</td>
        {planMonths.map((m) => (
          <td key={m} className="whitespace-nowrap border-b border-stone-200 px-3 py-3 text-right text-sm tabular-nums text-slate-400 group-hover:bg-sky-50/60">—</td>
        ))}
      </tr>

      {/* 시즌 서브 행 */}
      {open && TARGET_SEASONS.map((sesn) => {
        const s = acc.seasons[sesn] ?? { otb: 0, cumInbound: 0, planned: 0 };
        return (
          <tr key={sesn} className="bg-slate-50/40">
            <td className="sticky left-0 z-10 min-w-[240px] border-b border-stone-100 bg-slate-50/40 px-6 py-2 text-sm">
              <div className="flex items-center gap-1 text-slate-500" style={{ paddingLeft: "20px" }}>
                <span className="mr-1 select-none text-slate-300">└</span>
                <span className="text-[12px]">{sesn}</span>
              </div>
            </td>
            <td className="whitespace-nowrap border-b border-stone-100 bg-slate-50/40 px-3 py-2 text-right text-[12px] tabular-nums text-slate-500">{fmtK(s.otb)}</td>
            <td className="whitespace-nowrap border-b border-stone-100 bg-slate-50/40 px-3 py-2 text-right text-[12px] tabular-nums text-slate-500">{fmtK(s.cum2025)}</td>
            <td className="whitespace-nowrap border-b border-stone-100 bg-slate-50/40 px-3 py-2 text-right text-[12px] tabular-nums text-slate-500">{fmtK(s.cum2026)}</td>
            <td className="whitespace-nowrap border-b border-stone-100 bg-slate-50/40 px-3 py-2 text-right text-[12px] tabular-nums text-slate-500">{fmtK(s.planned)}</td>
            {planMonths.map((m) => (
              <td key={m} className="whitespace-nowrap border-b border-stone-100 bg-slate-50/40 px-3 py-2 text-right text-[12px] tabular-nums text-slate-400">—</td>
            ))}
          </tr>
        );
      })}
    </>
  );
}
