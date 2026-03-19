"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";
import { AppOtbAccountRow, AppOtbSeasonData, BrandKey, INVENTORY_BRAND_ROW_COLOR } from "../../lib/types";
import AppOtbAccountSection from "./AppOtbAccountSection";

const TARGET_SEASONS = ["27F", "27S", "26F", "26S"] as const;

function fmtK(v: number): string {
  if (!v) return "—";
  const r = Math.round(v);
  if (r === 0) return "—";
  return r.toLocaleString("ko-KR");
}

function sumAccounts(accounts: AppOtbAccountRow[], key: keyof AppOtbSeasonData): number {
  return accounts.reduce((s, acc) =>
    s + TARGET_SEASONS.reduce((ss, sesn) => ss + ((acc.seasons[sesn]?.[key] as number) ?? 0), 0), 0
  );
}

interface Props {
  brand: BrandKey;
  accounts: AppOtbAccountRow[];
  planMonths: number[];
  cumLabel: string;
}

export default function AppOtbBrandSection({ brand, accounts, planMonths, cumLabel }: Props) {
  const [open, setOpen] = useState(false);

  const totalOtb = sumAccounts(accounts, "otb");
  const totalCum2025 = sumAccounts(accounts, "cum2025");
  const totalCum2026 = sumAccounts(accounts, "cum2026");
  const totalPlanned = sumAccounts(accounts, "planned");
  const colorClass = INVENTORY_BRAND_ROW_COLOR;

  return (
    <tbody>
      {/* 브랜드 헤더 행 */}
      <tr
        className="cursor-pointer select-none transition-[filter,transform] duration-200 hover:brightness-[1.04]"
        onClick={() => setOpen((v) => !v)}
      >
        <td className={`${colorClass} sticky left-0 z-10 whitespace-nowrap border-b border-white/40 px-6 py-4 text-sm font-semibold text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]`}>
          <div className="inline-flex items-center gap-1.5">
            {brand}
            {open
              ? <ChevronDownIcon className="h-4 w-4 text-slate-600/90" />
              : <ChevronRightIcon className="h-4 w-4 text-slate-600/90" />
            }
            <span className="ml-1 rounded-full bg-white/55 px-2 py-0.5 text-[11px] font-normal text-slate-500">
              ({accounts.length}개 계정)
            </span>
          </div>
        </td>
        <td className={`${colorClass} whitespace-nowrap border-b border-white/40 px-3 py-4 text-right text-sm font-semibold tabular-nums text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]`}>{fmtK(totalOtb)}</td>
        <td className={`${colorClass} whitespace-nowrap border-b border-white/40 px-3 py-4 text-right text-sm font-semibold tabular-nums text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]`}>{fmtK(totalCum2025)}</td>
        <td className={`${colorClass} whitespace-nowrap border-b border-white/40 px-3 py-4 text-right text-sm font-semibold tabular-nums text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]`}>{fmtK(totalCum2026)}</td>
        <td className={`${colorClass} whitespace-nowrap border-b border-white/40 px-3 py-4 text-right text-sm font-semibold tabular-nums text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]`}>{fmtK(totalPlanned)}</td>
        {planMonths.map((m) => (
          <td key={m} className={`${colorClass} whitespace-nowrap border-b border-white/40 px-3 py-4 text-right text-sm tabular-nums text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]`}>—</td>
        ))}
      </tr>

      {/* 대리상 행 */}
      {open && accounts.map((acc, idx) => (
        <AppOtbAccountSection
          key={acc.account_id}
          acc={acc}
          idx={idx}
          planMonths={planMonths}
          cumLabel={cumLabel}
        />
      ))}
    </tbody>
  );
}
