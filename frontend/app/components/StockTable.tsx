"use client";

import {
  StockData,
  BRAND_ORDER,
  MONTHS,
  INVENTORY_HEADER_ROW_COLOR,
  INVENTORY_TOTAL_ROW_COLOR,
} from "../../lib/types";
import { fmtAmt } from "../../lib/utils";
import BrandSection from "./BrandSection";

interface Props {
  data: StockData;
  estimatedMonths?: number[];
}

export default function StockTable({ data, estimatedMonths = [] }: Props) {
  const allAccounts = BRAND_ORDER.flatMap((b) => data.brands[b] ?? []);
  const estimatedSet = new Set(estimatedMonths);

  const grandTotals: Record<number, number> = {};
  MONTHS.forEach((m) => {
    grandTotals[m] = allAccounts.reduce((s, a) => s + (a.months[m] ?? 0), 0);
  });
  const grandBaseStock = allAccounts.reduce((s, a) => s + (a.base_stock ?? 0), 0);

  const thBase = `${INVENTORY_HEADER_ROW_COLOR} min-w-[92px] whitespace-nowrap border-b border-l border-white/40 px-3 py-4 text-center text-sm font-semibold text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]`;
  const tdBase = `${INVENTORY_TOTAL_ROW_COLOR} whitespace-nowrap border-t border-l border-white/40 px-3 py-4 text-right text-sm font-bold text-slate-700 tabular-nums shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]`;

  return (
    <div className="overflow-hidden rounded-[26px] border border-stone-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.99)_0%,rgba(250,250,249,0.98)_100%)] shadow-[0_18px_45px_rgba(15,23,42,0.08)] ring-1 ring-stone-100">
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className={`${INVENTORY_HEADER_ROW_COLOR} text-slate-700`}>
              <th className={`${INVENTORY_HEADER_ROW_COLOR} sticky left-0 z-20 min-w-[240px] whitespace-nowrap border-b border-white/40 px-6 py-4 text-left text-sm font-semibold backdrop-blur shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]`}>
                대리상 명칭
              </th>
              {/* 기초재고 컬럼 */}
              <th className={thBase}>기초재고</th>
              {MONTHS.map((m) => (
                <th
                  key={m}
                  className={`${thBase}${estimatedSet.has(m) ? " italic" : ""}`}
                >
                  {m}월{estimatedSet.has(m) && (
                    <span className="ml-0.5 text-[10px] font-normal not-italic text-slate-500">(F)</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          {BRAND_ORDER.map((brand) => (
            <BrandSection
              key={brand}
              brand={brand}
              accounts={data.brands[brand] ?? []}
              defaultOpen={false}
              estimatedMonths={estimatedMonths}
              seasonCutoffYear={parseInt(data.year.slice(2)) - 2}
            />
          ))}

          <tfoot>
            <tr className={`${INVENTORY_TOTAL_ROW_COLOR} text-slate-700`}>
              <td className={`${INVENTORY_TOTAL_ROW_COLOR} sticky left-0 z-10 whitespace-nowrap border-t border-white/40 px-6 py-4 text-sm font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]`}>
                전체 합계
              </td>
              <td className={tdBase}>{fmtAmt(grandBaseStock)}</td>
              {MONTHS.map((m) => (
                <td
                  key={m}
                  className={`${tdBase}${estimatedSet.has(m) ? " italic opacity-70" : ""}`}
                >
                  {fmtAmt(grandTotals[m])}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
