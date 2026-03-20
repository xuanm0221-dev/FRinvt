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
import { fmtAmt } from "../../lib/utils";
import { DEFAULT_TARGET_WEEKS } from "../../lib/dealerMetrics";

export type AccountNameMap = Record<string, { account_nm_en: string; account_nm_kr: string }>;

interface Props {
  data2025: StockData | null;
  data2026: StockData | null;
  inbound2025: InboundData | null;
  inbound2026: InboundData | null;
  retail2026: RetailData | null;
  appOtb2026: AppOtbData | null;
  accountNameMap?: AccountNameMap;
}

const YEARS = ["2025", "2026"] as const;
type Year = (typeof YEARS)[number];

const DEFAULT_GROWTH: Record<BrandKey, number> = {
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
function calcRetail(stock: StockData, inbound: InboundData): RetailData {
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

// ─── 2026 예상매출 혼합 ───────────────────────
function blendRetail(
  actual2026: RetailData,
  retail2025calc: RetailData,
  growthRates: Record<BrandKey, number>
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
                months[m] = Math.round((sub25.months[m] ?? 0) * rate);
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
          accMonths[m] = Math.round((acc25.months[m] ?? 0) * rate);
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


// ─── 2026년 재고잔액 계획월 계산 ────────────────
// 실적월은 data2026 그대로, 계획월은 전월재고 + 입고물량 − 리테일매출
// 대분류/중분류 레벨까지 재귀 계산, 26F/27S 행 자동 주입
function blendStock2026(
  data2026: StockData | null,
  blendedInbound: InboundData | null,
  blendedRetail: RetailData | null
): { data: StockData; estimatedMonths: number[] } | null {
  if (!data2026) return null;

  // 실적 완료 월: data2026에 데이터가 있는 월
  const completedMonths = new Set<number>();
  for (const brand of BRAND_ORDER) {
    for (const acc of data2026.brands[brand] ?? []) {
      for (const m of MONTHS) {
        if (m in acc.months) completedMonths.add(m);
      }
    }
  }
  const estimatedMonths = MONTHS.filter((m) => !completedMonths.has(m));
  if (estimatedMonths.length === 0) return { data: data2026, estimatedMonths: [] };

  const brands: Record<string, AccountRow[]> = {};

  for (const brand of BRAND_ORDER as BrandKey[]) {
    const accs26 = data2026.brands[brand] ?? [];
    const inboundAccs = blendedInbound?.brands[brand] ?? [];
    const retailAccs = blendedRetail?.brands[brand] ?? [];

    const inboundByAcc = new Map(inboundAccs.map((a) => [a.account_id, a]));
    const retailByAcc = new Map(retailAccs.map((a) => [a.account_id, a]));

    const rows: AccountRow[] = accs26.map((acc26) => {
      const inboundAcc = inboundByAcc.get(acc26.account_id);
      const retailAcc = retailByAcc.get(acc26.account_id);

      // ── 대분류/중분류 레벨 계산 ──
      const blendedCategories: CategoryGroup[] | undefined = acc26.categories
        ? (() => {
            const catMap26 = new Map(acc26.categories!.map((c) => [c.대분류, c]));
            const catMapInb = new Map(inboundAcc?.categories?.map((c) => [c.대분류, c]) ?? []);
            const catMapRet = new Map(retailAcc?.categories?.map((c) => [c.대분류, c]) ?? []);

            // 대분류 합집합 (의류/ACC + inbound/retail에만 있는 대분류)
            const allCatKeys = new Set([
              ...Array.from(catMap26.keys()),
              ...Array.from(catMapInb.keys()),
              ...Array.from(catMapRet.keys()),
            ]);

            return Array.from(allCatKeys).map((대분류) => {
              const cat26 = catMap26.get(대분류);
              const catInb = catMapInb.get(대분류);
              const catRet = catMapRet.get(대분류);

              // 중분류 합집합 — data2026 순서 우선, 없는 것(26F/27S 등)은 뒤에 추가 후 정렬
              const subKeysOrdered: string[] = cat26?.subcategories.map((s) => s.중분류) ?? [];
              const subKeySet = new Set(subKeysOrdered);
              for (const s of catInb?.subcategories ?? []) {
                if (!subKeySet.has(s.중분류)) { subKeysOrdered.push(s.중분류); subKeySet.add(s.중분류); }
              }
              for (const s of catRet?.subcategories ?? []) {
                if (!subKeySet.has(s.중분류)) { subKeysOrdered.push(s.중분류); subKeySet.add(s.중분류); }
              }
              // 시즌 기준 정렬 (의류: 26F>26S>25S>과시즌, ACC: NaN이므로 원래 순서 유지)
              subKeysOrdered.sort(cmpSesn);

              const subMap26 = new Map(cat26?.subcategories.map((s) => [s.중분류, s]) ?? []);
              const subMapInb = new Map(catInb?.subcategories.map((s) => [s.중분류, s]) ?? []);
              const subMapRet = new Map(catRet?.subcategories.map((s) => [s.중분류, s]) ?? []);

              const subcategories: SubCategoryRow[] = subKeysOrdered.map((중분류) => {
                const sub26 = subMap26.get(중분류);
                const subInb = subMapInb.get(중분류);
                const subRet = subMapRet.get(중분류);
                const base_stock = sub26?.base_stock ?? 0;
                const subMonths: Record<number, number> = {};

                for (const m of MONTHS) {
                  if (completedMonths.has(m)) {
                    // 실적월: data2026 값 (없는 중분류는 0)
                    subMonths[m] = sub26?.months[m] ?? 0;
                  } else {
                    // 계획월: 전월잔액 + 입고 − 리테일
                    const prevStock = m === 1 ? base_stock : (subMonths[m - 1] ?? 0);
                    const inbound = subInb?.months[m] ?? 0;
                    const retail = subRet?.months[m] ?? 0;
                    subMonths[m] = Math.max(0, prevStock + inbound - retail);
                  }
                }

                return { 중분류, base_stock, months: subMonths };
              });

              // 대분류 합계 = 중분류 합산
              const catBase = subcategories.reduce((s, sub) => s + (sub.base_stock ?? 0), 0);
              const catMonths: Record<number, number> = {};
              for (const m of MONTHS) {
                catMonths[m] = subcategories.reduce((s, sub) => s + (sub.months[m] ?? 0), 0);
              }

              return { 대분류, base_stock: catBase, months: catMonths, subcategories };
            });
          })()
        : undefined;

      // ── 대리상 레벨 계산 ──
      const months: Record<number, number> = {};
      for (const m of MONTHS) {
        if (completedMonths.has(m)) {
          months[m] = acc26.months[m] ?? 0;
        } else {
          const prevStock = m === 1 ? (acc26.base_stock ?? 0) : (months[m - 1] ?? 0);
          const inbound = inboundAcc?.months[m] ?? 0;
          const retail = retailAcc?.months[m] ?? 0;
          months[m] = Math.max(0, prevStock + inbound - retail);
        }
      }

      return {
        account_id: acc26.account_id,
        account_nm_en: acc26.account_nm_en,
        base_stock: acc26.base_stock,
        months,
        categories: blendedCategories,
      };
    });

    brands[brand] = rows;
  }

  return { data: { year: "2026", brands }, estimatedMonths };
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

function RetailSectionHeader({ title, unit, range, activeYear }: { title: string; unit: string; range: string; activeYear: string }) {
  const is2026 = activeYear === "2026";
  return (
    <div className="mb-4 flex flex-col gap-1.5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="flex items-center gap-3 text-sm font-semibold tracking-[-0.02em] text-slate-700">
          <span>{title}</span>
          <span className="text-slate-400">|</span>
          <span className="rounded border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-medium text-slate-500">{unit}</span>
          {is2026 && (
            <>
              <span className="text-slate-400">|</span>
              <code className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-mono text-slate-600">python scripts/preprocess_retail.py</code>
              <span className="text-slate-400">|</span>
              <code className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-mono text-slate-600">python scripts/preprocess_retail.py --full</code>
            </>
          )}
        </h2>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">{range}</span>
      </div>
      <p className="text-[11px] text-slate-500">
        {is2026 ? (
          <>
            기본: 2026 추가된 완료월만 조회 · --full: 2026 전기간 재조회 (로직 변경 시)
            <span className="ml-2 text-blue-500">
              · 계획월(F): 의류 전년동시즌 × 성장률 (26S←25S, 27S←26S), ACC 전년동월 × 성장률
            </span>
          </>
        ) : "계산 로직: 월별 리테일매출 = 기초재고 + 입고물량 − 기말재고 (기초재고 = 전월 재고잔액, 기말재고 = 당월 재고잔액)"}
      </p>
    </div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────
export default function StockView({
  data2025, data2026, inbound2025, inbound2026, retail2026, appOtb2026, accountNameMap = {},
}: Props) {
  const [activeYear, setActiveYear] = useState<Year>("2026");
  const [selectedBrand, setSelectedBrand] = useState<BrandKey>("MLB");
  const [growthRates, setGrowthRates] = useState<Record<BrandKey, number>>(DEFAULT_GROWTH);
  const [targetWeeks, setTargetWeeks] = useState<Record<string, number>>(DEFAULT_TARGET_WEEKS);
  const [sellThrough, setSellThrough] = useState(70);

  useEffect(() => {
    fetch("/data/growth_rates_default.json")
      .then((r) => r.json())
      .then(setGrowthRates)
      .catch(() => {});
  }, []);

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
        ? blendRetail(retail2026, retail2025calc, growthRates)
        : null,
    [activeYear, retail2026, retail2025calc, growthRates]
  );

  const currentRetail: RetailData | null =
    activeYear === "2025"
      ? retail2025calc
      : blended?.data ?? retail2026;

  const estimatedMonths = blended?.estimatedMonths ?? [];

  // 2026년 재고잔액 계획월 계산 (memoized)
  const blendedStock = useMemo(
    () =>
      activeYear === "2026"
        ? blendStock2026(data2026, currentInbound, currentRetail)
        : null,
    [activeYear, data2026, currentInbound, currentRetail]
  );
  const currentStock = activeYear === "2025" ? data2025 : (blendedStock?.data ?? data2026);
  const stockEstimatedMonths = blendedStock?.estimatedMonths ?? [];


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
          retail={currentRetail}
          retailPrev={retail2025calc}
          inbound={currentInbound}
          inboundPrev={inbound2025}
          appOtb={appOtb2026}
          year={activeYear}
          stock2025={data2025}
          retail2025={retail2025calc}
          inbound2025={inbound2025}
          stock2026={blendedStock?.data ?? data2026}
          retail2026={blended?.data ?? retail2026}
          inbound2026={inbound2026}
          growthRate={growthRates[selectedBrand]}
          onGrowthRateChange={(v) => setGrowthRates((prev) => ({ ...prev, [selectedBrand]: v }))}
          targetWeeks={targetWeeks}
          onTargetWeeksChange={(item, v) => setTargetWeeks((prev) => ({ ...prev, [item]: v }))}
          sellThrough={sellThrough}
          onSellThroughChange={setSellThrough}
          accountNameMap={accountNameMap}
        />
        <hr className="my-6 border-0 border-t-2 border-slate-200" />
        <RetailSectionHeader
          title="리테일매출"
          unit="천위안"
          range={`${activeYear}년 1월 ~ 12월`}
          activeYear={activeYear}
        />
        {currentRetail ? (
          <RetailTable data={currentRetail} estimatedMonths={estimatedMonths} brand={selectedBrand} />
        ) : (
          <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-slate-300 text-sm text-slate-400">
            {activeYear}년 리테일매출 계산 불가 — 재고잔액 및 입고물량 데이터가 모두 필요합니다
          </div>
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
    </div>
  );
}
