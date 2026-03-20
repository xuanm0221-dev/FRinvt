"use client";

import {
  AppOtbData,
  BrandKey,
  BRAND_ORDER,
  INVENTORY_HEADER_ROW_COLOR,
} from "../../lib/types";
import AppOtbBrandSection from "./AppOtbBrandSection";

interface Props {
  appOtb: AppOtbData;
  brand?: BrandKey;
}

export default function AppOtbTable({ appOtb, brand }: Props) {
  const brands = brand ? [brand] : BRAND_ORDER;
  // cumLabel: "26.02" → 기준월 = 2 → 계획월 = 3~12
  const cumMonth = parseInt(appOtb.cumLabel.split(".")[1] ?? "0", 10);
  const planMonths: number[] = [];
  for (let m = cumMonth + 1; m <= 12; m++) planMonths.push(m);

  const thBase = `${INVENTORY_HEADER_ROW_COLOR} whitespace-nowrap border-b border-white/50 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-600`;
  const thL = `${INVENTORY_HEADER_ROW_COLOR} sticky left-0 z-20 min-w-[240px] border-b border-white/50 px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-600`;

  return (
    <div className="overflow-hidden rounded-[26px] border border-slate-200/80 bg-white shadow-[0_4px_20px_rgba(15,23,42,0.07)]">
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className={thL}>대리상 명칭</th>
              <th className={thBase}>OTB</th>
              <th className={thBase}>25년 누적입고</th>
              <th className={thBase}>{appOtb.cumLabel} 누적입고</th>
              <th className={thBase}>입고예정</th>
              {planMonths.map((m) => (
                <th key={m} className={`${thBase} text-slate-400`}>
                  {m}월
                </th>
              ))}
            </tr>
          </thead>

          {brands.map((b) => (
            <AppOtbBrandSection
              key={b}
              brand={b as BrandKey}
              accounts={appOtb.brands[b] ?? []}
              planMonths={planMonths}
              cumLabel={appOtb.cumLabel}
            />
          ))}
        </table>
      </div>

      <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-1.5 text-right text-[10px] text-slate-400">
        단위: 천위안 · OTB: OTB_K.csv · 누적입고: 전년10월~기준월 의류 실적
      </div>
    </div>
  );
}
