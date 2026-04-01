"use client";

import { useMemo } from "react";
import {
  BrandKey,
  StockData,
  RetailData,
  InboundData,
  AppOtbData,
  BRAND_ORDER,
} from "../../lib/types";
import { fmtAmt } from "../../lib/utils";
import {
  mergeAccounts,
  computeAccountMetrics,
  DEFAULT_TARGET_WEEKS,
  DEFAULT_SELL_THROUGH_RATES,
  type SellThroughRates,
} from "../../lib/dealerMetrics";
import { calcRetail, blendRetail, type AccountNameMap } from "./StockView";

function Num({ v }: { v: number }) {
  return <span>{fmtAmt(v)}</span>;
}

function Yoy({ v }: { v: number | null }) {
  if (v === null) return <span></span>;
  const cls =
    v >= 100
      ? "text-green-600 font-medium"
      : v >= 90
        ? "text-amber-500"
        : v >= 80
          ? "text-orange-500"
          : "text-red-600 font-medium";
  return <span className={cls}>{Math.round(v)}%</span>;
}

export interface OverviewScenario1TableProps {
  data2025: StockData | null;
  data2026: StockData | null;
  inbound2025: InboundData | null;
  inbound2026: InboundData | null;
  retail2026: RetailData | null;
  retailDw2025: RetailData | null;
  appOtb2026: AppOtbData | null;
  accountNameMap?: AccountNameMap;
  brand: BrandKey;
  onBrandChange: (b: BrandKey) => void;
  growthRates: Record<BrandKey, number>;
  targetWeeks?: Record<string, number>;
  sellThroughRates?: SellThroughRates;
}

/**
 * 재고자산(목표) 2026 대리상표와 동일 입력으로 mergeAccounts + computeAccountMetrics 결과만 표시.
 * DealerDetailTable / dealerMetrics 계산식은 변경하지 않음.
 */
