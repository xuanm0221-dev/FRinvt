"use client";

import { useMemo, useState } from "react";
import {
  RetailData,
  RetailRow,
  BrandKey,
  MONTHS,
  INVENTORY_HEADER_ROW_COLOR,
  INVENTORY_BRAND_ROW_COLOR,
} from "../../lib/types";
import { fmtAmt, calcTotal } from "../../lib/utils";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";

export type PlanAccountNameMap = Record<string, { account_nm_en: string; account_nm_kr: string }>;

interface Props {
  plan: RetailData | null;
  retailPos2025: RetailData | null;
  brand: BrandKey;
  accountNameMap?: PlanAccountNameMap;
}

function fmtPct(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

/** 할인율 = 1 - sale/tag, 퍼센트 표시. tag<=0이면 "—" */
function fmtDiscount(tag: number, sale: number): string {
  if (tag <= 0) return "—";
  return `${((1 - sale / tag) * 100).toFixed(1)}%`;
}

/** 실판(sale) → Tag 변환: tag = sale / (1 - 할인율), 할인율 = 1 - sale25/tag25. tag25<=0 이면 raw 반환 */
function saleToTag(sale: number, tag25: number, sale25: number): number {
  if (tag25 <= 0 || sale25 <= 0) return sale;
  return Math.round(sale / (sale25 / tag25));
}

export default function RetailPlan2026Table({
  plan,
  retailPos2025,
  brand,
  accountNameMap = {},
}: Props) {
  const [open, setOpen] = useState(false);

  const accounts = plan?.brands[brand] ?? [];

  type PosRow = RetailRow & { months_sale?: Record<number, number> };
  const retailPos25ById = useMemo(() => {
    const rows = (retailPos2025?.brands[brand] ?? []) as PosRow[];
    const m: Record<string, PosRow> = {};
    for (const r of rows) m[r.account_id] = r;
    return m;
  }, [retailPos2025, brand]);

  const thBase = `${INVENTORY_HEADER_ROW_COLOR} min-w-[92px] whitespace-nowrap border-b border-l border-white/40 px-3 py-4 text-center text-sm font-semibold text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]`;

  /** 26 Plan: CSV는 실판(sale) → 할인율 적용해 Tag로 변환하여 표시 */
  const brandTotals26: Record<number, number> = {};
  MONTHS.forEach((m) => {
    brandTotals26[m] = accounts.reduce((s, a) => {
      const pos25 = retailPos25ById[a.account_id];
      const tag25 = pos25 ? calcTotal(pos25.months) : 0;
      const sale25 = pos25 ? calcTotal(pos25.months_sale ?? {}) : 0;
      const raw = a.months[m] ?? 0;
      return s + saleToTag(raw, tag25, sale25);
    }, 0);
  });
  const sum26Brand = calcTotal(brandTotals26);

  let sumPos25TagBrand = 0;
  let sumPos25SaleBrand = 0;
  for (const a of accounts) {
    const pos25 = retailPos25ById[a.account_id];
    if (pos25) {
      sumPos25TagBrand += calcTotal(pos25.months);
      sumPos25SaleBrand += calcTotal(pos25.months_sale ?? {});
    }
  }

  const colorClass = INVENTORY_BRAND_ROW_COLOR;

  function accountLabel(acc: RetailRow) {
    const names = accountNameMap[acc.account_id];
    const displayEn = names?.account_nm_en || acc.account_nm_en;
    const displayKr = names?.account_nm_kr;
    return (
      <span className="whitespace-pre-line text-sm">
        ({acc.account_id}) {displayEn}
        {displayKr ? `\n       ${displayKr}` : ""}
      </span>
    );
  }

  return (
    <div className="overflow-hidden rounded-[26px] border border-stone-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.99)_0%,rgba(250,250,249,0.98)_100%)] shadow-[0_18px_45px_rgba(15,23,42,0.08)] ring-1 ring-stone-100">
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className={`${INVENTORY_HEADER_ROW_COLOR} text-slate-700`}>
              <th
                className={`${INVENTORY_HEADER_ROW_COLOR} sticky left-0 z-20 min-w-[240px] whitespace-nowrap border-b border-white/40 px-6 py-4 text-left text-sm font-semibold backdrop-blur shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]`}
              >
                대리상 명칭
              </th>
              {MONTHS.map((m) => (
                <th key={m} className={thBase}>
                  {m}월
                </th>
              ))}
              <th
                className={`${INVENTORY_HEADER_ROW_COLOR} min-w-[100px] whitespace-nowrap border-b border-l border-white/40 px-3 py-4 text-center text-sm font-semibold text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]`}
              >
                26년합계
              </th>
              <th
                className={`${INVENTORY_HEADER_ROW_COLOR} min-w-[110px] whitespace-nowrap border-b border-l border-white/40 px-3 py-4 text-center text-sm font-semibold text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]`}
              >
                25년POS(Sale)
              </th>
              <th
                className={`${INVENTORY_HEADER_ROW_COLOR} min-w-[88px] whitespace-nowrap border-b border-l border-white/40 px-3 py-4 text-center text-sm font-semibold text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]`}
              >
                할인율
              </th>
              <th
                className={`${INVENTORY_HEADER_ROW_COLOR} min-w-[100px] whitespace-nowrap border-b border-l border-white/40 px-3 py-4 text-center text-sm font-semibold text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]`}
              >
                POS기준YOY
              </th>
            </tr>
          </thead>

          <tbody>
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
              {MONTHS.map((m) => (
                <td
                  key={m}
                  className={`${colorClass} whitespace-nowrap border-b border-white/40 px-3 py-4 text-right text-sm font-semibold tabular-nums shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] text-slate-700`}
                >
                  {fmtAmt(brandTotals26[m])}
                </td>
              ))}
              <td
                className={`${colorClass} whitespace-nowrap border-b border-white/40 px-3 py-4 text-right text-sm font-bold tabular-nums shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] text-slate-800`}
              >
                {fmtAmt(sum26Brand)}
              </td>
              <td
                className={`${colorClass} whitespace-nowrap border-b border-white/40 px-3 py-4 text-right text-sm font-bold tabular-nums shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] text-slate-800`}
              >
                {fmtAmt(sumPos25SaleBrand)}
              </td>
              <td
                className={`${colorClass} whitespace-nowrap border-b border-white/40 px-3 py-4 text-right text-sm font-bold tabular-nums shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] text-slate-800`}
              >
                {fmtDiscount(sumPos25TagBrand, sumPos25SaleBrand)}
              </td>
              <td
                className={`${colorClass} whitespace-nowrap border-b border-white/40 px-3 py-4 text-right text-sm font-bold tabular-nums shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] text-slate-800`}
              >
                {fmtPct(sum26Brand, sumPos25TagBrand)}
              </td>
            </tr>

            {open &&
              accounts.map((acc, idx) => {
                const pos25 = retailPos25ById[acc.account_id];
                const tPos25Tag = pos25 ? calcTotal(pos25.months) : 0;
                const tPos25Sale = pos25 ? calcTotal(pos25.months_sale ?? {}) : 0;
                const t26Raw = calcTotal(acc.months);
                const t26 =
                  tPos25Tag > 0 && tPos25Sale > 0
                    ? MONTHS.reduce((s, m) => s + saleToTag(acc.months[m] ?? 0, tPos25Tag, tPos25Sale), 0)
                    : t26Raw;
                const rowBg = idx % 2 === 1 ? "bg-slate-50/40" : "";
                return (
                  <tr key={acc.account_id} className={rowBg}>
                    <td
                      className={`sticky left-0 z-10 min-w-[240px] border-b border-stone-100 px-6 py-3 text-slate-700 ${rowBg || "bg-white"}`}
                    >
                      {accountLabel(acc)}
                    </td>
                    {MONTHS.map((m) => {
                      const raw = acc.months[m] ?? 0;
                      const val = saleToTag(raw, tPos25Tag, tPos25Sale);
                      return (
                        <td
                          key={m}
                          className={`whitespace-nowrap border-b border-stone-100 px-3 py-3 text-right text-sm tabular-nums text-slate-700 ${rowBg}`}
                        >
                          {fmtAmt(val)}
                        </td>
                      );
                    })}
                    <td
                      className={`whitespace-nowrap border-b border-stone-100 bg-slate-100/40 px-3 py-3 text-right text-sm font-medium tabular-nums text-slate-800 ${rowBg}`}
                    >
                      {fmtAmt(t26)}
                    </td>
                    <td
                      className={`whitespace-nowrap border-b border-stone-100 bg-slate-100/40 px-3 py-3 text-right text-sm font-medium tabular-nums text-slate-800 ${rowBg}`}
                    >
                      {pos25 ? fmtAmt(tPos25Sale) : ""}
                    </td>
                    <td
                      className={`whitespace-nowrap border-b border-stone-100 bg-slate-100/40 px-3 py-3 text-right text-sm font-medium tabular-nums text-slate-800 ${rowBg}`}
                    >
                      {fmtDiscount(tPos25Tag, tPos25Sale)}
                    </td>
                    <td
                      className={`whitespace-nowrap border-b border-stone-100 bg-slate-100/40 px-3 py-3 text-right text-sm font-medium tabular-nums text-slate-800 ${rowBg}`}
                    >
                      {fmtPct(t26, tPos25Tag)}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
