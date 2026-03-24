"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { BRAND_ORDER, MONTHS, StoreRetailMap, StoreDirectCostMap } from "../../lib/types";
import type { AccountNameMap } from "./StockView";

interface Props {
  cogsRateMap: Record<string, Record<string, number>>;
  accountNameMap: AccountNameMap;
  storeRetailMap?: StoreRetailMap;
  storeDirectCostMap?: StoreDirectCostMap;
}

type MonthOption = "annual" | number;

const DROPDOWN_OPTIONS: { value: MonthOption; label: string }[] = [
  { value: "annual", label: "26년 합계" },
  ...MONTHS.map((m) => ({ value: m, label: `26.${String(m).padStart(2, "0")}` })),
];

function fmt(n: number): string {
  if (!isFinite(n)) return "";
  return Math.round(n / 1000).toLocaleString();
}

function fmtRate(n: number): string {
  if (!isFinite(n)) return "";
  return (n * 100).toFixed(1) + "%";
}

/** Tag = 리테일 / (1 - 전년할인율) */
function calcTag(retail: number, discountRate: number): number {
  const denom = 1 - discountRate;
  if (denom <= 0) return retail;
  return retail / denom;
}

interface DealerPL {
  accountId: string;
  accountNameKr: string;
  accountNameEn: string;
  retail: number;
  tag: number;
  cogsRate: number;
  cogs: number;
  grossProfit: number;
  // 직접비
  salary: number;
  bonus: number;
  headcount: number;
  insurance: number;
  rent: number;
  depr: number;
  directCost: number;
  operatingProfit: number;
}

interface StorePL {
  storeCode: string;
  storeName: string;
  retail: number;
  tag: number;
  cogsRate: number;
  discountRate: number;
  cogs: number;
  grossProfit: number;
  // 직접비
  salary: number;
  bonus: number;
  headcount: number;
  insurance: number;
  rent: number;
  depr: number;
  directCost: number;
  operatingProfit: number;
}

/** 2026년 기준 yyyyMM 정수 생성: 월 1~12 → 202601~202612 */
function ym(month: number): number { return 202600 + month; }

/**
 * 감가상각비 계산 (월별)
 * - openMonth ≤ currentMonth ≤ amortEndMonth 일 때만
 * - 월 감가상각비 = 인테리어 / 감가기간(개월수)
 * - 감가기간 = amortEndMonth - openMonth (개월 수 차이 + 1)
 */
function calcDeprForMonth(
  interiorCost: number,
  openMonth: number,
  amortEndMonth: number,
  closedMonth: number | null,
  currentMonth: number, // yyyyMM
): number {
  if (openMonth <= 0 || amortEndMonth <= 0) return 0;
  if (currentMonth < openMonth || currentMonth > amortEndMonth) return 0;
  if (closedMonth !== null && currentMonth > closedMonth) return 0;
  // 감가기간 계산 (개월수)
  const startYear = Math.floor(openMonth / 100);
  const startMon  = openMonth % 100;
  const endYear   = Math.floor(amortEndMonth / 100);
  const endMon    = amortEndMonth % 100;
  const months    = (endYear - startYear) * 12 + (endMon - startMon) + 1;
  if (months <= 0) return 0;
  return interiorCost / months;
}

