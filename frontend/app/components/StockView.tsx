"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  StockData,
  InboundData,
  RetailData,
  RetailRow,
  AccountRow,
  CategoryGroup,
  SubCategoryRow,
  AppOtbData,
  BrandKey,
  BRAND_ORDER,
  MONTHS,
} from "../../lib/types";
import StockTable from "./StockTable";
import InboundTable from "./InboundTable";
import RetailTable from "./RetailTable";
import DealerDetailTable from "./DealerDetailTable";
import AppOtbTable from "./AppOtbTable";
import RetailPlan2026Table from "./RetailPlan2026Table";
import { fmtAmt } from "../../lib/utils";
import { DEFAULT_TARGET_WEEKS, DEFAULT_SELL_THROUGH_RATES, type SellThroughRates } from "../../lib/dealerMetrics";

export type AccountNameMap = Record<string, { account_nm_en: string; account_nm_kr: string }>;

interface Props {
  data2025: StockData | null;
  data2026: StockData | null;
  inbound2025: InboundData | null;
  inbound2026: InboundData | null;
  retail2026: RetailData | null;
  retailPlan2026: RetailData | null;
  retailPos2025: RetailData | null;
  /** 2025 탭 리테일매출(POS) — preprocess_retail 동일 로직, retail_dw_2025.json */
  retailDw2025: RetailData | null;
  appOtb2026: AppOtbData | null;
  accountNameMap?: AccountNameMap;
  /** DashboardClient에서 공유 state를 제어할 때 사용 (미전달 시 내부 state로 동작) */
  growthRates?: Record<BrandKey, number>;
  onGrowthRatesChange?: (rates: Record<BrandKey, number>) => void;
  targetWeeks?: Record<string, number>;
  onTargetWeeksChange?: (weeks: Record<string, number>) => void;
  sellThroughRates?: SellThroughRates;
  onSellThroughRatesChange?: (next: SellThroughRates) => void;
}

type RetailSectionHeaderMode = "inverse" | "source2026" | "source2025Dw";

const YEARS = ["2025", "2026"] as const;
type Year = (typeof YEARS)[number];

export const DEFAULT_GROWTH: Record<BrandKey, number> = {
  MLB: 100,
  "MLB KIDS": 100,
  DISCOVERY: 100,
};

// ─── 시즌 헬퍼 ────────────────────────────────
function mapNextSeason(sesn: string): string {
  if (!sesn || sesn === "과시즌") return sesn;
  const year = parseInt(sesn.slice(0, 2));
  return isNaN(year) ? sesn : `${year + 1}${sesn.slice(2)}`;
}

function sesnSortTuple(s: string): [number, number] {
  if (s === "과시즌") return [9999, 99];
  const year = parseInt(s.slice(0, 2));
  if (isNaN(year)) return [9998, 99];
  const suffix = s.slice(2);
  const suffixOrder = ({ F: 0, S: 1, N: 2 } as Record<string, number>)[suffix] ?? 3;
  return [-year, suffixOrder];
}

function cmpSesn(a: string, b: string): number {
  const [ay, as_] = sesnSortTuple(a);
  const [by, bs] = sesnSortTuple(b);
  return ay !== by ? ay - by : as_ - bs;
}

const ACC_ORDER = ["신발", "모자", "가방", "기타"];
const CAT_ORDER: Record<string, number> = { 의류: 0, ACC: 1 };

