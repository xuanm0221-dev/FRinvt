"use client";

import {
  InboundData,
  BrandKey,
  BRAND_ORDER,
  MONTHS,
  INVENTORY_HEADER_ROW_COLOR,
} from "../../lib/types";
import InboundBrandSection from "./InboundBrandSection";

interface Props {
  data: InboundData;
  monthLabels?: Record<number, string>;
  brand?: BrandKey;
}

export default function InboundTable({ data, monthLabels = {}, brand }: Props) {
  const estimatedSet = new Set(Object.keys(monthLabels).map(Number));
  const brands = brand ? [brand] : BRAND_ORDER;
  const thBase = `${INVENTORY_HEADER_ROW_COLOR} min-w-[92px] whitespace-nowrap border-b border-l border-white/40 px-3 py-4 text-center text-sm font-semibold text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]`;

  return (
    <div className="overflow-hidden rounded-[26px] border border-stone-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.99)_0%,rgba(250,250,249,0.98)_100%)] shadow-[0_18px_45px_rgba(15,23,42,0.08)] ring-1 ring-stone-100">
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className={`${INVENTORY_HEADER_ROW_COLOR} text-slate-700`}>
              <th className={`${INVENTORY_HEADER_ROW_COLOR} sticky left-0 z-20 min-w-[240px] whitespace-nowrap border-b border-white/40 px-6 py-4 text-left text-sm font-semibold backdrop-blur shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]`}>
                대리상 명칭
              </th>
              {MONTHS.map((m) => {
                const label = monthLabels[m];
                return (
                  <th key={m} className={`${thBase}${label ? " italic" : ""}`}>
                    {m}월{label && (
                      <span className="ml-0.5 text-[10px] font-normal not-italic text-slate-500">({label})</span>
                    )}
                  </th>
                );
              })}
              <th className={`${INVENTORY_HEADER_ROW_COLOR} min-w-[100px] whitespace-nowrap border-b border-l border-white/40 px-3 py-4 text-center text-sm font-semibold text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]`}>
                합계
              </th>
            </tr>
          </thead>

          {brands.map((b) => (
            <InboundBrandSection
              key={b}
              brand={b}
              accounts={data.brands[b] ?? []}
              defaultOpen={false}
              monthLabels={monthLabels}
              seasonCutoffYear={parseInt(data.year.slice(2)) - 2}
            />
          ))}
        </table>
      </div>
    </div>
  );
}
