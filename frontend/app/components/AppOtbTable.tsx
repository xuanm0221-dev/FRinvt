"use client";

import {
  AppOtbData,
  AppOtbSeasonData,
  BrandKey,
  BRAND_ORDER,
  INVENTORY_HEADER_ROW_COLOR,
  INVENTORY_TOTAL_ROW_COLOR,
} from "../../lib/types";
import AppOtbBrandSection from "./AppOtbBrandSection";

const TARGET_SEASONS = ["27F", "27S", "26F", "26S"] as const;

function fmtK(v: number): string {
  if (!v) return "—";
  const r = Math.round(v);
  if (r === 0) return "—";
  return r.toLocaleString("ko-KR");
}

function grandSum(data: AppOtbData, key: keyof AppOtbSeasonData): number {
  return BRAND_ORDER.reduce((s, brand) =>
    s + (data.brands[brand] ?? []).reduce((bs, acc) =>
      bs + TARGET_SEASONS.reduce((ss, sesn) => ss + ((acc.seasons[sesn]?.[key] as number) ?? 0), 0), 0
    ), 0
  );
}

interface Props {
  appOtb: AppOtbData;
}

export default function AppOtbTable({ appOtb }: Props) {
  // cumLabel: "26.02" → 기준월 = 2 → 계획월 = 3~12
  const cumMonth = parseInt(appOtb.cumLabel.split(".")[1] ?? "0", 10);
  const planMonths: number[] = [];
  for (let m = cumMonth + 1; m <= 12; m++) planMonths.push(m);

  const totalOtb = grandSum(appOtb, "otb");
  const totalCum2025 = grandSum(appOtb, "cum2025");
  const totalCum2026 = grandSum(appOtb, "cum2026");
  const totalPlanned = grandSum(appOtb, "planned");

  const thBase = `${INVENTORY_HEADER_ROW_COLOR} whitespace-nowrap border-b border-white/50 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-600`;
  const thL = `${INVENTORY_HEADER_ROW_COLOR} sticky left-0 z-20 min-w-[240px] border-b border-white/50 px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-600`;
  const tdTotal = `${INVENTORY_TOTAL_ROW_COLOR} whitespace-nowrap border-t-2 border-white/60 px-3 py-3.5 text-right text-sm font-bold tabular-nums text-slate-800`;

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

          {BRAND_ORDER.map((brand) => (
            <AppOtbBrandSection
              key={brand}
              brand={brand as BrandKey}
              accounts={appOtb.brands[brand] ?? []}
              planMonths={planMonths}
              cumLabel={appOtb.cumLabel}
            />
          ))}

          <tfoot>
            <tr>
              <td className={`${INVENTORY_TOTAL_ROW_COLOR} sticky left-0 z-10 border-t-2 border-white/60 px-6 py-3.5 text-sm font-bold text-slate-800`}>
                전체 합계
              </td>
              <td className={tdTotal}>{fmtK(totalOtb)}</td>
              <td className={tdTotal}>{fmtK(totalCum2025)}</td>
              <td className={tdTotal}>{fmtK(totalCum2026)}</td>
              <td className={tdTotal}>{fmtK(totalPlanned)}</td>
              {planMonths.map((m) => (
                <td key={m} className={tdTotal + " text-slate-400"}>—</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-1.5 text-right text-[10px] text-slate-400">
        단위: 천위안 · OTB: OTB_K.csv · 누적입고: 전년10월~기준월 의류 실적
      </div>
    </div>
  );
}
