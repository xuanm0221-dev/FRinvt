"use client";

import { useState, useMemo } from "react";
import {
  BrandKey,
  StockData,
  InboundData,
  RetailData,
  AppOtbData,
  MONTHS,
  StoreRetailMap,
} from "../../lib/types";
import {
  computeAccountMetrics,
  mergeAccounts,
  type SellThroughRates,
} from "../../lib/dealerMetrics";
import { blendRetail } from "./StockView";
import { fmtAmt, dealerDisplayName } from "../../lib/utils";
import type { AccountNameMap } from "./StockView";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";

interface Props {
  data2025: StockData | null;
  data2026: StockData | null;
  inbound2025: InboundData | null;
  inbound2026: InboundData | null;
  retail2026: RetailData | null;
  appOtb2026: AppOtbData | null;
  storeRetailMap: StoreRetailMap;
  accountNameMap: AccountNameMap;
  growthRates: Record<BrandKey, number>;
  targetWeeks: Record<string, number>;
  sellThroughRates: SellThroughRates;
  retailDw2025: RetailData | null;
  selectedBrand?: BrandKey;
}

interface SimuRow {
  accountId: string;
  nameKr: string;
  nameEn: string;
  base: number;
  apparelPurchase: number;
  accPurchase: number;
  inbound2025Annual: number;
  purchaseYoy: number | null;
  prevRetailAnnual: number;
  plSales: number;
  plYoy: number | null;
  ending: number;
  targetSales: number;
  targetEnding: number;
}

function fmtCell(v: number): string {
  return v > 0 ? fmtAmt(v) : "—";
}

/** 기말/기초 × 100, 소수점 없음. 기초가 0이면 "—" */
function fmtYoy(ending: number, base: number): string {
  if (base <= 0) return "—";
  return `${Math.round((ending / base) * 100)}%`;
}

function yoyColor(ending: number, base: number): string {
  if (base <= 0) return "text-slate-400";
  const pct = (ending / base) * 100;
  if (pct >= 100) return "text-emerald-600";
  if (pct >= 70) return "text-amber-500";
  return "text-red-500";
}

/** storeRetailMap 에서 특정 브랜드·계정의 26년 연간 목표 Tag 합산
 *  Tag = retail / (1 - discountRate)  — PLView calcTag 와 동일 로직 */
function annualPlTag(
  storeRetailMap: StoreRetailMap,
  brand: BrandKey,
  accountId: string
): number {
  const stores = storeRetailMap[brand]?.[accountId] ?? [];
  return stores.reduce((sum, s) => {
    const retail = MONTHS.reduce((ms, m) => ms + (s.months[m] ?? 0), 0);
    const denom = 1 - s.discountRate;
    return sum + (denom > 0 ? retail / denom : retail);
  }, 0);
}