export default function OverviewScenario1Table({
  data2025,
  data2026,
  inbound2025,
  inbound2026,
  retail2026,
  retailDw2025,
  appOtb2026,
  accountNameMap = {},
  brand,
  onBrandChange,
  growthRates,
  targetWeeks: targetWeeksProp,
  sellThroughRates: sellThroughRatesProp,
}: OverviewScenario1TableProps) {
  const targetWeeks = targetWeeksProp ?? DEFAULT_TARGET_WEEKS;
  const sellThroughRates = sellThroughRatesProp ?? DEFAULT_SELL_THROUGH_RATES;

    const { metrics, totalRow } = useMemo(() => {
    const retail2025calc =
      data2025 && inbound2025 ? calcRetail(data2025, inbound2025) : null;
    const blended =
      retail2026 && retail2025calc
        ? blendRetail(retail2026, retail2025calc, growthRates, retailDw2025)
        : null;
    const retailForTable = blended?.data ?? retail2026;

    const merged = mergeAccounts(
      brand,
      data2026,
      retailForTable,
      inbound2026,
      appOtb2026
    );

    const all2026 =
      data2026 && retailForTable
        ? merged.map((acc) =>
            computeAccountMetrics(
              acc,
              brand,
              data2026,
              data2025,
              retailForTable,
              retail2025calc,
              inbound2026 ?? null,
              inbound2025 ?? null,
              appOtb2026,
              "2026",
              targetWeeks,
              sellThroughRates,
              retailDw2025
            )
          )
        : [];

    const curr =
      all2026.length > 0
        ? all2026
        : data2026 && retailForTable
          ? merged.map((acc) =>
              computeAccountMetrics(
                acc,
                brand,
                data2026,
                data2025,
                retailForTable,
                retail2025calc,
                inbound2026!,
                inbound2025!,
                appOtb2026,
                "2026",
                targetWeeks,
                sellThroughRates,
                retailDw2025
              )
            )
          : [];

    const filtered = curr.filter((m) => m.apparel.ending + m.acc.ending > 0);

    let totalRow: {
      apparel: {
        sellThrough: number | null;
        salesYoyPos: number | null;
        ending: number;
      };
      acc: { weeks: number | null; salesYoyPos: number | null; ending: number };
    } | null = null;

    if (filtered.length > 0) {
      const apparelBase = filtered.reduce((s, m) => s + m.apparel.base, 0);
      const apparelPurchase = filtered.reduce((s, m) => s + m.apparel.purchase, 0);
      const apparelSales = filtered.reduce((s, m) => s + m.apparel.sales, 0);
      const apparelEnding = filtered.reduce((s, m) => s + m.apparel.ending, 0);
      const accSales = filtered.reduce((s, m) => s + m.acc.sales, 0);
      const accEnding = filtered.reduce((s, m) => s + m.acc.ending, 0);

      const sumPosCurrA = filtered.reduce(
        (s, m) => s + (m.apparel.retailSalesPos ?? 0),
        0
      );
      const sumPosPrevA = filtered.reduce(
        (s, m) => s + (m.apparel.prevRetailSalesPos ?? 0),
        0
      );
      const apparelSalesYoyPos =
        sumPosPrevA === 0 ? null : (sumPosCurrA / sumPosPrevA) * 100;

      const sumPosCurrAcc = filtered.reduce(
        (s, m) => s + (m.acc.retailSalesPos ?? 0),
        0
      );
      const sumPosPrevAcc = filtered.reduce(
        (s, m) => s + (m.acc.prevRetailSalesPos ?? 0),
        0
      );
      const accSalesYoyPos =
        sumPosPrevAcc === 0 ? null : (sumPosCurrAcc / sumPosPrevAcc) * 100;

      totalRow = {
        apparel: {
          sellThrough:
            apparelBase + apparelPurchase > 0
              ? (apparelSales / (apparelBase + apparelPurchase)) * 100
              : null,
          salesYoyPos: apparelSalesYoyPos,
          ending: apparelEnding,
        },
        acc: {
          weeks: accSales > 0 ? accEnding / ((accSales / 365) * 7) : null,
          salesYoyPos: accSalesYoyPos,
          ending: accEnding,
        },
      };
    }

    return { metrics: filtered, totalRow };
  }, [
    brand,
    data2025,
    data2026,
    inbound2025,
    inbound2026,
    retail2026,
    retailDw2025,
    appOtb2026,
    growthRates,
    targetWeeks,
    sellThroughRates,
  ]);

  const th =
    "px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-white border-b border-white/20";
  const td = "px-3 py-2 text-right tabular-nums text-sm text-slate-700 border-b border-slate-100";
  const tdLabel = "px-2 py-2 text-left text-xs text-slate-800 border-b border-slate-100 whitespace-nowrap";

  return (
    <div className="min-w-0 w-1/2">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-base font-bold text-slate-800">
          시나리오1: 연말 목표 재고자산기준
        </h2>
        <div className="flex flex-wrap gap-1.5 rounded-xl bg-slate-100/90 p-1">
          {BRAND_ORDER.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => onBrandChange(b)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                brand === b
                  ? "bg-white text-[#2f5f93] shadow-sm"
                  : "text-slate-600 hover:bg-white/70"
              }`}
            >
              {b}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
        <table className="w-auto border-collapse text-right">
          <thead>
            <tr className="bg-[linear-gradient(180deg,#2d5a8e_0%,#245089_100%)]">
              <th
                rowSpan={2}
                className={`${th} text-left align-middle border-r border-white/25 whitespace-nowrap`}
              >
                대리상명칭
              </th>
              <th colSpan={2} className={`${th} border-l border-white/20`}>
                매출성장율
              </th>
              <th rowSpan={2} className={`${th} border-l border-white/20 align-middle`}>
                의류판매율
              </th>
              <th rowSpan={2} className={`${th} border-l border-white/20 align-middle`}>
                재고주수
              </th>
              <th rowSpan={2} className={`${th} border-l border-white/20 align-middle`}>
                기말재고
              </th>
            </tr>
            <tr className="bg-[#245089]">
              <th className={`${th} border-l border-white/20`}>의류</th>
              <th className={th}>ACC</th>
            </tr>
          </thead>
          <tbody>
            {totalRow && (
              <tr className="bg-slate-200/70 font-semibold">
                <td className={`${tdLabel} bg-slate-200/70`}>전체기준</td>
                <td className={td}>
                  <Yoy v={totalRow.apparel.salesYoyPos} />
                </td>
                <td className={td}>
                  <Yoy v={totalRow.acc.salesYoyPos} />
                </td>
                <td className={td}>
                  {totalRow.apparel.sellThrough != null
                    ? `${totalRow.apparel.sellThrough.toFixed(1)}%`
                    : ""}
                </td>
                <td
                  className={`${td} ${
                    totalRow.acc.weeks != null && totalRow.acc.weeks >= 30
                      ? "text-red-500"
                      : totalRow.acc.weeks != null
                        ? "text-violet-600"
                        : ""
                  }`}
                >
                  {totalRow.acc.weeks != null
                    ? `${totalRow.acc.weeks.toFixed(1)}주`
                    : ""}
                </td>
                <td className={td}>
                  <Num v={totalRow.apparel.ending + totalRow.acc.ending} />
                </td>
              </tr>
            )}
            {metrics.map((m) => {
              const names = accountNameMap[m.account_id];
              const displayEn = names?.account_nm_en || m.account_nm_en;
              const displayKr = names?.account_nm_kr;
              return (
                <tr key={m.account_id} className="hover:bg-slate-50/50">
                  <td className={tdLabel}>
                    <span
                      className="cursor-default text-sm"
                      title={displayEn || undefined}
                    >
                      ({m.account_id}) {displayKr || displayEn}
                    </span>
                  </td>
                  <td className={td}>
                    <Yoy v={m.apparel.salesYoyPos ?? null} />
                  </td>
                  <td className={td}>
                    <Yoy v={m.acc.salesYoyPos ?? null} />
                  </td>
                  <td className={td}>
                    {m.apparel.sellThrough != null
                      ? `${m.apparel.sellThrough.toFixed(1)}%`
                      : ""}
                  </td>
                  <td
                    className={`${td} ${
                      m.acc.weeks != null && m.acc.weeks >= 30
                        ? "text-red-500 font-medium"
                        : m.acc.weeks != null
                          ? "text-violet-600"
                          : ""
                    }`}
                  >
                    {m.acc.weeks != null ? `${m.acc.weeks.toFixed(1)}주` : ""}
                  </td>
                  <td className={td}>
                    <Num v={m.apparel.ending + m.acc.ending} />
                  </td>
                </tr>
              );
            })}
            {metrics.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  2026년 목표 재고 지표를 계산할 수 없습니다. 재고·리테일·입고 데이터를
                  확인하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        수치는 재고자산(목표) 탭 2026년 대리상표와 동일한 계산입니다. 성장률·재고주수·Sell
        through 변경 시 함께 반영됩니다.
      </p>
    </div>
  );
}