// ─── 직접비 데이터 셀 ─────────────────────────────────────────────
interface DirectCostCellsProps {
  salary: number;
  bonus: number;
  headcount: number;
  insurance: number;
  rent: number;
  depr: number;
  directCost: number;
}
function DirectCostCells({ salary, bonus, headcount, insurance, rent, depr, directCost }: DirectCostCellsProps) {
  const cls = (v: number) => v === 0 ? "text-slate-300" : "text-slate-700";
  const f = (v: number) => v === 0 ? "—" : fmt(v);
  // 평균인건비: (급여+성과급)/인원수 — 직접비합계 미포함 참조용
  const avgLaborCost = headcount > 0 ? (salary + bonus) / headcount : 0;
  const REF_TD = "bg-slate-100"; // 참조용 컬럼 배경
  return (
    <>
      <td className={`px-3 py-2 border-l border-slate-200 ${cls(directCost)}`}>{f(directCost)}</td>
      <td className={`px-3 py-2 ${cls(salary)}`}>{f(salary)}</td>
      <td className={`px-3 py-2 ${cls(bonus)}`}>{f(bonus)}</td>
      {/* 참조용: 직접비합계 미포함 → 회색 배경 */}
      <td className={`px-3 py-2 border-l border-slate-300 ${REF_TD} ${headcount === 0 ? "text-slate-400" : "text-slate-600"}`}>
        {headcount === 0 ? "—" : `${headcount}명`}
      </td>
      <td className={`px-3 py-2 ${REF_TD} ${avgLaborCost === 0 ? "text-slate-400" : "text-slate-700"}`}>
        {avgLaborCost === 0 ? "—" : (avgLaborCost / 1000).toFixed(2)}
      </td>
      <td className={`px-3 py-2 border-l border-slate-300 ${cls(insurance)}`}>{f(insurance)}</td>
      <td className={`px-3 py-2 ${cls(rent)}`}>{f(rent)}</td>
      <td className={`px-3 py-2 ${cls(depr)}`}>{f(depr)}</td>
      <td className="px-3 py-2 text-slate-300">—</td>
      <td className="px-3 py-2 text-slate-200">—</td>
      <td className="px-3 py-2 text-slate-200">—</td>
      <td className="px-3 py-2 text-slate-200">—</td>
      <td className="px-3 py-2 text-slate-200">—</td>
    </>
  );
}

// ─── 공통 테이블 헤더 ─────────────────────────────────────────────
// 컬럼 수: 1(이름)+2(매출)+2(원가)+1(매출이익)+13(직접비)+1(영업이익) = 20
// [인원수][평균인건비]는 직접비합계에 미포함 → 회색 배경으로 구분
const REF_COL = "bg-slate-100 text-slate-500"; // 참조용 컬럼 스타일

function PLTableHead({ firstColLabel }: { firstColLabel: string }) {
  return (
    <thead>
      <tr className="bg-slate-100 border-b border-slate-200">
        <th className="sticky left-0 z-10 bg-slate-100 px-3 py-1.5" />
        <th colSpan={2} className="px-3 py-1.5 text-center text-[10px] font-semibold text-slate-500 border-l border-slate-200">
          매출
        </th>
        <th colSpan={2} className="px-3 py-1.5 text-center text-[10px] font-semibold text-slate-500 border-l border-slate-200">
          원가
        </th>
        <th className="px-3 py-1.5 text-center text-[10px] font-semibold text-slate-500 border-l border-slate-200">
          매출이익
        </th>
        <th colSpan={13} className="px-3 py-1.5 text-center text-[10px] font-semibold text-slate-400 border-l border-slate-200">
          직접비
        </th>
        <th className="px-3 py-1.5 text-center text-[10px] font-semibold text-blue-700 border-l border-slate-300">
          영업이익
        </th>
      </tr>
      <tr className="bg-slate-50 border-b border-slate-200">
        <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2.5 text-left text-xs font-semibold text-slate-600 min-w-[200px]">
          {firstColLabel}
        </th>
        <th className="px-3 py-2.5 text-xs font-semibold text-slate-600 whitespace-nowrap border-l border-slate-200">Tag</th>
        <th className="px-3 py-2.5 text-xs font-semibold text-slate-600 whitespace-nowrap">리테일(V+)</th>
        <th className="px-3 py-2.5 text-xs font-semibold text-slate-600 whitespace-nowrap border-l border-slate-200">25년 출고율</th>
        <th className="px-3 py-2.5 text-xs font-semibold text-slate-600 whitespace-nowrap">매출원가</th>
        <th className="px-3 py-2.5 text-xs font-semibold text-slate-600 whitespace-nowrap border-l border-slate-200">매출이익</th>
        <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 whitespace-nowrap border-l border-slate-200">직접비합계</th>
        <th className="px-3 py-2.5 text-xs font-medium text-slate-400 whitespace-nowrap">ㄴ급여</th>
        <th className="px-3 py-2.5 text-xs font-medium text-slate-400 whitespace-nowrap">ㄴ성과급</th>
        {/* 참조용 컬럼: 직접비합계 미포함 → 회색 배경 */}
        <th className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap border-l border-slate-300 ${REF_COL}`}>인원수</th>
        <th className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap ${REF_COL}`}>평균인건비</th>
        <th className="px-3 py-2.5 text-xs font-medium text-slate-400 whitespace-nowrap border-l border-slate-300">ㄴ보험/공적금</th>
        <th className="px-3 py-2.5 text-xs font-medium text-slate-400 whitespace-nowrap">ㄴ임차료</th>
        <th className="px-3 py-2.5 text-xs font-medium text-slate-400 whitespace-nowrap">ㄴ감가상각비</th>
        <th className="px-3 py-2.5 text-xs font-medium text-slate-400 whitespace-nowrap">ㄴ기타합계</th>
        <th className="px-3 py-2.5 text-xs font-medium text-slate-300 whitespace-nowrap">ㄴ마케팅</th>
        <th className="px-3 py-2.5 text-xs font-medium text-slate-300 whitespace-nowrap">ㄴ포장</th>
        <th className="px-3 py-2.5 text-xs font-medium text-slate-300 whitespace-nowrap">ㄴ지급수수료</th>
        <th className="px-3 py-2.5 text-xs font-medium text-slate-300 whitespace-nowrap">ㄴothers</th>
        <th className="px-3 py-2.5 text-xs font-bold text-blue-700 whitespace-nowrap border-l border-slate-300">영업이익</th>
      </tr>
    </thead>
  );
}

