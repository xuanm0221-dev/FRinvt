"use client";

import { useMemo, useState } from "react";
import {
  BrandKey,
  StockData,
  RetailData,
  InboundData,
  AppOtbData,
  MONTHS,
  StoreRetailMap,
  StoreDirectCostMap,
  type StoreDirectCost,
  type StoreRetailRow,
} from "../../lib/types";
import { fmtAmt } from "../../lib/utils";
import {
  mergeAccounts,
  computeAccountMetrics,
  DEFAULT_TARGET_WEEKS,
  DEFAULT_SELL_THROUGH_RATES,
  type SellThroughRates,
} from "../../lib/dealerMetrics";
import { blendRetail, type AccountNameMap } from "./StockView";

type SortColumn = "name" | "ending" | "opProfit";
type SortDir = "desc" | "asc";
type SortState = { col: SortColumn; dir: SortDir } | null; // null = 기본 순서

function totalEnding26(m: { apparel: { ending: number }; acc: { ending: number } }): number {
  return m.apparel.ending + m.acc.ending;
}

function sortIcon(state: SortState, col: SortColumn): string {
  if (!state || state.col !== col) return "↕";
  return state.dir === "desc" ? "↓" : "↑";
}
function ariaSort(state: SortState, col: SortColumn): "descending" | "ascending" | "none" {
  if (!state || state.col !== col) return "none";
  return state.dir === "desc" ? "descending" : "ascending";
}

// ── PL 계산 상수 (PLView.tsx의 PL_CALC와 동일) ───────────────────────
const OVW_PL = {
  vatFactor: 1.13,
  rentFixedDivisor: 1.05,
  marketingRate: 0.005,
  packagingRate: 0.015,
  payFeeRate: 0.002,
  payFeeFixed: 2000,
  othersRate: 0.005,
} as const;

// ── PL 헬퍼 함수 (PLView.tsx와 동일 공식) ────────────────────────────
function ovwCalcTag(retail: number, discountRate: number): number {
  const denom = 1 - discountRate;
  return denom <= 0 ? retail : retail / denom;
}

function ovwRentFixed(dc: StoreDirectCost): number {
  if (!dc || dc.rent <= 0) return 0;
  return dc.rent / OVW_PL.rentFixedDivisor;
}

function ovwRentVariable(retailM: number, dc: StoreDirectCost): number {
  const rate = dc.commissionRate ?? 0;
  return (retailM / OVW_PL.vatFactor) * rate;
}

function ovwRentTotal(retailM: number, dc: StoreDirectCost): number {
  return Math.max(ovwRentFixed(dc), ovwRentVariable(retailM, dc));
}

function ovwOtherCosts(retailM: number) {
  const base = retailM / OVW_PL.vatFactor;
  return {
    marketing:  base * OVW_PL.marketingRate,
    packaging:  base * OVW_PL.packagingRate,
    payFee:     base * OVW_PL.payFeeRate + OVW_PL.payFeeFixed,
    othersLine: base * OVW_PL.othersRate,
  };
}

function ovwDepr(
  interiorCost: number,
  openMonth: number,
  amortEndMonth: number,
  closedMonth: number | null,
  curYM: number,
): number {
  if (openMonth <= 0 || amortEndMonth <= 0) return 0;
  if (curYM < openMonth || curYM > amortEndMonth) return 0;
  if (closedMonth !== null && curYM > closedMonth) return 0;
  const sy = Math.floor(openMonth / 100), sm = openMonth % 100;
  const ey = Math.floor(amortEndMonth / 100), em = amortEndMonth % 100;
  const months = (ey - sy) * 12 + (em - sm) + 1;
  return months <= 0 ? 0 : interiorCost / months;
}

/**
 * 연간 대리상 영업이익 계산 (PLView "annual" 모드와 동일 공식)
 * retailFn: (store, month) → 해당 월 리테일 금액
 * yearBase: 2025 | 2026 — 감가상각 YM 기준연도
 */
function ovwCalcAnnualOpProfit(
  st: StoreRetailRow[],
  cogsRate: number,
  retailFn: (s: StoreRetailRow, mm: number) => number,
  dcMap: StoreDirectCostMap,
  yearBase: 2025 | 2026,
): number {
  let retail = 0, tag = 0;
  for (const s of st) {
    const annualRetail = MONTHS.reduce((sum, mm) => sum + retailFn(s, mm), 0);
    retail += annualRetail;
    tag += ovwCalcTag(annualRetail, s.discountRate);
  }
  const cogs = (tag * cogsRate) / OVW_PL.vatFactor;
  const grossProfit = retail / OVW_PL.vatFactor - cogs;

  let salary = 0, bonus = 0, insurance = 0, rent = 0, depr = 0,
      marketing = 0, packaging = 0, payFee = 0, othersLine = 0;

  for (const s of st) {
    const dc = dcMap[s.storeCode];
    if (!dc) continue;
    for (const mm of MONTHS) {
      const retailM = retailFn(s, mm);
      const curYM = yearBase * 100 + mm;
      const salM = dc.avgSalary * dc.headcount;
      const bonusM = retailM * dc.bonusRate;
      const insM = (salM + bonusM) * dc.insuranceRate;
      const deprM = ovwDepr(dc.interiorCost, dc.openMonth, dc.amortEndMonth, dc.closedMonth, curYM);
      const oc = ovwOtherCosts(retailM);
      salary += salM; bonus += bonusM; insurance += insM;
      rent += ovwRentTotal(retailM, dc); depr += deprM;
      marketing += oc.marketing; packaging += oc.packaging;
      payFee += oc.payFee; othersLine += oc.othersLine;
    }
  }
  const directCost = salary + bonus + insurance + rent + depr + marketing + packaging + payFee + othersLine;
  return grossProfit - directCost;
}