// ─── 2025 기준 리테일 계산 ────────────────────
export function calcRetail(stock: StockData, inbound: InboundData): RetailData {
  const brands: Record<string, RetailRow[]> = {};

  BRAND_ORDER.forEach((brand: BrandKey) => {
    const stockAccounts = stock.brands[brand] ?? [];
    const inboundAccounts = inbound.brands[brand] ?? [];

    const inboundByAccId: Record<string, typeof inboundAccounts[0]> = {};
    inboundAccounts.forEach((acc) => { inboundByAccId[acc.account_id] = acc; });

    const rows: RetailRow[] = stockAccounts.map((stockAcc) => {
      const inboundAcc = inboundByAccId[stockAcc.account_id];

      const retailMonths: Record<number, number> = {};
      MONTHS.forEach((m) => {
        const begin = m === 1 ? (stockAcc.base_stock ?? 0) : (stockAcc.months[m - 1] ?? 0);
        const inp = inboundAcc ? (inboundAcc.months[m] ?? 0) : 0;
        const end = stockAcc.months[m] ?? 0;
        retailMonths[m] = begin + inp - end;
      });

      let retailCategories: CategoryGroup[] | undefined;
      if (stockAcc.categories && stockAcc.categories.length > 0) {
        const inboundCatMap: Record<string, Record<string, Record<number, number>>> = {};
        if (inboundAcc?.categories) {
          inboundAcc.categories.forEach((cat) => {
            inboundCatMap[cat.대분류] = {};
            cat.subcategories.forEach((sub) => {
              inboundCatMap[cat.대분류][sub.중분류] = sub.months;
            });
          });
        }

        retailCategories = stockAcc.categories.map((stockCat) => {
          const inboundSubMap = inboundCatMap[stockCat.대분류] ?? {};
          const retailSubs: SubCategoryRow[] = stockCat.subcategories.map((stockSub) => {
            const inboundSubMonths = inboundSubMap[stockSub.중분류] ?? {};
            const retailSubMonths: Record<number, number> = {};
            MONTHS.forEach((m) => {
              const begin = m === 1 ? (stockSub.base_stock ?? 0) : (stockSub.months[m - 1] ?? 0);
              const inp = inboundSubMonths[m] ?? 0;
              const end = stockSub.months[m] ?? 0;
              retailSubMonths[m] = begin + inp - end;
            });
            return { 중분류: stockSub.중분류, base_stock: stockSub.base_stock, months: retailSubMonths };
          });

          const retailCatMonths: Record<number, number> = {};
          MONTHS.forEach((m) => {
            retailCatMonths[m] = retailSubs.reduce((s, sub) => s + (sub.months[m] ?? 0), 0);
          });

          return { 대분류: stockCat.대분류, base_stock: stockCat.base_stock, months: retailCatMonths, subcategories: retailSubs };
        });
      }

      return {
        account_id: stockAcc.account_id,
        account_nm_en: stockAcc.account_nm_en,
        sap_shop_cd: inboundAcc?.sap_shop_cd ?? "",
        base_stock: stockAcc.base_stock,
        months: retailMonths,
        categories: retailCategories,
      };
    });

    brands[brand] = rows;
  });

  return { year: stock.year, brands };
}

/** 예상 월용 전년 m월: POS(2025 탭과 동일) 우선, 없으면 역산 fallback */
function priorYearSubMonthForEstimate(
  retail2025Pos: RetailData | null,
  brand: BrandKey,
  accountId: string,
  대분류: string,
  중분류: string,
  m: number,
  calcFallback: number
): number {
  if (!retail2025Pos) return calcFallback;
  const accPos = (retail2025Pos.brands[brand] ?? []).find((a) => a.account_id === accountId);
  if (!accPos?.categories?.length) return calcFallback;
  const cat = accPos.categories.find((c) => c.대분류 === 대분류);
  const sub = cat?.subcategories.find((s) => s.중분류 === 중분류);
  if (!sub) return calcFallback;
  return sub.months[m] ?? 0;
}

function priorYearAccMonthForEstimate(
  retail2025Pos: RetailData | null,
  brand: BrandKey,
  accountId: string,
  m: number,
  calcFallback: number
): number {
  if (!retail2025Pos) return calcFallback;
  const accPos = (retail2025Pos.brands[brand] ?? []).find((a) => a.account_id === accountId);
  if (!accPos) return calcFallback;
  const top = accPos.months[m];
  if (top !== undefined && top !== null) return top;
  const cats = accPos.categories ?? [];
  if (cats.length > 0) {
    return cats.reduce((s, cat) => s + (cat.months[m] ?? 0), 0);
  }
  return calcFallback;
}

