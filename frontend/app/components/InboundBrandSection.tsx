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

  // 카테고리별 소계 (의류 / ACC / 기타)
  const catTotals: Record<"의류" | "ACC" | "기타", Record<number, number>> = {
    "의류": {}, "ACC": {}, "기타": {},
  };
  MONTHS.forEach((m) => {
    let apparel = 0, acc = 0;
    for (const a of accounts) {
      for (const cat of a.categories ?? []) {
        if (cat.대분류 === "의류") apparel += cat.months[m] ?? 0;
        else if (cat.대분류 === "ACC") acc += cat.months[m] ?? 0;
      }
    }
    catTotals["의류"][m] = apparel;
    catTotals["ACC"][m] = acc;
    catTotals["기타"][m] = (brandTotals[m] ?? 0) - apparel - acc;
  });
  const catRowTotals = {
    "의류": MONTHS.reduce((s, m) => s + (catTotals["의류"][m] ?? 0), 0),
    "ACC": MONTHS.reduce((s, m) => s + (catTotals["ACC"][m] ?? 0), 0),
    "기타": MONTHS.reduce((s, m) => s + (catTotals["기타"][m] ?? 0), 0),
  };

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

      {/* 카테고리 소계 행 (항상 표시) */}
      {(["의류", "ACC", "기타"] as const).map((cat) => (
        <tr key={cat} className="bg-sky-50/60">
          <td className="sticky left-0 z-10 border-b border-stone-100 bg-sky-50/60 px-6 py-2 whitespace-nowrap">
            <span className="ml-4 text-[12px] font-medium text-slate-500">{cat}</span>
          </td>
          {MONTHS.map((m) => (
            <td
              key={m}
              className={`whitespace-nowrap border-b border-stone-100 bg-sky-50/60 px-3 py-2 text-right text-[12px] tabular-nums ${estimatedSet.has(m) ? "italic text-slate-400" : "text-slate-600"}`}
            >
              {fmtAmt(catTotals[cat][m])}
            </td>
          ))}
          <td className="whitespace-nowrap border-b border-stone-100 bg-sky-100/40 px-3 py-2 text-right text-[12px] text-slate-600 tabular-nums font-medium">
            {fmtAmt(catRowTotals[cat])}
          </td>
        </tr>
      ))}

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