/**
 * PL "26년 연간TGT"와 동일: TGT 시뮬 리테일 + CSV 대리상 가중 할인율 + CSV 출고율 + CSV 직접비(12개월)
 */
function ovwCalcTgtOpProfit(
  tgtRetail: number,
  st: StoreRetailRow[],
  cogsRate: number,
  dcMap: StoreDirectCostMap,
): number {
  const annualRetailCsv = st.reduce(
    (sum, s) => sum + MONTHS.reduce((ms, mm) => ms + (s.months[mm] ?? 0), 0),
    0,
  );
  const annualTagCsv = st.reduce((sum, s) => {
    const sr = MONTHS.reduce((ms, mm) => ms + (s.months[mm] ?? 0), 0);
    return sum + ovwCalcTag(sr, s.discountRate);
  }, 0);
  const tag = annualRetailCsv > 0 ? tgtRetail * (annualTagCsv / annualRetailCsv) : tgtRetail;

  const cogs = (tag * cogsRate) / OVW_PL.vatFactor;
  const grossProfit = tgtRetail / OVW_PL.vatFactor - cogs;

  let salary = 0, bonus = 0, insurance = 0, rent = 0, depr = 0,
      marketing = 0, packaging = 0, payFee = 0, othersLine = 0;

  for (const s of st) {
    const dc = dcMap[s.storeCode];
    if (!dc) continue;
    for (const mm of MONTHS) {
      const retailM = s.months[mm] ?? 0;
      const curYM = 2026 * 100 + mm;
      const salM = dc.avgSalary * dc.headcount;
      const bonusM = retailM * dc.bonusRate;
      const insM = (salM + bonusM) * dc.insuranceRate;
      const deprM = ovwDepr(dc.interiorCost, dc.openMonth, dc.amortEndMonth, dc.closedMonth, curYM);
      const oc = ovwOtherCosts(retailM);
      salary += salM; bonus += bonusM; insurance += insM;
      rent += ovwRentTotal(retailM, dc); depr += deprM;
      marketing += oc.marketing; packaging += oc.packaging;
      payFee += oc.payFee; othersLine += oc.othersLine;
    }
  }
  const directCost = salary + bonus + insurance + rent + depr + marketing + packaging + payFee + othersLine;
  return grossProfit - directCost;
}

// ── BO.목표 Tag 매출 계산 (StockSimuView.annualPlTag와 동일) ─────────
function annualPlTag(
  storeRetailMap: StoreRetailMap,
  brand: BrandKey,
  accountId: string,
): number {
  const stores = storeRetailMap[brand]?.[accountId] ?? [];
  return stores.reduce((sum, s) => {
    const retail = MONTHS.reduce((ms, mm) => ms + (s.months[mm] ?? 0), 0);
    const denom = 1 - s.discountRate;
    return sum + (denom > 0 ? retail / denom : retail);
  }, 0);
}

// ─────────────────────────────────────────────────────────────────────

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

/** 차이값 표시: unit="pp" → "+1.2%p", unit="주" → "+2.3주" */
function Diff({ v, unit }: { v: number | null; unit: "pp" | "주" }) {
  if (v === null) return <span />;
  const sign = v >= 0 ? "+" : "";
  const cls = v >= 0 ? "text-green-600" : "text-red-500";
  const label =
    unit === "pp"
      ? `${sign}${v.toFixed(1)}%p`
      : `${sign}${v.toFixed(1)}주`;
  return <span className={cls}>{label}</span>;
}

/** 금액 차이: +X,XXX 형태 */
function DiffAmt({ v }: { v: number | null }) {
  if (v === null) return <span />;
  const sign = v >= 0 ? "+" : "";
  const cls = v >= 0 ? "text-green-600" : "text-red-500";
  return <span className={cls}>{sign}{fmtAmt(Math.round(v))}</span>;
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
  growthRates: Record<BrandKey, number>;
  targetWeeks?: Record<string, number>;
  sellThroughRates?: SellThroughRates;
  storeRetailMap?: StoreRetailMap;
  storeDirectCostMap?: StoreDirectCostMap;
  cogsRateMap?: Record<string, Record<string, number>>;
  retailYoy2025Map?: Record<string, Record<number, number>> | null;
}

