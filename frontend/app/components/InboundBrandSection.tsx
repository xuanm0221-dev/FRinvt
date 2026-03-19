"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";
import {
  InboundRow,
  BrandKey,
  INVENTORY_BRAND_ROW_COLOR,
  MONTHS,
} from "../../lib/types";
import { fmtAmt } from "../../lib/utils";
import InboundAccountDrillSection from "./InboundAccountDrillSection";

interface Props {
  brand: BrandKey;
  accounts: InboundRow[];
  defaultOpen?: boolean;
  monthLabels?: Record<number, string>;
  seasonCutoffYear?: number;
}

export default function InboundBrandSection({
  brand,
  accounts,
  defaultOpen = false,
  monthLabels = {},
  seasonCutoffYear,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const estimatedSet = new Set(Object.keys(monthLabels).map(Number));

  const brandTotals: Record<number, number> = {};
  MONTHS.forEach((m) => {
    brandTotals[m] = accounts.reduce((s, a) => s + (a.months[m] ?? 0), 0);
  });
  const brandRowTotal = MONTHS.reduce((s, m) => s + (brandTotals[m] ?? 0), 0);

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

        {MONTHS.map((m) => (
          <td
            key={m}
            className={`${colorClass} whitespace-nowrap border-b border-white/40 px-3 py-4 text-right text-sm font-semibold tabular-nums shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]${estimatedSet.has(m) ? " italic text-slate-400 font-medium" : " text-slate-700"}`}
          >
            {fmtAmt(brandTotals[m])}
          </td>
        ))}

        {/* 브랜드 연간 합계 */}
        <td className={`${colorClass} whitespace-nowrap border-b border-white/40 px-3 py-4 text-right text-sm font-bold text-slate-800 tabular-nums shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]`}>
          {fmtAmt(brandRowTotal)}
        </td>
      </tr>

      {/* 대리상 행 */}
      {open &&
        accounts.map((acc, idx) => (
          <InboundAccountDrillSection
            key={`${acc.account_id}-${acc.sap_shop_cd}`}
            acc={acc}
            idx={idx}
            monthLabels={monthLabels}
            seasonCutoffYear={seasonCutoffYear}
          />
        ))}
    </tbody>
  );
}