// ─── 2026 예상매출 혼합 ───────────────────────
/** `retail2025Pos`: 2025 리테일매출(POS). 있으면 미완료 월만 POS×성장률, 없으면 역산×성장률(기존). */
export function blendRetail(
  actual2026: RetailData,
  retail2025calc: RetailData,
  growthRates: Record<BrandKey, number>,
  retail2025Pos: RetailData | null = null
): { data: RetailData; estimatedMonths: number[] } {
  // 완료된 월 파악
  const completedMonths = new Set<number>();
  for (const brand of BRAND_ORDER) {
    for (const acc of actual2026.brands[brand] ?? []) {
      for (const m of Object.keys(acc.months)) completedMonths.add(Number(m));
    }
  }
  const estimatedMonths = MONTHS.filter((m) => !completedMonths.has(m));

  const brands: Record<string, RetailRow[]> = {};

  for (const brand of BRAND_ORDER as BrandKey[]) {
    const rate = (growthRates[brand] ?? 100) / 100;
    const accs25 = retail2025calc.brands[brand] ?? [];
    const accs26 = actual2026.brands[brand] ?? [];
    const acc26Map = Object.fromEntries(accs26.map((a) => [a.account_id, a]));

    const rows: RetailRow[] = accs25.map((acc25) => {
      const acc26 = acc26Map[acc25.account_id];

      // actual2026 카테고리 lookup
      const cats26ByKey: Record<string, Record<string, Record<number, number>>> = {};
      for (const cat of acc26?.categories ?? []) {
        cats26ByKey[cat.대분류] = {};
        for (const sub of cat.subcategories) {
          cats26ByKey[cat.대분류][sub.중분류] = sub.months;
        }
      }

      let newCats: CategoryGroup[] | undefined;
      if (acc25.categories && acc25.categories.length > 0) {
        newCats = [];
        for (const cat25 of acc25.categories) {
          const 대분류 = cat25.대분류;
          const subs: SubCategoryRow[] = [];

          for (const sub25 of cat25.subcategories) {
            // 의류: 시즌 연도 +1 매핑, ACC: 동일 이름
            const 중분류_26 = 대분류 === "의류" ? mapNextSeason(sub25.중분류) : sub25.중분류;

            const months: Record<number, number> = {};
            for (const m of MONTHS) {
              if (completedMonths.has(m)) {
                months[m] = cats26ByKey[대분류]?.[중분류_26]?.[m] ?? 0;
              } else {
                const base = priorYearSubMonthForEstimate(
                  retail2025Pos,
                  brand,
                  acc25.account_id,
                  대분류,
                  sub25.중분류,
                  m,
                  sub25.months[m] ?? 0
                );
                months[m] = Math.round(base * rate);
              }
            }
            subs.push({ 중분류: 중분류_26, months });
          }

          // 정렬
          if (대분류 === "의류") {
            subs.sort((a, b) => cmpSesn(a.중분류, b.중분류));
          } else {
            subs.sort((a, b) => {
              const ai = ACC_ORDER.indexOf(a.중분류);
              const bi = ACC_ORDER.indexOf(b.중분류);
              return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
            });
          }

          // 카테고리 months = 중분류 합산
          const catMonths: Record<number, number> = {};
          for (const m of MONTHS) {
            catMonths[m] = subs.reduce((s, sub) => s + (sub.months[m] ?? 0), 0);
          }
          newCats.push({ 대분류, months: catMonths, subcategories: subs });
        }
        newCats.sort((a, b) => (CAT_ORDER[a.대분류] ?? 99) - (CAT_ORDER[b.대분류] ?? 99));
      }

      // 계정 레벨 months
      const accMonths: Record<number, number> = {};
      for (const m of MONTHS) {
        if (completedMonths.has(m)) {
          accMonths[m] = acc26?.months[m] ?? 0;
        } else if (newCats) {
          accMonths[m] = newCats.reduce((s, cat) => s + (cat.months[m] ?? 0), 0);
        } else {
          const base = priorYearAccMonthForEstimate(
            retail2025Pos,
            brand,
            acc25.account_id,
            m,
            acc25.months[m] ?? 0
          );
          accMonths[m] = Math.round(base * rate);
        }
      }

      return {
        account_id: acc25.account_id,
        account_nm_en: acc25.account_nm_en,
        sap_shop_cd: acc26?.sap_shop_cd ?? acc25.sap_shop_cd ?? "",
        base_stock: acc26?.base_stock ?? acc25.base_stock,
        months: accMonths,
        categories: newCats,
      };
    });

    brands[brand] = rows;
  }

  return { data: { year: "2026", brands }, estimatedMonths };
}