// ─── 합계 행 ─────────────────────────────────────────────────────
interface TotalRowProps {
  totals: {
    tag: number; retail: number; cogs: number; grossProfit: number;
    salary: number; bonus: number; headcount: number; insurance: number;
    rent: number; depr: number; directCost: number; operatingProfit: number;
  };
}
function TotalRow({ totals }: TotalRowProps) {
  const f = (v: number) => v === 0 ? "—" : fmt(v);
  const c = (v: number) => v === 0 ? "text-slate-300" : "text-slate-800";
  // 평균인건비: (급여+성과급)/인원수 — 합계 기준 (매장 평균의 합이 아님)
  const avgLaborCost = totals.headcount > 0 ? (totals.salary + totals.bonus) / totals.headcount : 0;
  return (
    <tr className="border-t-2 border-slate-300 bg-slate-100 font-semibold text-xs">
      <td className="sticky left-0 z-10 bg-slate-100 px-3 py-2.5 text-left text-slate-800">합 계</td>
      <td className="px-3 py-2.5 text-slate-800 border-l border-slate-200">{fmt(totals.tag)}</td>
      <td className="px-3 py-2.5 text-slate-800">{fmt(totals.retail)}</td>
      <td className="px-3 py-2.5 text-slate-400 border-l border-slate-200">—</td>
      <td className="px-3 py-2.5 text-slate-800">{fmt(totals.cogs)}</td>
      <td className="px-3 py-2.5 text-slate-800 border-l border-slate-200">{fmt(totals.grossProfit)}</td>
      <td className={`px-3 py-2.5 border-l border-slate-200 ${c(totals.directCost)}`}>{f(totals.directCost)}</td>
      <td className={`px-3 py-2.5 ${c(totals.salary)}`}>{f(totals.salary)}</td>
      <td className={`px-3 py-2.5 ${c(totals.bonus)}`}>{f(totals.bonus)}</td>
      {/* 참조용 컬럼: 직접비합계 미포함 → 진한 회색 배경 (합계 행은 이미 bg-slate-100이므로 bg-slate-200 사용) */}
      <td className={`px-3 py-2.5 bg-slate-200 border-l border-slate-300 ${totals.headcount === 0 ? "text-slate-400" : "text-slate-700"}`}>
        {totals.headcount === 0 ? "—" : `${totals.headcount}명`}
      </td>
      <td className={`px-3 py-2.5 bg-slate-200 ${avgLaborCost === 0 ? "text-slate-400" : "text-slate-700"}`}>
        {avgLaborCost === 0 ? "—" : (avgLaborCost / 1000).toFixed(2)}
      </td>
      <td className={`px-3 py-2.5 border-l border-slate-300 ${c(totals.insurance)}`}>{f(totals.insurance)}</td>
      <td className={`px-3 py-2.5 ${c(totals.rent)}`}>{f(totals.rent)}</td>
      <td className={`px-3 py-2.5 ${c(totals.depr)}`}>{f(totals.depr)}</td>
      <td className="px-3 py-2.5 text-slate-300">—</td>
      <td className="px-3 py-2.5 text-slate-300">—</td>
      <td className="px-3 py-2.5 text-slate-300">—</td>
      <td className="px-3 py-2.5 text-slate-300">—</td>
      <td className="px-3 py-2.5 text-slate-300">—</td>
      <td className={`px-3 py-2.5 font-bold border-l border-slate-300 ${totals.operatingProfit >= 0 ? "text-blue-800" : "text-red-700"}`}>
        {fmt(totals.operatingProfit)}
      </td>
    </tr>
  );
}