/**
 * 재고자산(TGT) 2026 대리상표와 동일 입력으로 mergeAccounts + computeAccountMetrics 결과만 표시.
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
  growthRates,
  targetWeeks: targetWeeksProp,
  sellThroughRates: sellThroughRatesProp,
  storeRetailMap,
  storeDirectCostMap,
  cogsRateMap,
  retailYoy2025Map,
}: OverviewScenario1TableProps) {
  const targetWeeks = targetWeeksProp ?? DEFAULT_TARGET_WEEKS;
  const sellThroughRates = sellThroughRatesProp ?? DEFAULT_SELL_THROUGH_RATES;
  const [sortState, setSortState] = useState<SortState>(null);

  const cycleSort = (col: SortColumn) => {
    setSortState((s) => {
      if (!s || s.col !== col) return { col, dir: "desc" };
      if (s.dir === "desc") return { col, dir: "asc" };
      return null;
    });
  };

  const { metrics, totalRow, metrics2025Map, totalRow2025, opProfit2026Map, opProfit2025Map, opProfitTgt2026Map, boSalesMap, prevSalesMap, boEndingMap, boBaseMap } = useMemo(() => {
    const blended =
      retail2026
        ? blendRetail(retail2026, growthRates, retailDw2025)
        : null;
    const retailForTable = blended?.data ?? retail2026;

    const merged = mergeAccounts(
      brand,
      data2026,
      retailForTable,
      inbound2026,
      appOtb2026
    );

    // ── 2026 metrics ──────────────────────────────────
    const all2026 =
      data2026 && retailForTable
        ? merged.map((acc) =>
            computeAccountMetrics(
              acc,
              brand,
              data2026,
              data2025,
              retailForTable,
              retailDw2025,
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
                retailDw2025,
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

    // ── 2025 metrics (전년비용) ─────────────────────────
    const all2025 =
      data2025 && retailDw2025
        ? merged.map((acc) =>
            computeAccountMetrics(
              acc,
              brand,
              data2025,
              null,
              retailDw2025,
              null,
              inbound2025 ?? null,
              null,
              null,
              "2025",
              targetWeeks,
              sellThroughRates
            )
          )
        : [];
    const metrics2025Map = new Map(all2025.map((m) => [m.account_id, m]));

    // ── 영업이익 계산 (PLView 연간목표/연간실적과 동일 공식) ────────────
    const opProfit2026Map = new Map<string, number>();
    const opProfit2025Map = new Map<string, number>();

    if (storeRetailMap && storeDirectCostMap && cogsRateMap) {
      const brandStores = storeRetailMap[brand] ?? {};
      const brandCogsMap = cogsRateMap[brand] ?? {};
      const globalAvg = cogsRateMap["평균"]?.["평균"] ?? 0.441;

      for (const [accountId, st] of Object.entries(brandStores)) {
        const cogsRate = brandCogsMap[accountId] ?? globalAvg;

        // 2026 연간목표
        opProfit2026Map.set(
          accountId,
          ovwCalcAnnualOpProfit(st, cogsRate, (s, mm) => s.months[mm] ?? 0, storeDirectCostMap, 2026)
        );

        // 2025 연간실적
        if (retailYoy2025Map) {
          opProfit2025Map.set(
            accountId,
            ovwCalcAnnualOpProfit(st, cogsRate, (s, mm) => retailYoy2025Map[s.storeCode]?.[mm] ?? 0, storeDirectCostMap, 2025)
          );
        }
      }
    }

    const opProfitTgt2026Map = new Map<string, number>();
    if (storeRetailMap && storeDirectCostMap && cogsRateMap) {
      const brandStoresTgt = storeRetailMap[brand] ?? {};
      const brandCogsMapTgt = cogsRateMap[brand] ?? {};
      const globalAvgTgt = cogsRateMap["평균"]?.["평균"] ?? 0.441;
      for (const m of filtered) {
        const st = brandStoresTgt[m.account_id] ?? [];
        const cogsRate = brandCogsMapTgt[m.account_id] ?? globalAvgTgt;
        const tgtRetail = m.apparel.sales + m.acc.sales;
        opProfitTgt2026Map.set(
          m.account_id,
          ovwCalcTgtOpProfit(tgtRetail, st, cogsRate, storeDirectCostMap),
        );
      }
    }

    // ── 2026 totalRow ─────────────────────────────────
    let totalRow: {
      apparel: { sellThrough: number | null; salesYoyPos: number | null; ending: number };
      acc: { weeks: number | null; salesYoyPos: number | null; ending: number };
      opProfit: number;
      opProfitTgt: number;
      tgtSales: number;
      boSales: number;
      salesYoyTotal: number | null;
      prevSalesTotal: number;
      boEnding: number;
      boBase: number;
    } | null = null;

    if (filtered.length > 0) {
      const apparelBase = filtered.reduce((s, m) => s + m.apparel.base, 0);
      const apparelPurchase = filtered.reduce((s, m) => s + m.apparel.purchase, 0);
      const apparelSales = filtered.reduce((s, m) => s + m.apparel.sales, 0);
      const apparelEnding = filtered.reduce((s, m) => s + m.apparel.ending, 0);
      const accSales = filtered.reduce((s, m) => s + m.acc.sales, 0);
      const accEnding = filtered.reduce((s, m) => s + m.acc.ending, 0);

      const sumPosCurrA = filtered.reduce((s, m) => s + (m.apparel.retailSalesPos ?? 0), 0);
      const sumPosPrevA = filtered.reduce((s, m) => s + (m.apparel.prevRetailSalesPos ?? 0), 0);
      const sumPosCurrAcc = filtered.reduce((s, m) => s + (m.acc.retailSalesPos ?? 0), 0);
      const sumPosPrevAcc = filtered.reduce((s, m) => s + (m.acc.prevRetailSalesPos ?? 0), 0);

      const totalOpProfit2026 = filtered.reduce(
        (s, m) => s + (opProfit2026Map.get(m.account_id) ?? 0), 0
      );

      const totalOpProfitTgt2026 = filtered.reduce(
        (s, m) => s + (opProfitTgt2026Map.get(m.account_id) ?? 0), 0
      );

      // ── TGT 당년매출 합계 (의류+ACC sales 합산) ────────────────────
      const tgtTotalSales = filtered.reduce((s, m) => s + m.apparel.sales + m.acc.sales, 0);

      // ── BO.목표 매출 합계 (annualPlTag) ────────────────────────────
      const boTotalSales = storeRetailMap
        ? filtered.reduce((s, m) => s + annualPlTag(storeRetailMap, brand, m.account_id), 0)
        : 0;

      // ── 매출성장율 합계 YOY ────────────────────────────────────────
      const totalSalesYoyTotal =
        (sumPosPrevA + sumPosPrevAcc) > 0
          ? ((sumPosCurrA + sumPosCurrAcc) / (sumPosPrevA + sumPosPrevAcc)) * 100
          : null;

      totalRow = {
        apparel: {
          sellThrough: apparelBase + apparelPurchase > 0 ? (apparelSales / (apparelBase + apparelPurchase)) * 100 : null,
          salesYoyPos: sumPosPrevA === 0 ? null : (sumPosCurrA / sumPosPrevA) * 100,
          ending: apparelEnding,
        },
        acc: {
          weeks: accSales > 0 ? accEnding / ((accSales / 365) * 7) : null,
          salesYoyPos: sumPosPrevAcc === 0 ? null : (sumPosCurrAcc / sumPosPrevAcc) * 100,
          ending: accEnding,
        },
        opProfit: totalOpProfit2026,
        opProfitTgt: totalOpProfitTgt2026,
        tgtSales: tgtTotalSales,
        boSales: boTotalSales,
        salesYoyTotal: totalSalesYoyTotal,
        prevSalesTotal: sumPosPrevA + sumPosPrevAcc,
        boEnding: filtered.reduce((s, m) => {
          const m25 = metrics2025Map.get(m.account_id);
          const base = m25 ? m25.apparel.ending + m25.acc.ending : 0;
          const plSales = storeRetailMap ? annualPlTag(storeRetailMap, brand, m.account_id) : 0;
          return s + base + m.apparel.purchase + m.acc.purchase - plSales;
        }, 0),
        boBase: filtered.reduce((s, m) => {
          const m25 = metrics2025Map.get(m.account_id);
          return s + (m25 ? m25.apparel.ending + m25.acc.ending : 0);
        }, 0),
      };
    }

    // ── 대리상별 boSalesMap ────────────────────────────
    const boSalesMap = new Map<string, number>();
    if (storeRetailMap) {
      for (const m of filtered) {
        boSalesMap.set(m.account_id, annualPlTag(storeRetailMap, brand, m.account_id));
      }
    }

    // ── 대리상별 prevSalesMap (TGT 전년 POS 매출) ─────
    const prevSalesMap = new Map<string, number>();
    for (const m of filtered) {
      const prev = (m.apparel.prevRetailSalesPos ?? 0) + (m.acc.prevRetailSalesPos ?? 0);
      prevSalesMap.set(m.account_id, prev);
    }

    // ── 대리상별 boEndingMap / boBaseMap (BO.목표 기말재고) ─
    const boEndingMap = new Map<string, number>();
    const boBaseMap   = new Map<string, number>();
    for (const m of filtered) {
      const m25  = metrics2025Map.get(m.account_id);
      const base = m25 ? m25.apparel.ending + m25.acc.ending : 0;
      const plSales = boSalesMap.get(m.account_id) ?? 0;
      boEndingMap.set(m.account_id, base + m.apparel.purchase + m.acc.purchase - plSales);
      boBaseMap.set(m.account_id, base);
    }

    // ── 2025 totalRow ─────────────────────────────────
    let totalRow2025: {
      apparel: { sellThrough: number | null; ending: number };
      acc: { weeks: number | null; ending: number };
      opProfit: number;
    } | null = null;

    const filtered2025 = all2025.filter((m) => metrics2025Map.has(m.account_id));
    if (filtered2025.length > 0) {
      const apparelBase25 = filtered2025.reduce((s, m) => s + m.apparel.base, 0);
      const apparelPurchase25 = filtered2025.reduce((s, m) => s + m.apparel.purchase, 0);
      const apparelSales25 = filtered2025.reduce((s, m) => s + m.apparel.sales, 0);
      const apparelEnding25 = filtered2025.reduce((s, m) => s + m.apparel.ending, 0);
      const accSales25 = filtered2025.reduce((s, m) => s + m.acc.sales, 0);
      const accEnding25 = filtered2025.reduce((s, m) => s + m.acc.ending, 0);

      const totalOpProfit2025 = filtered2025.reduce(
        (s, m) => s + (opProfit2025Map.get(m.account_id) ?? 0), 0
      );

      totalRow2025 = {
        apparel: {
          sellThrough: apparelBase25 + apparelPurchase25 > 0 ? (apparelSales25 / (apparelBase25 + apparelPurchase25)) * 100 : null,
          ending: apparelEnding25,
        },
        acc: {
          weeks: accSales25 > 0 ? accEnding25 / ((accSales25 / 365) * 7) : null,
          ending: accEnding25,
        },
        opProfit: totalOpProfit2025,
      };
    }

    return { metrics: filtered, totalRow, metrics2025Map, totalRow2025, opProfit2026Map, opProfit2025Map, opProfitTgt2026Map, boSalesMap, prevSalesMap, boEndingMap, boBaseMap };
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
    storeRetailMap,
    storeDirectCostMap,
    cogsRateMap,
    retailYoy2025Map,
  ]);

  const displayMetrics = useMemo(() => {
    if (!sortState) return metrics;
    const { col, dir } = sortState;
    const arr = [...metrics];
    arr.sort((a, b) => {
      let ka: number | string;
      let kb: number | string;
      if (col === "ending") {
        ka = totalEnding26(a);
        kb = totalEnding26(b);
      } else if (col === "opProfit") {
        ka = opProfit2026Map.get(a.account_id) ?? -Infinity;
        kb = opProfit2026Map.get(b.account_id) ?? -Infinity;
      } else {
        const nameA = accountNameMap[a.account_id]?.account_nm_kr || accountNameMap[a.account_id]?.account_nm_en || a.account_nm_en || a.account_id;
        const nameB = accountNameMap[b.account_id]?.account_nm_kr || accountNameMap[b.account_id]?.account_nm_en || b.account_nm_en || b.account_id;
        ka = nameA;
        kb = nameB;
      }
      if (typeof ka === "string" && typeof kb === "string") {
        const cmp = ka.localeCompare(kb, "ko", { sensitivity: "base" });
        return dir === "desc" ? -cmp : cmp;
      }
      const diff = (ka as number) - (kb as number);
      if (diff !== 0) return dir === "desc" ? -diff : diff;
      return String(a.account_id).localeCompare(String(b.account_id), undefined, { numeric: true });
    });
    return arr;
  }, [metrics, sortState, opProfit2026Map, accountNameMap]);

  const th =
    "px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-white border-b border-white/20";
  const thSub =
    "px-2 py-1.5 text-center text-[10px] font-medium text-white/80 border-b border-white/15";
  const td = "px-3 py-2 text-right tabular-nums text-sm text-slate-700 border-b border-slate-100";
  const tdLabel = "px-2 py-2 text-left text-xs text-slate-800 border-b border-slate-100 whitespace-nowrap";

  // 전체기준 전년비 계산
  const totalSellThroughDiff =
    totalRow?.apparel.sellThrough != null && totalRow2025?.apparel.sellThrough != null
      ? totalRow.apparel.sellThrough - totalRow2025.apparel.sellThrough
      : null;
  const totalWeeksDiff =
    totalRow?.acc.weeks != null && totalRow2025?.acc.weeks != null
      ? totalRow.acc.weeks - totalRow2025.acc.weeks
      : null;
  const totalEndingYoy =
    totalRow && totalRow2025 && (totalRow.apparel.ending + totalRow.acc.ending) > 0 &&
    (totalRow2025.apparel.ending + totalRow2025.acc.ending) > 0
      ? ((totalRow.apparel.ending + totalRow.acc.ending) /
          (totalRow2025.apparel.ending + totalRow2025.acc.ending)) * 100
      : null;
  const totalOpProfitDiff =
    totalRow && totalRow2025
      ? totalRow.opProfit - totalRow2025.opProfit
      : null;
  const totalOpProfitTgtDiff =
    totalRow && totalRow2025
      ? totalRow.opProfitTgt - totalRow2025.opProfit
      : null;

  return (
    <div className="shrink-0 min-w-0">
      <div className="w-fit overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
        <table className="w-auto border-collapse text-right">
          <thead>
            {/* 0단: 그룹 헤더 */}
            <tr className="bg-[#1e4277]">
              <th
                rowSpan={3}
                className="border-b border-white/20 border-r border-white/25 p-0 text-left align-middle text-[10px] font-semibold uppercase tracking-wide text-white whitespace-nowrap"
                aria-sort={ariaSort(sortState, "name")}
              >
                <button
                  type="button"
                  onClick={() => cycleSort("name")}
                  title={!sortState || sortState.col !== "name" ? "대리상명칭 가나다순 — 클릭: 내림차순" : sortState.dir === "desc" ? "내림차순 — 클릭: 오름차순" : "오름차순 — 클릭: 기본 순서로"}
                  className="flex w-full items-center justify-start gap-1 rounded-md px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                >
                  대리상명칭
                  <span className="opacity-90" aria-hidden>{sortIcon(sortState, "name")}</span>
                </button>
              </th>
              <th colSpan={15} className={`${th} border-l border-white/20 text-left text-[11px]`}>
                (TGT) 재고&amp;손익
              </th>
              <th colSpan={7} className={`${th} border-l-2 border-l-white/60 text-left text-[11px] bg-[#115e59]`}>
                (BO.목표) 재고&amp;손익
              </th>
            </tr>
            {/* 1단 헤더 */}
            <tr className="bg-[#245089]">
              {/* TGT 컬럼들 */}
              <th rowSpan={2} className={`${thSub} align-middle border-l border-white/20`}>당년매출</th>
              <th rowSpan={2} className={`${thSub} align-middle border-l border-white/20`}>BO목표대비</th>
              <th colSpan={3} className={`${thSub} border-l border-white/20`}>매출성장율</th>
              <th colSpan={2} className={`${thSub} border-l border-white/20`}>의류판매율</th>
              <th colSpan={2} className={`${thSub} border-l border-white/20`}>재고주수</th>
              <th
                colSpan={3}
                className="border-b border-white/15 border-l border-white/20 p-0 text-center text-[10px] font-medium text-white/80"
                aria-sort={ariaSort(sortState, "ending")}
              >
                <button
                  type="button"
                  onClick={() => cycleSort("ending")}
                  title={!sortState || sortState.col !== "ending" ? "기말재고(의류+ACC) 합계 기준 — 클릭: 높은 순" : sortState.dir === "desc" ? "내림차순 — 클릭: 낮은 순" : "오름차순 — 클릭: 기본 순서로"}
                  className="flex w-full items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-[10px] font-medium text-white/80 transition-colors hover:bg-white/10 focus:outline-none"
                >
                  기말재고
                  <span className="tabular-nums opacity-90" aria-hidden>{sortIcon(sortState, "ending")}</span>
                </button>
              </th>
              <th
                colSpan={3}
                className="border-b border-white/15 border-l border-white/20 p-0 text-center text-[10px] font-medium text-white/80"
                aria-sort={ariaSort(sortState, "opProfit")}
              >
                <button
                  type="button"
                  onClick={() => cycleSort("opProfit")}
                  title={!sortState || sortState.col !== "opProfit" ? "영업이익 기준 — 클릭: 높은 순" : sortState.dir === "desc" ? "내림차순 — 클릭: 낮은 순" : "오름차순 — 클릭: 기본 순서로"}
                  className="flex w-full items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-[10px] font-medium text-white/80 transition-colors hover:bg-white/10 focus:outline-none"
                >
                  영업이익(TGT)
                  <span className="tabular-nums opacity-90" aria-hidden>{sortIcon(sortState, "opProfit")}</span>
                </button>
              </th>
              {/* BO.목표 컬럼들 */}
              <th rowSpan={2} className={`${thSub} align-middle border-l-2 border-l-white/60 bg-[#0f766e]`}>당년매출</th>
              <th rowSpan={2} className={`${thSub} align-middle border-l border-white/20 bg-[#0f766e]`}>매출성장율</th>
              <th colSpan={2} className={`${thSub} border-l border-white/20 bg-[#0f766e]`}>기말재고</th>
              <th colSpan={3} className={`${thSub} border-l border-white/20 bg-[#0f766e]`}>영업이익</th>

            </tr>
            {/* 2단 헤더 */}
            <tr className="bg-[#2d5a8e]">
              {/* TGT 2단 */}
              <th className={`${thSub} border-l border-white/20`}>의류</th>
              <th className={thSub}>ACC</th>
              <th className={thSub}>합계</th>
              <th className={`${thSub} border-l border-white/20`}>당년</th>
              <th className={thSub}>전년비</th>
              <th className={`${thSub} border-l border-white/20`}>당년</th>
              <th className={thSub}>전년비</th>
              <th className={`${thSub} border-l border-white/20`}>당년</th>
              <th className={thSub}>전년비</th>
              <th className={thSub}>전년비(%)</th>
              <th className={`${thSub} border-l border-white/20`}>당년</th>
              <th className={thSub}>전년비</th>
              <th className={thSub}>전년비(%)</th>
              {/* BO.목표 2단 */}
              <th className={`${thSub} border-l border-white/20 bg-[#0d9488]`}>당년</th>
              <th className={`${thSub} bg-[#0d9488]`}>전년비</th>
              <th className={`${thSub} border-l border-white/20 bg-[#0d9488]`}>당년</th>
              <th className={`${thSub} bg-[#0d9488]`}>전년비</th>
              <th className={`${thSub} bg-[#0d9488]`}>전년비(%)</th>
            </tr>
          </thead>
          <tbody>
            {totalRow && (
              <tr className="bg-slate-200/70 font-semibold">
                <td className={`${tdLabel} bg-slate-200/70`}>전체기준</td>
                {/* 당년매출 / BO목표대비 */}
                <td className={`${td} border-l border-l-slate-300`}><Num v={totalRow.tgtSales} /></td>
                <td className={`${td} border-l border-l-slate-300`}>
                  <Yoy v={totalRow.boSales > 0 ? (totalRow.tgtSales / totalRow.boSales) * 100 : null} />
                </td>
                {/* 매출성장율 의류 / ACC / 합계 */}
                <td className={`${td} border-l border-l-slate-300`}><Yoy v={totalRow.apparel.salesYoyPos} /></td>
                <td className={td}><Yoy v={totalRow.acc.salesYoyPos} /></td>
                <td className={td}><Yoy v={totalRow.salesYoyTotal} /></td>
                {/* 의류판매율 당년 / 전년비 */}
                <td className={`${td} border-l border-l-slate-300`}>
                  {totalRow.apparel.sellThrough != null
                    ? `${totalRow.apparel.sellThrough.toFixed(1)}%`
                    : ""}
                </td>
                <td className={td}><Diff v={totalSellThroughDiff} unit="pp" /></td>
                {/* 재고주수 당년 / 전년비 */}
                <td className={`${td} border-l border-l-slate-300 ${totalRow.acc.weeks != null && totalRow.acc.weeks >= 30 ? "text-red-500" : totalRow.acc.weeks != null ? "text-violet-600" : ""}`}>
                  {totalRow.acc.weeks != null ? `${totalRow.acc.weeks.toFixed(1)}주` : ""}
                </td>
                <td className={td}><Diff v={totalWeeksDiff} unit="주" /></td>
                {/* 기말재고 당년 / 전년비(금액) / 전년비(%) */}
                <td className={`${td} border-l border-l-slate-300`}>
                  <Num v={totalRow.apparel.ending + totalRow.acc.ending} />
                </td>
                <td className={td}>
                  <DiffAmt v={totalRow2025
                    ? (totalRow.apparel.ending + totalRow.acc.ending) - (totalRow2025.apparel.ending + totalRow2025.acc.ending)
                    : null} />
                </td>
                <td className={td}><Yoy v={totalEndingYoy} /></td>
                <td className={`${td} border-l border-l-slate-300 ${totalRow.opProfitTgt >= 0 ? "text-green-600" : "text-red-500"}`}>
                  <Num v={totalRow.opProfitTgt} />
                </td>
                <td className={td}><DiffAmt v={totalOpProfitTgtDiff} /></td>
                <td className={td}>
                  <Yoy v={totalRow2025 && totalRow2025.opProfit !== 0
                    ? (totalRow.opProfitTgt / totalRow2025.opProfit) * 100
                    : null} />
                </td>
                {/* BO.목표: 당년매출 / 매출성장율 / 기말재고(당년/전년비) / 영업이익(당년/전년비/전년비%) */}
                <td className={`${td} border-l-2 border-l-slate-400`}><Num v={totalRow.boSales} /></td>
                <td className={td}>
                  <Yoy v={totalRow.prevSalesTotal > 0 ? (totalRow.boSales / totalRow.prevSalesTotal) * 100 : null} />
                </td>
                <td className={`${td} border-l border-l-slate-300`}><Num v={totalRow.boEnding} /></td>
                <td className={td}>
                  <Yoy v={totalRow.boBase > 0 ? (totalRow.boEnding / totalRow.boBase) * 100 : null} />
                </td>
                <td className={`${td} border-l border-l-slate-300 ${totalRow.opProfit >= 0 ? "text-green-600" : "text-red-500"}`}>
                  <Num v={totalRow.opProfit} />
                </td>
                <td className={td}><DiffAmt v={totalOpProfitDiff} /></td>
                <td className={td}>
                  <Yoy v={totalRow2025 && totalRow2025.opProfit !== 0
                    ? (totalRow.opProfit / totalRow2025.opProfit) * 100
                    : null} />
                </td>
              </tr>
            )}
            {displayMetrics.map((m) => {
              const names = accountNameMap[m.account_id];
              const displayEn = names?.account_nm_en || m.account_nm_en;
              const displayKr = names?.account_nm_kr;
              const prev = metrics2025Map.get(m.account_id);

              const sellThroughDiff =
                m.apparel.sellThrough != null && prev?.apparel.sellThrough != null
                  ? m.apparel.sellThrough - prev.apparel.sellThrough
                  : null;
              const weeksDiff =
                m.acc.weeks != null && prev?.acc.weeks != null
                  ? m.acc.weeks - prev.acc.weeks
                  : null;
              const curr26Ending = m.apparel.ending + m.acc.ending;
              const prev25Ending = prev ? (prev.apparel.ending + prev.acc.ending) : 0;
              const endingYoy =
                prev25Ending > 0 ? (curr26Ending / prev25Ending) * 100 : null;

              const op2026 = opProfit2026Map.get(m.account_id) ?? null;
              const op2025 = opProfit2025Map.get(m.account_id) ?? null;
              const opDiff = op2026 !== null && op2025 !== null ? op2026 - op2025 : null;
              const opYoy = op2026 !== null && op2025 !== null && op2025 !== 0
                ? (op2026 / op2025) * 100
                : null;

              const opTgtV = opProfitTgt2026Map.get(m.account_id);
              const opTgt2026 = opTgtV !== undefined ? opTgtV : null;
              const opTgtDiff = opTgt2026 !== null && op2025 !== null ? opTgt2026 - op2025 : null;
              const opTgtYoy = opTgt2026 !== null && op2025 !== null && op2025 !== 0
                ? (opTgt2026 / op2025) * 100
                : null;

              return (
                <tr key={m.account_id} className="hover:bg-slate-50/50">
                  <td className={tdLabel}>
                    <span className="cursor-default text-sm" title={displayEn || undefined}>
                      ({m.account_id}) {displayKr || displayEn}
                    </span>
                  </td>
                  {/* 당년매출 / BO목표대비 */}
                  {(() => {
                    const tgtSales = m.apparel.sales + m.acc.sales;
                    const boSales = boSalesMap.get(m.account_id) ?? 0;
                    const boCompare = boSales > 0 ? (tgtSales / boSales) * 100 : null;
                    const salesYoyTotal =
                      (m.apparel.prevRetailSalesPos ?? 0) + (m.acc.prevRetailSalesPos ?? 0) > 0
                        ? (((m.apparel.retailSalesPos ?? 0) + (m.acc.retailSalesPos ?? 0)) /
                           ((m.apparel.prevRetailSalesPos ?? 0) + (m.acc.prevRetailSalesPos ?? 0))) * 100
                        : null;
                    return (
                      <>
                        <td className={`${td} border-l border-l-slate-200`}><Num v={tgtSales} /></td>
                        <td className={`${td} border-l border-l-slate-200`}><Yoy v={boCompare} /></td>
                        {/* 매출성장율 의류 / ACC / 합계 */}
                        <td className={`${td} border-l border-l-slate-200`}><Yoy v={m.apparel.salesYoyPos ?? null} /></td>
                        <td className={td}><Yoy v={m.acc.salesYoyPos ?? null} /></td>
                        <td className={td}><Yoy v={salesYoyTotal} /></td>
                      </>
                    );
                  })()}
                  {/* 의류판매율 당년 / 전년비 */}
                  <td className={`${td} border-l border-l-slate-200`}>
                    {m.apparel.sellThrough != null
                      ? `${m.apparel.sellThrough.toFixed(1)}%`
                      : ""}
                  </td>
                  <td className={td}><Diff v={sellThroughDiff} unit="pp" /></td>
                  {/* 재고주수 당년 / 전년비 */}
                  <td className={`${td} border-l border-l-slate-200 ${m.acc.weeks != null && m.acc.weeks >= 30 ? "text-red-500 font-medium" : m.acc.weeks != null ? "text-violet-600" : ""}`}>
                    {m.acc.weeks != null ? `${m.acc.weeks.toFixed(1)}주` : ""}
                  </td>
                  <td className={td}><Diff v={weeksDiff} unit="주" /></td>
                  {/* 기말재고 당년 / 전년비(금액) / 전년비(%) */}
                  <td className={`${td} border-l border-l-slate-200`}><Num v={curr26Ending} /></td>
                  <td className={td}><DiffAmt v={prev25Ending > 0 ? curr26Ending - prev25Ending : null} /></td>
                  <td className={td}><Yoy v={endingYoy} /></td>
                  <td className={`${td} border-l border-l-slate-200 ${opTgt2026 !== null && opTgt2026 >= 0 ? "text-green-600" : opTgt2026 !== null ? "text-red-500" : ""}`}>
                    {opTgt2026 !== null ? <Num v={opTgt2026} /> : ""}
                  </td>
                  <td className={td}><DiffAmt v={opTgtDiff} /></td>
                  <td className={td}><Yoy v={opTgtYoy} /></td>
                  {/* BO.목표: 당년매출 / 매출성장율 / 기말재고 / 영업이익 */}
                  <td className={`${td} border-l-2 border-l-slate-300`}><Num v={boSalesMap.get(m.account_id) ?? 0} /></td>
                  <td className={td}>
                    <Yoy v={(prevSalesMap.get(m.account_id) ?? 0) > 0
                      ? (boSalesMap.get(m.account_id) ?? 0) / (prevSalesMap.get(m.account_id) ?? 1) * 100
                      : null} />
                  </td>
                  <td className={`${td} border-l border-l-slate-200`}><Num v={boEndingMap.get(m.account_id) ?? 0} /></td>
                  <td className={td}>
                    <Yoy v={(boBaseMap.get(m.account_id) ?? 0) > 0
                      ? (boEndingMap.get(m.account_id) ?? 0) / (boBaseMap.get(m.account_id) ?? 1) * 100
                      : null} />
                  </td>
                  <td className={`${td} border-l border-l-slate-200 ${op2026 !== null && op2026 >= 0 ? "text-green-600" : op2026 !== null ? "text-red-500" : ""}`}>
                    {op2026 !== null ? <Num v={op2026} /> : ""}
                  </td>
                  <td className={td}><DiffAmt v={opDiff} /></td>
                  <td className={td}><Yoy v={opYoy} /></td>
                </tr>
              );
            })}
            {metrics.length === 0 && (
              <tr>
                <td
                  colSpan={23}
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
        수치는 재고자산(TGT) 탭 2026년 대리상표와 동일한 계산입니다. 성장률·재고주수·Sell
        through 변경 시 함께 반영됩니다.
      </p>
    </div>
  );
}