// ─── 브랜드별 집계 헬퍼 ─────────────────────────────────────────
function sumBrandInbound(data: InboundData | null): Record<string, number> {
  const result: Record<string, number> = {};
  for (const brand of BRAND_ORDER) {
    result[brand] = (data?.brands[brand] ?? []).reduce(
      (s, acc) => s + MONTHS.reduce((ms, m) => ms + (acc.months[m] ?? 0), 0), 0
    );
  }
  return result;
}

function sumBrandRetail(data: RetailData | null): Record<string, number> {
  const result: Record<string, number> = {};
  for (const brand of BRAND_ORDER) {
    result[brand] = (data?.brands[brand] ?? []).reduce(
      (s, acc) => s + MONTHS.reduce((ms, m) => ms + (acc.months[m] ?? 0), 0), 0
    );
  }
  return result;
}

function brandStock12(data: StockData | null): Record<string, number> {
  const result: Record<string, number> = {};
  for (const brand of BRAND_ORDER) {
    result[brand] = (data?.brands[brand] ?? []).reduce(
      (s, acc) => s + (acc.months[12] ?? 0), 0
    );
  }
  return result;
}



// ─── 섹션 헤더 컴포넌트들 ─────────────────────
function SectionHeader({
  title, unit, basicCmd, fullCmd, hint, range,
}: {
  title: string;
  unit: string;
  basicCmd: string;
  fullCmd?: string;
  hint: string;
  range: string;
}) {
  return (
    <div className="mb-4 flex flex-col gap-1.5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="flex items-center gap-3 text-sm font-semibold tracking-[-0.02em] text-slate-700">
          <span>{title}</span>
          <span className="text-slate-400">|</span>
          <span className="rounded border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-medium text-slate-500">{unit}</span>
          <span className="text-slate-400">|</span>
          <code className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-mono text-slate-600">{basicCmd}</code>
          {fullCmd && fullCmd !== basicCmd && (
            <>
              <span className="text-slate-400">|</span>
              <code className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-mono text-slate-600">{fullCmd}</code>
            </>
          )}
        </h2>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">{range}</span>
      </div>
      <p className="text-[11px] text-slate-500">{hint}</p>
    </div>
  );
}

function RetailPlanSectionHeader() {
  return (
    <div className="mb-4 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex flex-wrap items-center gap-3 text-sm font-semibold tracking-[-0.02em] text-slate-700">
          <span>2026년 대리상 리테일 Plan</span>
          <span className="text-slate-400">|</span>
          <span className="rounded border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-medium text-slate-500">
            천위안
          </span>
          <span className="text-slate-400">|</span>
          <code className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-mono text-slate-600">
            python scripts/preprocess_retail_plan_2026.py
          </code>
          <span className="text-slate-400">|</span>
          <code className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-mono text-slate-600">
            python scripts/preprocess_retail_pos_2025.py
          </code>
        </h2>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
          2026 Plan · 25년 리테일 비교
        </span>
      </div>
      <p className="text-[11px] text-slate-500">
        입력: 2026_monthlyretail.csv (실판) · Tag표시=실판/(1-할인율) · retail_pos_2025: tag/sale (dw_sale) · 역산기준YOY=26/25역산*100% · POS기준YOY=26/25POS(Tag)*100%
      </p>
    </div>
  );
}

