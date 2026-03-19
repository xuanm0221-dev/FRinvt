"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";
import {
  AccountRow,
  BrandKey,
  INVENTORY_BRAND_ROW_COLOR,
  MONTHS,
} from "../../lib/types";
import { fmtAmt } from "../../lib/utils";
import StockAccountDrillSection from "./StockAccountDrillSection";

interface Props {
  brand: BrandKey;
  accounts: AccountRow[];
  defaultOpen?: boolean;
  estimatedMonths?: number[];
  seasonCutoffYear?: number;
}

export default function BrandSection({
  brand,
  accounts,
  defaultOpen = false,
  estimatedMonths = [],
  seasonCutoffYear,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const estimatedSet = new Set(estimatedMonths);

  const brandTotals: Record<number, number> = {};
  MONTHS.forEach((m) => {
    brandTotals[m] = accounts.reduce((s, a) => s + (a.months[m] ?? 0), 0);
  });
  const brandBaseTotal = accounts.reduce((s, a) => s + (a.base_stock ?? 0), 0);

  const colorClass = INVENTORY_BRAND_ROW_COLOR;
  const baseTdClass = `${colorClass} whitespace-nowrap border-b border-white/40 px-3 py-4 text-right text-sm font-semibold text-slate-500 tabular-nums shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]`;

  return (
    <tbody>
      {/* 브랜드 헤더 행 */}
      <tr
        className="cursor-pointer select-none transition-[filter,transform] duration-200 hover:brightness-[1.04]"
        onClick={() => setOpen((v) => !v)}
      >
        <td
          className={`${colorClass} sticky left-0 z-10 whitespace-nowrap border-b border-white/40 px-6 py-4 text-sm font-semibold text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]`}
        >
          <div className="inline-flex items-center gap-1.5">
            {brand}
            {open ? (
              <ChevronDownIcon className="h-4 w-4 text-slate-600/90" />
            ) : (
              <ChevronRightIcon className="h-4 w-4 text-slate-600/90" />
            )}
            <span className="ml-1 rounded-full bg-white/55 px-2 py-0.5 text-[11px] font-normal text-slate-500">
              ({accounts.length}개 계정)
            </span>
          </div>
        </td>

        {/* 기초재고 소계 */}
        <td className={baseTdClass}>{fmtAmt(brandBaseTotal)}</td>

        {MONTHS.map((m) => (
          <td
            key={m}
            className={`${colorClass} whitespace-nowrap border-b border-white/40 px-3 py-4 text-right text-sm font-semibold tabular-nums shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]${estimatedSet.has(m) ? " italic text-slate-400 font-medium" : " text-slate-700"}`}
          >
            {fmtAmt(brandTotals[m])}
          </td>
        ))}
      </tr>

      {/* 대리상 행 (각각 대분류/중분류 드릴다운 포함) */}
      {open &&
        accounts.map((acc, idx) => (
          <StockAccountDrillSection key={acc.account_id} acc={acc} idx={idx} estimatedMonths={estimatedMonths} seasonCutoffYear={seasonCutoffYear} />
        ))}
    </tbody>
  );
}