// ─── 매장별 팝업 모달 ─────────────────────────────────────────────
interface StoreModalProps {
  dealer: DealerPL;
  brand: string;
  selectedMonth: MonthOption;
  storeRetailMap: StoreRetailMap;
  storeDirectCostMap: StoreDirectCostMap;
  cogsRate: number;
  onClose: () => void;
}

function StoreModal({ dealer, brand, selectedMonth, storeRetailMap, storeDirectCostMap, cogsRate, onClose }: StoreModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const stores = storeRetailMap[brand]?.[dealer.accountId] ?? [];

  const storeRows = useMemo((): StorePL[] => {
    return stores
      .filter((s) => MONTHS.reduce((sum, m) => sum + (s.months[m] ?? 0), 0) > 0)
      .map((s) => {
        const dc = storeDirectCostMap[s.storeCode];

        const retail =
          selectedMonth === "annual"
            ? MONTHS.reduce((sum, m) => sum + (s.months[m] ?? 0), 0)
            : (s.months[selectedMonth as number] ?? 0);
        const tag = calcTag(retail, s.discountRate);
        const cogs = (tag * cogsRate) / 1.13;
        const grossProfit = retail / 1.13 - cogs;

        // ── 직접비 계산 ──────────────────────────────────────────
        let salary = 0, bonus = 0, headcount = 0, insurance = 0, rent = 0, depr = 0;
        if (dc) {
          headcount = dc.headcount;
          if (selectedMonth === "annual") {
            // 연간 합계: 각 달 합산
            for (const m of MONTHS) {
              const curYM = ym(m);
              const retailM = s.months[m] ?? 0;
              const salM   = dc.avgSalary * dc.headcount;
              const bonusM = retailM * dc.bonusRate;
              const insM   = (salM + bonusM) * dc.insuranceRate;
              const deprM  = calcDeprForMonth(dc.interiorCost, dc.openMonth, dc.amortEndMonth, dc.closedMonth, curYM);
              salary   += salM;
              bonus    += bonusM;
              insurance += insM;
              rent     += dc.rent;
              depr     += deprM;
            }
          } else {
            const m = selectedMonth as number;
            const curYM  = ym(m);
            const retailM = s.months[m] ?? 0;
            salary    = dc.avgSalary * dc.headcount;
            bonus     = retailM * dc.bonusRate;
            insurance = (salary + bonus) * dc.insuranceRate;
            rent      = dc.rent;
            depr      = calcDeprForMonth(dc.interiorCost, dc.openMonth, dc.amortEndMonth, dc.closedMonth, curYM);
          }
        }
        const directCost = salary + bonus + insurance + rent + depr;
        const operatingProfit = grossProfit - directCost;

        return {
          storeCode: s.storeCode,
          storeName: s.storeName,
          retail,
          tag,
          cogsRate,
          discountRate: s.discountRate,
          cogs,
          grossProfit,
          salary,
          bonus,
          headcount,
          insurance,
          rent,
          depr,
          directCost,
          operatingProfit,
        };
      });
  }, [stores, selectedMonth, cogsRate, storeDirectCostMap]);

  const storeTotals = useMemo(() => ({
    retail:          storeRows.reduce((s, r) => s + r.retail, 0),
    tag:             storeRows.reduce((s, r) => s + r.tag, 0),
    cogs:            storeRows.reduce((s, r) => s + r.cogs, 0),
    grossProfit:     storeRows.reduce((s, r) => s + r.grossProfit, 0),
    salary:          storeRows.reduce((s, r) => s + r.salary, 0),
    bonus:           storeRows.reduce((s, r) => s + r.bonus, 0),
    headcount:       storeRows.reduce((s, r) => s + r.headcount, 0),
    insurance:       storeRows.reduce((s, r) => s + r.insurance, 0),
    rent:            storeRows.reduce((s, r) => s + r.rent, 0),
    depr:            storeRows.reduce((s, r) => s + r.depr, 0),
    directCost:      storeRows.reduce((s, r) => s + r.directCost, 0),
    operatingProfit: storeRows.reduce((s, r) => s + r.operatingProfit, 0),
  }), [storeRows]);

  const monthLabel = selectedMonth === "annual" ? "26년 합계" : `26.${String(selectedMonth).padStart(2, "0")}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-[95vw] max-w-[1820px] max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 모달 헤더 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-slate-400">({dealer.accountId})</span>
            {dealer.accountNameKr && (
              <span className="text-sm font-bold text-slate-800">{dealer.accountNameKr}</span>
            )}
            {dealer.accountNameKr && dealer.accountNameEn && (
              <span className="text-slate-300 text-sm">|</span>
            )}
            {dealer.accountNameEn && (
              <span className="text-sm font-semibold text-slate-500">{dealer.accountNameEn}</span>
            )}
            <span className="ml-2 rounded-md bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
              {brand} · {monthLabel}
            </span>
            <span className="text-[11px] text-slate-400">매장 {storeRows.length}개</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 모달 테이블 */}
        <div className="overflow-auto flex-1">
          <table className="min-w-full text-right text-xs">
            <PLTableHead firstColLabel="매장코드 · 매장명" />
            <tbody className="divide-y divide-slate-100">
              {storeRows.map((row, i) => (
                <tr key={row.storeCode} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                  <td className="sticky left-0 z-10 bg-inherit px-3 py-2 text-left whitespace-nowrap">
                    <span className="text-[10px] text-slate-400 mr-1.5">({row.storeCode})</span>
                    <span className="text-slate-700 font-medium">{row.storeName}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-700 border-l border-slate-100">{fmt(row.tag)}</td>
                  <td className="px-3 py-2 text-slate-700">{fmt(row.retail)}</td>
                  <td className="px-3 py-2 text-slate-500 border-l border-slate-100">{fmtRate(row.cogsRate)}</td>
                  <td className="px-3 py-2 text-slate-700">{fmt(row.cogs)}</td>
                  <td className="px-3 py-2 text-slate-700 border-l border-slate-100">{fmt(row.grossProfit)}</td>
                  <DirectCostCells
                    salary={row.salary}
                    bonus={row.bonus}
                    headcount={row.headcount}
                    insurance={row.insurance}
                    rent={row.rent}
                    depr={row.depr}
                    directCost={row.directCost}
                  />
                  <td className={`px-3 py-2 font-semibold border-l border-slate-300 ${row.operatingProfit >= 0 ? "text-blue-700" : "text-red-600"}`}>
                    {fmt(row.operatingProfit)}
                  </td>
                </tr>
              ))}
              {storeRows.length > 0 && <TotalRow totals={storeTotals} />}
              {storeRows.length === 0 && (
                <tr>
                  <td colSpan={19} className="py-10 text-center text-slate-400 text-sm">
                    매장 데이터가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-2 border-t border-slate-100 bg-slate-50 shrink-0 text-right text-[11px] text-slate-400">
          단위: 천위안(千元) · 기타(마케팅/포장/지급수수료/others) 항목은 추후 추가
        </div>
      </div>
    </div>
  );
}

// ─── 메인 PLView ──────────────────────────────────────────────────
export default function PLView({
  cogsRateMap,
  accountNameMap,
  storeRetailMap = {},
  storeDirectCostMap = {},
}: Props) {
  const [selectedMonth, setSelectedMonth] = useState<MonthOption>("annual");
  const [selectedBrand, setSelectedBrand] = useState<string>("");
  const [modalDealer, setModalDealer] = useState<DealerPL | null>(null);

  const closeModal = useCallback(() => setModalDealer(null), []);

  // 브랜드 목록: storeRetailMap에서 추출
  const brands = useMemo(() => {
    return BRAND_ORDER.filter((b) => Object.keys(storeRetailMap[b] ?? {}).length > 0);
  }, [storeRetailMap]);

  const activeBrand = selectedBrand || brands[0] || "";

  // 대리상 행: 매장 합산
  const rows = useMemo((): DealerPL[] => {
    const brandStores  = storeRetailMap[activeBrand] ?? {};
    const brandCogsMap = cogsRateMap[activeBrand] ?? {};
    const globalAvg    = cogsRateMap["평균"]?.["평균"] ?? 0.441;

    return Object.entries(brandStores)
      .sort(([a], [b]) => a.localeCompare(b))
      .filter(([, stores]) => {
        const annualTotal = stores.reduce(
          (sum, s) => sum + MONTHS.reduce((ms, m) => ms + (s.months[m] ?? 0), 0),
          0
        );
        return annualTotal > 0;
      })
      .map(([accountId, stores]) => {
        const retail = stores.reduce((sum, s) => {
          const v = selectedMonth === "annual"
            ? MONTHS.reduce((ms, m) => ms + (s.months[m] ?? 0), 0)
            : (s.months[selectedMonth as number] ?? 0);
          return sum + v;
        }, 0);

        const tag = stores.reduce((sum, s) => {
          const sr = selectedMonth === "annual"
            ? MONTHS.reduce((ms, m) => ms + (s.months[m] ?? 0), 0)
            : (s.months[selectedMonth as number] ?? 0);
          return sum + calcTag(sr, s.discountRate);
        }, 0);

        const cogsRate = brandCogsMap[accountId] ?? globalAvg;
        const cogs = (tag * cogsRate) / 1.13;
        const grossProfit = retail / 1.13 - cogs;

        // ── 직접비: 매장 합산 ────────────────────────────────────
        let salary = 0, bonus = 0, headcount = 0, insurance = 0, rent = 0, depr = 0;
        for (const s of stores) {
          const dc = storeDirectCostMap[s.storeCode];
          if (!dc) continue;
          headcount += dc.headcount;
          if (selectedMonth === "annual") {
            for (const m of MONTHS) {
              const curYM  = ym(m);
              const retailM = s.months[m] ?? 0;
              const salM    = dc.avgSalary * dc.headcount;
              const bonusM  = retailM * dc.bonusRate;
              const insM    = (salM + bonusM) * dc.insuranceRate;
              const deprM   = calcDeprForMonth(dc.interiorCost, dc.openMonth, dc.amortEndMonth, dc.closedMonth, curYM);
              salary    += salM;
              bonus     += bonusM;
              insurance += insM;
              rent      += dc.rent;
              depr      += deprM;
            }
          } else {
            const m      = selectedMonth as number;
            const curYM  = ym(m);
            const retailM = s.months[m] ?? 0;
            const salM   = dc.avgSalary * dc.headcount;
            const bonusM = retailM * dc.bonusRate;
            salary    += salM;
            bonus     += bonusM;
            insurance += (salM + bonusM) * dc.insuranceRate;
            rent      += dc.rent;
            depr      += calcDeprForMonth(dc.interiorCost, dc.openMonth, dc.amortEndMonth, dc.closedMonth, curYM);
          }
        }
        const directCost = salary + bonus + insurance + rent + depr;

        return {
          accountId,
          accountNameKr: accountNameMap[accountId]?.account_nm_kr ?? "",
          accountNameEn: accountNameMap[accountId]?.account_nm_en ?? "",
          retail,
          tag,
          cogsRate,
          cogs,
          grossProfit,
          salary,
          bonus,
          headcount,
          insurance,
          rent,
          depr,
          directCost,
          operatingProfit: grossProfit - directCost,
        };
      });
  }, [storeRetailMap, activeBrand, selectedMonth, cogsRateMap, accountNameMap, storeDirectCostMap]);

  const totals = useMemo(() => ({
    retail:          rows.reduce((s, r) => s + r.retail, 0),
    tag:             rows.reduce((s, r) => s + r.tag, 0),
    cogs:            rows.reduce((s, r) => s + r.cogs, 0),
    grossProfit:     rows.reduce((s, r) => s + r.grossProfit, 0),
    salary:          rows.reduce((s, r) => s + r.salary, 0),
    bonus:           rows.reduce((s, r) => s + r.bonus, 0),
    headcount:       rows.reduce((s, r) => s + r.headcount, 0),
    insurance:       rows.reduce((s, r) => s + r.insurance, 0),
    rent:            rows.reduce((s, r) => s + r.rent, 0),
    depr:            rows.reduce((s, r) => s + r.depr, 0),
    directCost:      rows.reduce((s, r) => s + r.directCost, 0),
    operatingProfit: rows.reduce((s, r) => s + r.operatingProfit, 0),
  }), [rows]);

  return (
    <>
      <div className="space-y-4">
        {/* 헤더 */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold text-slate-700">대리상별 손익계산서</h2>
            <div className="flex gap-1 rounded-xl bg-stone-100 p-1">
              {brands.map((b) => (
                <button
                  key={b}
                  onClick={() => setSelectedBrand(b)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                    activeBrand === b
                      ? "bg-white text-slate-800 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
          <select
            value={selectedMonth}
            onChange={(e) =>
              setSelectedMonth(e.target.value === "annual" ? "annual" : Number(e.target.value))
            }
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            {DROPDOWN_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* 메인 테이블 */}
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-right text-xs">
            <PLTableHead firstColLabel="대리상명" />
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, i) => (
                <tr
                  key={row.accountId}
                  onClick={() => setModalDealer(row)}
                  className={`cursor-pointer transition-colors ${
                    i % 2 === 0 ? "bg-white hover:bg-blue-50/60" : "bg-slate-50/50 hover:bg-blue-50/60"
                  }`}
                >
                  <td className="sticky left-0 z-10 bg-inherit px-3 py-2 text-left whitespace-nowrap">
                    <span className="text-slate-400 mr-1 text-[10px]">({row.accountId})</span>
                    {row.accountNameKr && (
                      <span className="text-slate-700 font-medium">{row.accountNameKr}</span>
                    )}
                    {row.accountNameKr && row.accountNameEn && (
                      <span className="text-slate-300 mx-1">|</span>
                    )}
                    {row.accountNameEn && (
                      <span className="text-slate-500">{row.accountNameEn}</span>
                    )}
                    {(storeRetailMap[activeBrand]?.[row.accountId]?.length ?? 0) > 0 && (
                      <span className="ml-2 text-[10px] text-blue-400">
                        ▶ {storeRetailMap[activeBrand][row.accountId].length}개 매장
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-700 border-l border-slate-100">{fmt(row.tag)}</td>
                  <td className="px-3 py-2 text-slate-700">{fmt(row.retail)}</td>
                  <td className="px-3 py-2 text-slate-500 border-l border-slate-100">{fmtRate(row.cogsRate)}</td>
                  <td className="px-3 py-2 text-slate-700">{fmt(row.cogs)}</td>
                  <td className="px-3 py-2 text-slate-700 border-l border-slate-100">{fmt(row.grossProfit)}</td>
                  <DirectCostCells
                    salary={row.salary}
                    bonus={row.bonus}
                    headcount={row.headcount}
                    insurance={row.insurance}
                    rent={row.rent}
                    depr={row.depr}
                    directCost={row.directCost}
                  />
                  <td className={`px-3 py-2 font-semibold border-l border-slate-300 ${row.operatingProfit >= 0 ? "text-blue-700" : "text-red-600"}`}>
                    {fmt(row.operatingProfit)}
                  </td>
                </tr>
              ))}
              {rows.length > 0 && <TotalRow totals={totals} />}
            </tbody>
          </table>

          {rows.length === 0 && (
            <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
              데이터가 없습니다.
            </div>
          )}
        </div>

        <p className="text-right text-[11px] text-slate-400">
          단위: 천위안(千元) · 기타(마케팅/포장/지급수수료) 항목은 추후 추가 · 대리상 행 클릭 시 매장별 상세 조회
        </p>
      </div>

      {/* 매장별 팝업 모달 */}
      {modalDealer && (
        <StoreModal
          dealer={modalDealer}
          brand={activeBrand}
          selectedMonth={selectedMonth}
          storeRetailMap={storeRetailMap}
          storeDirectCostMap={storeDirectCostMap}
          cogsRate={modalDealer.cogsRate}
          onClose={closeModal}
        />
      )}
    </>
  );
}