function RetailSectionHeader({
  title,
  unit,
  range,
  mode,
}: {
  title: string;
  unit: string;
  range: string;
  mode: RetailSectionHeaderMode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-1.5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="flex items-center gap-3 text-sm font-semibold tracking-[-0.02em] text-slate-700">
          <span>{title}</span>
          <span className="text-slate-400">|</span>
          <span className="rounded border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-medium text-slate-500">{unit}</span>
          {mode === "source2026" && (
            <>
              <span className="text-slate-400">|</span>
              <code className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-mono text-slate-600">python scripts/preprocess_retail.py</code>
              <span className="text-slate-400">|</span>
              <code className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-mono text-slate-600">python scripts/preprocess_retail.py --full</code>
            </>
          )}
          {mode === "source2025Dw" && (
            <>
              <span className="text-slate-400">|</span>
              <code className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-mono text-slate-600">python scripts/preprocess_retail_dw_2025.py</code>
              <span className="text-slate-400">|</span>
              <code className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-mono text-slate-600">preprocess_retail.py</code>
              <span className="text-slate-400">|</span>
              <span className="text-[11px] font-normal text-slate-500">동일 쿼리·카테고리</span>
            </>
          )}
        </h2>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">{range}</span>
      </div>
      <p className="text-[11px] text-slate-500">
        {mode === "inverse" &&
          "계산 로직: 월별 리테일매출 = 기초재고 + 입고물량 − 기말재고 (기초재고 = 전월 재고잔액, 기말재고 = 당월 재고잔액)"}
        {mode === "source2026" && (
          <>
            기본: 2026 추가된 완료월만 조회 · --full: 2026 전기간 재조회 (로직 변경 시)
            <span className="ml-2 text-blue-500">
              · 계획월(F): 의류 전년동시즌 × 성장률 (26S←25S, 27S←26S), ACC 전년동월 × 성장률
            </span>
          </>
        )}
        {mode === "source2025Dw" &&
          "dw_sale·tag·카테고리 집계는 2026 탭 리테일과 동일 · 본 표는 2025년 1~12월 전기간(retail_dw_2025.json)"}
      </p>
    </div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────
export default function StockView({
  data2025,
  data2026,
  inbound2025,
  inbound2026,
  retail2026,
  retailPlan2026,
  retailPos2025,
  retailDw2025,
  appOtb2026,
  accountNameMap = {},
  growthRates: growthRatesProp,
  onGrowthRatesChange,
  targetWeeks: targetWeeksProp,
  onTargetWeeksChange,
  sellThroughRates: sellThroughRatesProp,
  onSellThroughRatesChange,
}: Props) {
  const [activeYear, setActiveYear] = useState<Year>("2026");
  const [selectedBrand, setSelectedBrand] = useState<BrandKey>("MLB");
  const [internalGrowthRates, setInternalGrowthRates] = useState<Record<BrandKey, number>>(DEFAULT_GROWTH);
  const [internalTargetWeeks, setInternalTargetWeeks] = useState<Record<string, number>>(DEFAULT_TARGET_WEEKS);
  const [internalSellThroughRates, setInternalSellThroughRates] = useState<SellThroughRates>(() => ({
    ...DEFAULT_SELL_THROUGH_RATES,
    bySeason: { ...DEFAULT_SELL_THROUGH_RATES.bySeason },
    yearGroup: { ...DEFAULT_SELL_THROUGH_RATES.yearGroup },
  }));

  const growthRates = growthRatesProp ?? internalGrowthRates;
  const targetWeeks = targetWeeksProp ?? internalTargetWeeks;
  const sellThroughRates = sellThroughRatesProp ?? internalSellThroughRates;

  useEffect(() => {
    if (growthRatesProp !== undefined) return;
    fetch("/data/growth_rates_default.json")
      .then((r) => r.json())
      .then(setInternalGrowthRates)
      .catch(() => {});
  }, [growthRatesProp]);

  const currentInbound =
    activeYear === "2025"
      ? inbound2025
      : inbound2026;

  // 2025: calcRetail 계산값 (memoized — 의존성이 바뀔 때만 재계산)
  const retail2025calc = useMemo(
    () => (data2025 && inbound2025 ? calcRetail(data2025, inbound2025) : null),
    [data2025, inbound2025]
  );

  // 2026: actual + estimated 혼합
  const blended = useMemo(
    () =>
      activeYear === "2026" && retail2026 && retail2025calc
        ? blendRetail(retail2026, retail2025calc, growthRates, retailDw2025)
        : null,
    [activeYear, retail2026, retail2025calc, growthRates, retailDw2025]
  );

  const currentRetail: RetailData | null =
    activeYear === "2025"
      ? retail2025calc
      : blended?.data ?? retail2026;

  /** 2025 탭: 대리상 표 판매 = retail_dw_2025(POS), 없으면 역산(calcRetail) 폴백 */
  const retailForDealerTable = useMemo(() => {
    if (activeYear === "2025" && retailDw2025) return retailDw2025;
    return currentRetail;
  }, [activeYear, retailDw2025, currentRetail]);

  const estimatedMonths = blended?.estimatedMonths ?? [];

  const currentStock = activeYear === "2025" ? data2025 : data2026;
  const stockEstimatedMonths: number[] = [];


  return (
    <div>
      {/* 연도 + 브랜드 탭 (한 행) */}
      <div className="sticky top-[65px] z-30 mb-5 flex flex-wrap items-center gap-4 border-b border-slate-200/80 bg-white/95 px-4 py-2 backdrop-blur">
        {/* 브랜드 — 기존 카드 스타일 유지 */}
        {BRAND_ORDER.map((b) => (
          <button
            key={b}
            onClick={() => setSelectedBrand(b)}
            className={`-mb-px rounded-t-xl border border-b-0 px-5 py-2 text-sm font-semibold tracking-[0.01em] transition-all duration-200 ${
              selectedBrand === b
                ? "border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] text-[#2f5f93] shadow-[0_-1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(53,92,138,0.10)]"
                : "border-transparent bg-transparent text-slate-500 hover:border-slate-200/70 hover:bg-white/70 hover:text-slate-700"
            }`}
          >
            {b}
          </button>
        ))}
        <span className="h-5 w-px bg-slate-200" aria-hidden />
        {/* 연도 — iPhone 세그먼트 컨트롤 스타일 */}
        <div className="flex rounded-full bg-slate-200/70 p-0.5">
          {YEARS.map((year) => (
            <button
              key={year}
              onClick={() => setActiveYear(year)}
              className={`min-w-[4rem] rounded-full px-4 py-1.5 text-sm font-semibold transition-all duration-200 ${
                activeYear === year
                  ? "bg-white text-slate-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {year}년
            </button>
          ))}
        </div>
      </div>

      {/* 리테일매출 섹션 */}
      <div className="mb-10">
        {/* 재고자산표 (GrowthRateTable은 DealerDetailTable 헤더로 이동) */}
        <DealerDetailTable
          brand={selectedBrand}
          stock={currentStock}
          stockPrev={data2025}
          retail={retailForDealerTable}
          retailPrev={retail2025calc}
          inbound={currentInbound}
          inboundPrev={inbound2025}
          appOtb={appOtb2026}
          year={activeYear}
          stock2025={data2025}
          retail2025={retail2025calc}
          inbound2025={inbound2025}
          stock2026={data2026}
          retail2026={blended?.data ?? retail2026}
          retailDw2025={retailDw2025}
          inbound2026={inbound2026}
          growthRate={growthRates[selectedBrand]}
          onGrowthRateChange={(v) => {
            const next = { ...growthRates, [selectedBrand]: v };
            if (onGrowthRatesChange) onGrowthRatesChange(next);
            else setInternalGrowthRates(next);
          }}
          targetWeeks={targetWeeks}
          onTargetWeeksChange={(item, v) => {
            const next = { ...targetWeeks, [item]: v };
            if (onTargetWeeksChange) onTargetWeeksChange(next);
            else setInternalTargetWeeks(next);
          }}
          sellThroughRates={sellThroughRates}
          onSellThroughRatesChange={(next) => {
            if (onSellThroughRatesChange) onSellThroughRatesChange(next);
            else setInternalSellThroughRates(next);
          }}
          accountNameMap={accountNameMap}
        />
        <hr className="my-6 border-0 border-t-2 border-slate-200" />
        {activeYear === "2025" ? (
          <>
            <RetailSectionHeader
              title="리테일매출(역산)"
              unit="천위안"
              range="2025년 1월 ~ 12월"
              mode="inverse"
            />
            {currentRetail ? (
              <RetailTable data={currentRetail} estimatedMonths={[]} brand={selectedBrand} />
            ) : (
              <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-slate-300 text-sm text-slate-400">
                2025년 리테일매출(역산) 계산 불가 — 재고잔액 및 입고물량 데이터가 모두 필요합니다
              </div>
            )}
            <hr className="my-6 border-0 border-t-2 border-slate-200" />
            <RetailSectionHeader
              title="리테일매출(POS)"
              unit="천위안"
              range="2025년 1월 ~ 12월"
              mode="source2025Dw"
            />
            {retailDw2025 ? (
              <RetailTable data={retailDw2025} estimatedMonths={[]} brand={selectedBrand} />
            ) : (
              <div className="flex h-36 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 text-center text-sm text-slate-400">
                <span>2025년 리테일매출(POS) 데이터 없음</span>
                <code className="rounded bg-slate-100 px-2 py-1 text-xs">python scripts/preprocess_retail_dw_2025.py</code>
                <span className="text-xs">실행 후 새로고침 · 결과: public/data/retail_dw_2025.json</span>
              </div>
            )}
          </>
        ) : (
          <>
            <RetailSectionHeader
              title="리테일매출"
              unit="천위안"
              range={`${activeYear}년 1월 ~ 12월`}
              mode="source2026"
            />
            {currentRetail ? (
              <RetailTable data={currentRetail} estimatedMonths={estimatedMonths} brand={selectedBrand} />
            ) : (
              <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-slate-300 text-sm text-slate-400">
                {activeYear}년 리테일매출 계산 불가 — 재고잔액 및 입고물량 데이터가 모두 필요합니다
              </div>
            )}
          </>
        )}
      </div>

      {/* 재고잔액 섹션 */}
      <div className="mb-10">
        <SectionHeader
          title="월별재고잔액"
          unit="천위안"
          basicCmd="python scripts/preprocess_stock.py"
          fullCmd="python scripts/preprocess_stock.py --full"
          hint="기본: 2025 스킵, 2026 추가된 완료월만 조회 · --full: 2025~2026 전기간 재조회 (로직 변경 시)"
          range={`${activeYear}년 1월 ~ 12월`}
        />
        {currentStock ? (
          <StockTable data={currentStock} estimatedMonths={stockEstimatedMonths} brand={selectedBrand} />
        ) : (
          <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-slate-300 text-sm text-slate-400">
            {activeYear}년 재고잔액 데이터 없음 —&nbsp;
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">python scripts/preprocess_stock.py</code>
            &nbsp;실행 후 새로고침
          </div>
        )}
      </div>

      {/* 입고물량 섹션 */}
      <div className="mb-10">
        <SectionHeader
          title="입고물량 (본사 → 대리상 출고)"
          unit="천위안"
          basicCmd="python scripts/preprocess_inbound.py"
          fullCmd="python scripts/preprocess_inbound.py --full"
          hint="기본: 2025 스킵, 2026 추가된 완료월만 조회 · --full: 2025~2026 전기간 재조회 (로직 변경 시)"
          range={`${activeYear}년 1월 ~ 12월`}
        />
        {currentInbound ? (
          <InboundTable
            data={currentInbound}
            brand={selectedBrand}
          />
        ) : (
          <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-slate-300 text-sm text-slate-400">
            {activeYear}년 입고물량 데이터 없음 —&nbsp;
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">python scripts/preprocess_inbound.py</code>
            &nbsp;실행 후 새로고침
          </div>
        )}
      </div>

      {/* 의류 OTB 섹션 (2026년 탭만) */}
      {activeYear === "2026" && (
        <div className="mb-10">
          <SectionHeader
            title="의류 OTB"
            unit="천위안"
            basicCmd="python scripts/preprocess_app_otb.py"
            hint="OTB: OTB_K.csv · 누적입고: Snowflake 2025-10 ~ 기준월 (의류, 26S/26F/27S/27F)"
            range="2026년"
          />
          {appOtb2026 ? (
            <AppOtbTable appOtb={appOtb2026} brand={selectedBrand} />
          ) : (
            <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-slate-300 text-sm text-slate-400">
              OTB 데이터 없음 —&nbsp;
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">python scripts/preprocess_app_otb.py</code>
              &nbsp;실행 후 새로고침
            </div>
          )}
        </div>
      )}

      {activeYear === "2026" && (
        <div className="mb-10">
          <RetailPlanSectionHeader />
          {retailPlan2026 ? (
            <RetailPlan2026Table
              plan={retailPlan2026}
              retailPos2025={retailPos2025}
              brand={selectedBrand}
              accountNameMap={accountNameMap}
            />
          ) : (
            <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-slate-300 text-sm text-slate-400">
              Plan 데이터 없음 —&nbsp;
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                python scripts/preprocess_retail_plan_2026.py
              </code>
              &nbsp;실행 후 새로고침
            </div>
          )}
        </div>
      )}
    </div>
  );
}