export default function StockSimuView({
  data2025,
  data2026,
  inbound2025,
  inbound2026,
  retail2026,
  appOtb2026,
  storeRetailMap,
  accountNameMap,
  growthRates,
  targetWeeks,
  sellThroughRates,
  retailDw2025,
  selectedBrand: selectedBrandProp,
}: Props) {
  const selectedBrand: BrandKey = selectedBrandProp ?? "MLB";
  const [purchaseExpanded, setPurchaseExpanded] = useState(false);

  // 2026 블렌드 리테일 (매입 계산용)
  const blended2026 = useMemo(
    () =>
      retail2026
        ? blendRetail(retail2026, growthRates, retailDw2025).data
        : null,
    [retail2026, growthRates, retailDw2025]
  );

  // 브랜드별 simu 행 계산
  const rows = useMemo((): SimuRow[] => {
    const accounts = mergeAccounts(
      selectedBrand,
      data2026,
      blended2026,
      inbound2026,
      appOtb2026
    );

    return accounts.map((acc) => {
      // 기초재고: 2025 ending = apparel.ending + acc.ending
      const m25 = computeAccountMetrics(
        acc,
        selectedBrand,
        data2025,
        null,
        retailDw2025,
        null,
        inbound2025,
        null,
        null,
        "2025"
      );
      const base = m25.apparel.ending + m25.acc.ending;

      // 매입: 2026 apparel.purchase + acc.purchase
      const m26 = computeAccountMetrics(
        acc,
        selectedBrand,
        data2026,
        data2025,
        blended2026,
        retailDw2025,
        inbound2026,
        inbound2025,
        appOtb2026,
        "2026",
        targetWeeks,
        sellThroughRates,
        retailDw2025
      );
      const apparelPurchase = m26.apparel.purchase;
      const accPurchase = m26.acc.purchase;
      const targetSales = m26.apparel.sales + m26.acc.sales;
      const targetEnding = m26.apparel.ending + m26.acc.ending;

      // 판매(PL): 26년 연간목표 Tag (= retail / (1 - discountRate), PLView Tag 컬럼 동일 로직)
      const plSales = annualPlTag(storeRetailMap, selectedBrand, acc.account_id);

      // 2025 입고 연간합 (카테고리 구분 없이 계정 레벨 months 합산)
      const inboundRow2025 = inbound2025?.brands[selectedBrand]
        ?.find((a) => a.account_id === acc.account_id);
      const inbound2025Annual = inboundRow2025
        ? MONTHS.reduce((s, m) => s + (inboundRow2025.months[m] ?? 0), 0)
        : 0;
      const purchaseYoy = inbound2025Annual > 0
        ? Math.round(((apparelPurchase + accPurchase) / inbound2025Annual) * 100)
        : null;

      // 전년 리테일(POS) 연간합 (의류/ACC 구분 없이 계정 레벨)
      const prevRetailRow = retailDw2025?.brands[selectedBrand]
        ?.find((a) => a.account_id === acc.account_id);
      const prevRetailAnnual = prevRetailRow
        ? MONTHS.reduce((s, m) => s + (prevRetailRow.months[m] ?? 0), 0)
        : 0;
      const plYoy = prevRetailAnnual > 0
        ? Math.round((plSales / prevRetailAnnual) * 100)
        : null;

      // 기말재고
      const ending = base + apparelPurchase + accPurchase - plSales;

      return {
        accountId: acc.account_id,
        nameKr: accountNameMap[acc.account_id]?.account_nm_kr ?? "",
        nameEn: accountNameMap[acc.account_id]?.account_nm_en ?? acc.account_nm_en ?? "",
        base,
        apparelPurchase,
        accPurchase,
        inbound2025Annual,
        purchaseYoy,
        prevRetailAnnual,
        plSales,
        plYoy,
        ending,
        targetSales,
        targetEnding,
      };
    });
  }, [
    selectedBrand,
    data2025,
    data2026,
    inbound2025,
    inbound2026,
    blended2026,
    appOtb2026,
    storeRetailMap,
    accountNameMap,
    targetWeeks,
    sellThroughRates,
    retailDw2025,
  ]);

  // 브랜드 합계
  const totals = useMemo(() => {
    const sums = rows.reduce(
      (acc, r) => ({
        base: acc.base + r.base,
        apparelPurchase: acc.apparelPurchase + r.apparelPurchase,
        accPurchase: acc.accPurchase + r.accPurchase,
        inbound2025Annual: acc.inbound2025Annual + r.inbound2025Annual,
        prevRetailAnnual: acc.prevRetailAnnual + r.prevRetailAnnual,
        plSales: acc.plSales + r.plSales,
        ending: acc.ending + r.ending,
        targetSales: acc.targetSales + r.targetSales,
        targetEnding: acc.targetEnding + r.targetEnding,
      }),
      { base: 0, apparelPurchase: 0, accPurchase: 0, inbound2025Annual: 0, prevRetailAnnual: 0, plSales: 0, ending: 0, targetSales: 0, targetEnding: 0 }
    );
    const totalPurchase = sums.apparelPurchase + sums.accPurchase;
    return {
      ...sums,
      purchaseYoy: sums.inbound2025Annual > 0
        ? Math.round((totalPurchase / sums.inbound2025Annual) * 100)
        : null,
      plYoy: sums.prevRetailAnnual > 0
        ? Math.round((sums.plSales / sums.prevRetailAnnual) * 100)
        : null,
    };
  }, [rows]);

  const purchaseTotal = (r: SimuRow) => r.apparelPurchase + r.accPurchase;

  return (
    <div>

      <div className="min-w-0 flex-1">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-3 text-sm font-semibold tracking-[-0.02em] text-slate-700">
              <span>재고자산 시뮬레이션</span>
              <span className="text-slate-400">|</span>
              <span className="rounded border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-medium text-slate-500">
                천위안
              </span>
              <span className="text-slate-400">|</span>
              <span className="text-xs font-normal text-slate-400">
                기초: 25년말 · 매입: 26년 목표 · 판매: 26년 PL 연간목표 · 기말 = 기초+매입−판매
              </span>
            </h2>
          </div>

          <div className="overflow-auto rounded-xl border border-slate-200 shadow-sm max-h-[calc(100vh-260px)]">
            <table className="w-full min-w-[560px] border-collapse text-right text-sm">
              <thead className="sticky top-0 z-20">
                <tr className="border-b border-[#1e3a5f]/20 bg-[linear-gradient(180deg,#2d5a8e_0%,#245089_100%)] text-xs font-semibold text-white">
                  <th className="px-3 py-2.5 text-left">대리상</th>
                  <th className="px-3 py-2.5">기초재고</th>
                  {purchaseExpanded ? (
                    <>
                      <th className="border-l border-white/30 px-3 py-2.5">
                        <button
                          onClick={() => setPurchaseExpanded(false)}
                          className="flex items-center gap-1 ml-auto text-white/80 hover:text-white transition-colors"
                        >
                          <ChevronDownIcon className="h-3 w-3" />
                          매입(의류)
                        </button>
                      </th>
                      <th className="px-3 py-2.5">매입(ACC)</th>
                      <th className="px-3 py-2.5">매입YOY</th>
                    </>
                  ) : (
                    <>
                      <th className="border-l border-white/30 px-3 py-2.5">
                        <button
                          onClick={() => setPurchaseExpanded(true)}
                          className="flex items-center gap-1 ml-auto text-white/80 hover:text-white transition-colors"
                        >
                          <ChevronRightIcon className="h-3 w-3" />
                          매입
                        </button>
                      </th>
                      <th className="px-3 py-2.5">매입YOY</th>
                    </>
                  )}
                  <th className="border-l border-white/30 px-3 py-2.5">판매(BO.목표)</th>
                  <th className="px-3 py-2.5">판매YOY</th>
                  <th className="border-l border-white/30 px-3 py-2.5">기말재고</th>
                  <th className="px-3 py-2.5">YOY</th>
                </tr>
              </thead>
              <tbody>
                {/* 브랜드 합계 행 — 헤더 바로 아래 (스크롤 시 고정) */}
                <tr className="border-b-2 border-slate-300 bg-slate-100 font-semibold sticky top-[37px] z-[15] [&>td]:bg-slate-100 [&>td]:sticky [&>td]:top-[37px] [&>td]:z-[15]">
                  <td className="px-3 py-2.5 text-left text-slate-700">합계</td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-800">
                    {fmtCell(totals.base)}
                  </td>
                  {purchaseExpanded ? (
                    <>
                      <td className="border-l border-slate-200 px-3 py-2.5 tabular-nums text-slate-800">
                        {fmtCell(totals.apparelPurchase)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-800">
                        {fmtCell(totals.accPurchase)}
                      </td>
                      <td className={`px-3 py-2.5 tabular-nums font-bold ${totals.purchaseYoy === null ? "text-slate-400" : yoyColor(totals.apparelPurchase + totals.accPurchase, totals.inbound2025Annual)}`}>
                        {totals.purchaseYoy === null ? "—" : `${totals.purchaseYoy}%`}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="border-l border-slate-200 px-3 py-2.5 tabular-nums text-slate-800">
                        {fmtCell(totals.apparelPurchase + totals.accPurchase)}
                      </td>
                      <td className={`px-3 py-2.5 tabular-nums font-bold ${totals.purchaseYoy === null ? "text-slate-400" : yoyColor(totals.apparelPurchase + totals.accPurchase, totals.inbound2025Annual)}`}>
                        {totals.purchaseYoy === null ? "—" : `${totals.purchaseYoy}%`}
                      </td>
                    </>
                  )}
                  <td className="border-l border-slate-200 px-3 py-2.5 tabular-nums text-slate-800">
                    {fmtCell(totals.plSales)}
                  </td>
                  <td className={`px-3 py-2.5 tabular-nums font-bold ${totals.plYoy === null ? "text-slate-400" : yoyColor(totals.plSales, totals.prevRetailAnnual)}`}>
                    {totals.plYoy === null ? "—" : `${totals.plYoy}%`}
                  </td>
                  <td
                    className={`border-l border-slate-200 px-3 py-2.5 tabular-nums font-bold ${
                      totals.ending < 0 ? "text-red-500" : "text-slate-900"
                    }`}
                  >
                    {totals.ending > 0
                      ? fmtAmt(totals.ending)
                      : totals.ending < 0
                        ? `(${fmtAmt(-totals.ending)})`
                        : "—"}
                  </td>
                  <td className={`px-3 py-2.5 tabular-nums font-bold ${yoyColor(totals.ending, totals.base)}`}>
                    {fmtYoy(totals.ending, totals.base)}
                  </td>
                </tr>

                {rows.filter((r) => r.base + r.apparelPurchase + r.accPurchase + r.plSales > 10).map((r) => {
                  const rowNameLabel = dealerDisplayName(r.nameKr, r.nameEn);
                  return (
                  <tr
                    key={r.accountId}
                    className="border-b border-slate-100 transition-colors hover:bg-slate-50/60"
                  >
                    <td className="px-3 py-2 text-left">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-slate-400">({r.accountId})</span>
                        {rowNameLabel && (
                          <span
                            className="text-sm font-bold text-slate-800 cursor-default"
                            title={
                              r.nameKr.trim()
                                ? r.nameEn.trim() || undefined
                                : undefined
                            }
                          >
                            {rowNameLabel}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-700">
                      {fmtCell(r.base)}
                    </td>
                    {purchaseExpanded ? (
                      <>
                        <td className="border-l border-slate-200 px-3 py-2 tabular-nums text-slate-700">
                          {fmtCell(r.apparelPurchase)}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-slate-700">
                          {fmtCell(r.accPurchase)}
                        </td>
                        <td className={`px-3 py-2 tabular-nums font-semibold ${r.purchaseYoy === null ? "text-slate-400" : yoyColor(purchaseTotal(r), r.inbound2025Annual)}`}>
                          {r.purchaseYoy === null ? "—" : `${r.purchaseYoy}%`}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="border-l border-slate-200 px-3 py-2 tabular-nums text-slate-700">
                          {fmtCell(purchaseTotal(r))}
                        </td>
                        <td className={`px-3 py-2 tabular-nums font-semibold ${r.purchaseYoy === null ? "text-slate-400" : yoyColor(purchaseTotal(r), r.inbound2025Annual)}`}>
                          {r.purchaseYoy === null ? "—" : `${r.purchaseYoy}%`}
                        </td>
                      </>
                    )}
                    <td className="border-l border-slate-200 px-3 py-2 tabular-nums text-slate-700">
                      {fmtCell(r.plSales)}
                    </td>
                    <td className={`px-3 py-2 tabular-nums font-semibold ${r.plYoy === null ? "text-slate-400" : yoyColor(r.plSales, r.prevRetailAnnual)}`}>
                      {r.plYoy === null ? "—" : `${r.plYoy}%`}
                    </td>
                    <td
                      className={`border-l border-slate-200 px-3 py-2 tabular-nums font-semibold ${
                        r.ending < 0 ? "text-red-500" : "text-slate-800"
                      }`}
                    >
                      {r.ending > 0
                        ? fmtAmt(r.ending)
                        : r.ending < 0
                          ? `(${fmtAmt(-r.ending)})`
                          : "—"}
                    </td>
                    <td className={`px-3 py-2 tabular-nums font-semibold ${yoyColor(r.ending, r.base)}`}>
                      {fmtYoy(r.ending, r.base)}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
    </div>
  );
}
