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

  // 카테고리별 소계 (의류 / ACC / 기타)
  const catTotals: Record<"의류" | "ACC" | "기타", Record<number, number>> = {
    "의류": {}, "ACC": {}, "기타": {},
  };
  const catBaseTotals: Record<"의류" | "ACC" | "기타", number> = {
    "의류": 0, "ACC": 0, "기타": 0,
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
  for (const a of accounts) {
    for (const cat of a.categories ?? []) {
      if (cat.대분류 === "의류") catBaseTotals["의류"] += cat.base_stock ?? 0;
      else if (cat.대분류 === "ACC") catBaseTotals["ACC"] += cat.base_stock ?? 0;
    }
  }
  catBaseTotals["기타"] = brandBaseTotal - catBaseTotals["의류"] - catBaseTotals["ACC"];

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

      {/* 카테고리 소계 행 (항상 표시) */}
      {(["의류", "ACC", "기타"] as const).map((cat) => (
        <tr key={cat} className="bg-sky-50/60">
          <td className="sticky left-0 z-10 border-b border-stone-100 bg-sky-50/60 px-6 py-2 text-sm text-slate-600 whitespace-nowrap">
            <span className="ml-4 text-[12px] font-medium text-slate-500">{cat}</span>
          </td>
          <td className="whitespace-nowrap border-b border-stone-100 bg-sky-50/60 px-3 py-2 text-right text-[12px] tabular-nums text-slate-500">
            {fmtAmt(catBaseTotals[cat])}
          </td>
          {MONTHS.map((m) => (
            <td
              key={m}
              className={`whitespace-nowrap border-b border-stone-100 bg-sky-50/60 px-3 py-2 text-right text-[12px] tabular-nums ${estimatedSet.has(m) ? "italic text-slate-400" : "text-slate-600"}`}
            >
              {fmtAmt(catTotals[cat][m])}
            </td>
          ))}
        </tr>
      ))}

      {/* 대리상 행 (각각 대분류/중분류 드릴다운 포함) */}
      {open &&
        accounts.map((acc, idx) => (
          <StockAccountDrillSection key={acc.account_id} acc={acc} idx={idx} estimatedMonths={estimatedMonths} seasonCutoffYear={seasonCutoffYear} />
        ))}
    </tbody>
  );
}
