"use client";

import { useState, useMemo, useEffect, useCallback, type ReactNode } from "react";
import {
  BRAND_ORDER,
  MONTHS,
  StoreRetailMap,
  StoreDirectCostMap,
  type StoreDirectCost,
  type StoreRetailRow,
} from "../../lib/types";
import type { AccountNameMap } from "./StockView";

interface Props {
  cogsRateMap: Record<string, Record<string, number>>;
  accountNameMap: AccountNameMap;
  storeRetailMap?: StoreRetailMap;
  storeDirectCostMap?: StoreDirectCostMap;
  retailYoy2025Map?: Record<string, Record<number, number>> | null;
}

type MonthOption = "annual" | number;
type PLTableVariant = "dealer" | "store";
/** 매장 모달 표 열 정렬 */
type StoreTableSortKey = "name" | "retail" | "grossProfit";
type OpenGroups = { labor: boolean; rent: boolean; other: boolean };
const DEFAULT_OPEN_GROUPS: OpenGroups = { labor: false, rent: false, other: false };

/**
 * PL 계산 단일 출처 — 이 값을 바꾸면 실제 계산·KPI 범례·표시 비율이 함께 바뀝니다.
 * 범례 문장은 `buildPlKpiLegendItems`에서만 조합합니다.
 */
const PL_CALC = {
  /** 리테일(V+) ↔ 순매출 환산 (원가·이익·임차 변동·비율 지표에 공통) */
  retailVatFactor: 1.13,
  /** CSV 임차료 → 월 고정임차 */
  rentFixedDivisor: 1.05,
  /** 연간 합계 조회 시 평균인건비·인당급여를 월 기준으로 보기 위한 나눗셈 */
  annualMonthsForAvgLabor: 12,
  /** 기타 직접비 변동율 */
  marketingRate: 0.005,
  packagingRate: 0.015,
  payFeeRate: 0.002,
  /** 지급수수료 월 고정분 (위안, 매장당) */
  payFeeFixed: 2000,
  othersRate: 0.005,
} as const;

/** 평균인건비 표시: 월 조회는 그대로, 연간은 (급여+성과급)/인원을 월로 환산 */
function avgLaborPerHeadForDisplay(
  salary: number,
  bonus: number,
  headcount: number,
  selectedMonth: MonthOption,
): number {
  if (headcount <= 0) return 0;
  let v = (salary + bonus) / headcount;
  if (selectedMonth === "annual") v /= PL_CALC.annualMonthsForAvgLabor;
  return v;
}

/**
 * KPI 범례의 직접비 구성 — `directCost` 산식(매장/대리상)과 맞출 것.
 * (코드: salary+bonus+insurance+rent+depr+marketing+…)
 */
const PL_LEGEND_DIRECT_COST_FORMULA =
  "급여 + 성과급 + 보험/공적금 + 임차(고정+변동) + 감가상각비 + 기타(마케팅·포장·지급수수료·others)";

/** 데이터 열 개수 (첫 열 제외): store — 인건비 접어도 인원·평균인건비 2열 유지 */
const DATA_COLS_STORE = 27;

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

/** 점당 금액(위안) 기준 리테일(V+) 대비 비율 — 그룹 KPI 표 %열 */
function fmtPerPointVatRate(perNumerator: number, perRetail: number): string {
  if (!(perRetail > 0)) return "—";
  return fmtRate((perNumerator * PL_CALC.retailVatFactor) / perRetail);
}

/** Open Month yyyyMM → YYYY.MM */
function fmtOpenMonth(ymNum: number): string {
  if (!ymNum || ymNum < 100000) return "—";
  const y = Math.floor(ymNum / 100);
  const m = ymNum % 100;
  return `${y}.${String(m).padStart(2, "0")}`;
}

function StoreKpiCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="group relative flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white px-3.5 py-2.5 min-w-[108px] shrink-0 shadow-[0_1px_4px_rgba(15,23,42,0.06)] hover:shadow-[0_4px_12px_rgba(15,23,42,0.10)] hover:border-slate-300 transition-all duration-150">
      <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest mb-1">{label}</div>
      <div className="text-[13px] font-bold tabular-nums text-slate-800 leading-tight">{value}</div>
      {sub ? <div className="text-[9px] text-slate-400 mt-1 font-medium">{sub}</div> : null}
      <div className="absolute inset-x-0 bottom-0 h-[2px] rounded-b-xl bg-[linear-gradient(90deg,#3c6aa1,#7ab3e0)] opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
    </div>
  );
}

type PlKpiLegendCtx = {
  selectedMonth: MonthOption;
  monthLabel: string;
  hasDc: boolean;
  commissionRate: number;
  cogsRate: number;
  discountRate: number;
};

/** KPI 범례 항목 — `PL_CALC`·`PL_LEGEND_*`만 사용해 문구 생성 (하드코딩 분산 방지) */
function buildPlKpiLegendItems(ctx: PlKpiLegendCtx): ReactNode[] {
  const v = PL_CALC.retailVatFactor;
  const r = PL_CALC.rentFixedDivisor;
  const bonusScope = ctx.selectedMonth === "annual" ? "월별 동일 합산" : "해당 월";

  return [
    <li key="tag">
      <span className="font-semibold text-slate-700">Tag</span> = 리테일(V+) ÷ (1 − 전년할인율)
      {ctx.hasDc ? ` (할인율 ${fmtRate(ctx.discountRate)})` : ""}.
    </li>,
    <li key="cogs">
      <span className="font-semibold text-slate-700">매출원가</span> = Tag × 출고율 ÷ {v}
      {ctx.hasDc ? ` (출고율 ${fmtRate(ctx.cogsRate)})` : ""}.
    </li>,
    <li key="gp">
      <span className="font-semibold text-slate-700">매출이익</span> = 리테일(V+) ÷ {v} − 매출원가.
    </li>,
    <li key="gmr">
      <span className="font-semibold text-slate-700">매출이익률</span> = 매출이익 × {v} ÷ 리테일(V+).
    </li>,
    <li key="dc">
      <span className="font-semibold text-slate-700">직접비합계</span> = {PL_LEGEND_DIRECT_COST_FORMULA}.
    </li>,
    <li key="costRate">
      <span className="font-semibold text-slate-700">비용률</span> = 직접비합계 × {v} ÷ 리테일(V+).
    </li>,
    <li key="labor">
      <span className="font-semibold text-slate-700">인건비</span> = 급여 + 성과급. 급여 = 평균급여×인원({bonusScope}
      ). 성과급 = 해당 월 리테일×bonus%.{" "}
      <span className="font-semibold text-slate-700">평균인건비</span>·인당급여 KPI = (급여+성과급)÷인원 → 천위안
      표시; 26년 합계일 때 ÷{PL_CALC.annualMonthsForAvgLabor}(월 환산).
    </li>,
    <li key="ins">
      <span className="font-semibold text-slate-700">보험/공적금</span> = (급여+성과급) × 보험율.
    </li>,
    <li key="rent">
      <span className="font-semibold text-slate-700">임차(메인·모달 동일)</span> ={" "}
      <span className="text-slate-500">고정</span>(FR 임차료÷{r}, 월) +{" "}
      <span className="text-slate-500">변동</span>(해당 월 리테일÷{v}×수수료율)
      {ctx.hasDc ? ` — 수수료율 ${fmtRate(ctx.commissionRate)}` : " (수수료율 CSV)"}.
    </li>,
    <li key="depr">
      <span className="font-semibold text-slate-700">감가상각비</span>: 모달은 인테리어(CSV)를 월 상각액으로 두고{" "}
      <code className="text-[9px] bg-slate-200/80 px-0.5 rounded">calcDeprForMonthStoreModal</code> (Open~Amort·휴점
      반영). 메인은{" "}
      <code className="text-[9px] bg-slate-200/80 px-0.5 rounded">calcDeprForMonth</code> — 인테리어÷상각월수.
    </li>,
    <li key="others">
      <span className="font-semibold text-slate-700">기타 직접비</span> (매장별 월 기준, 연간은 합산):
      <ul className="mt-0.5 ml-3 space-y-0.5 text-slate-600">
        <li>마케팅 = 리테일(V+) ÷ {v} × {PL_CALC.marketingRate}</li>
        <li>포장 = 리테일(V+) ÷ {v} × {PL_CALC.packagingRate}</li>
        <li>지급수수료 = 리테일(V+) ÷ {v} × {PL_CALC.payFeeRate} + {PL_CALC.payFeeFixed.toLocaleString()}위안(고정)</li>
        <li>others = 리테일(V+) ÷ {v} × {PL_CALC.othersRate}</li>
      </ul>
    </li>,
    <li key="op">
      <span className="font-semibold text-slate-700">영업이익</span> = 매출이익 − 직접비합계.{" "}
      <span className="font-semibold text-slate-700">영업이익률</span> = 영업이익 × {v} ÷ 리테일(V+).
    </li>,
    <li key="note" className="text-slate-500 pt-0.5 border-t border-slate-200/80">
      단위: 천위안(千元). 리테일 0이면 비율·영업이익률 등은 표시 생략(—). 전년할인율 CSV는 퍼센트 숫자(예:
      23.07 또는 23.07%)로 두면 앱에서 ÷100 해 소수로 반영. 구현:{" "}
      <code className="text-[9px] bg-slate-200/80 px-0.5 rounded">PL_CALC</code> 상수 참조.
    </li>,
    <li key="script" className="text-slate-500 pt-0.5 border-t border-slate-200/80">
      <span className="font-semibold text-slate-600">전년(2025) 리테일 데이터 갱신</span> — 아래 명령어 실행 후
      새로고침:
      <code className="block mt-1 select-all rounded bg-slate-100 px-2 py-1 text-[10px] font-mono text-slate-700">
        python scripts/preprocess_retail_yoy.py
      </code>
    </li>,
  ];
}

/** 대리상 PL — 계산로직 팝업 (메인 화면) */
function PlCalcLogicModal({
  open,
  onClose,
  ctx,
}: {
  open: boolean;
  onClose: () => void;
  ctx: PlKpiLegendCtx;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const items = buildPlKpiLegendItems(ctx);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative w-full max-w-3xl max-h-[min(85vh,640px)] rounded-2xl border border-slate-200 bg-white shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pl-calc-logic-title"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 bg-slate-50 shrink-0">
          <h3 id="pl-calc-logic-title" className="text-sm font-bold text-slate-800">
            계산 로직 <span className="text-slate-500 font-normal">({ctx.monthLabel})</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors shrink-0"
            aria-label="닫기"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-3 text-left">
          <ul className="space-y-2 text-[11px] text-slate-600 leading-relaxed list-none">{items}</ul>
        </div>
      </div>
    </div>
  );
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
  salary: number;
  bonus: number;
  headcount: number;
  insurance: number;
  rent: number;
  depr: number;
  marketing: number;
  packaging: number;
  payFee: number;
  othersLine: number;
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
  salary: number;
  bonus: number;
  headcount: number;
  insurance: number;
  rent: number;
  rentFixed: number;
  rentVariable: number;
  depr: number;
  directCost: number;
  operatingProfit: number;
  marketing: number;
  packaging: number;
  payFee: number;
  othersLine: number;
}

/** 2026년 기준 yyyyMM 정수 생성: 월 1~12 → 202601~202612 */
function ym(month: number): number {
  return 202600 + month;
}

/** 월 고정임차 = CSV 임차료 / PL_CALC.rentFixedDivisor */
function rentFixedMonth(dc: StoreDirectCost): number {
  if (!dc || dc.rent <= 0) return 0;
  return dc.rent / PL_CALC.rentFixedDivisor;
}

/** 월 변동임차 = (당월 리테일 / PL_CALC.retailVatFactor) × 수수료율 */
function rentVariableMonth(retailM: number, dc: StoreDirectCost | undefined): number {
  if (!dc) return 0;
  const rate = dc.commissionRate ?? 0;
  return (retailM / PL_CALC.retailVatFactor) * rate;
}

function rentTotalMonth(retailM: number, dc: StoreDirectCost | undefined): number {
  if (!dc) return 0;
  return rentFixedMonth(dc) + rentVariableMonth(retailM, dc);
}

/** 월 기타 직접비 4개 항목 (매장별, 리테일 1위안 단위 입력) */
function calcOtherCostsMonth(retailM: number) {
  const base = retailM / PL_CALC.retailVatFactor;
  return {
    marketing:  base * PL_CALC.marketingRate,
    packaging:  base * PL_CALC.packagingRate,
    payFee:     base * PL_CALC.payFeeRate + PL_CALC.payFeeFixed,
    othersLine: base * PL_CALC.othersRate,
  };
}

/**
 * 메인 대리상표 감가: 인테리어 총액 / 상각 개월수
 */
function calcDeprForMonth(
  interiorCost: number,
  openMonth: number,
  amortEndMonth: number,
  closedMonth: number | null,
  currentMonth: number,
): number {
  if (openMonth <= 0 || amortEndMonth <= 0) return 0;
  if (currentMonth < openMonth || currentMonth > amortEndMonth) return 0;
  if (closedMonth !== null && currentMonth > closedMonth) return 0;
  const startYear = Math.floor(openMonth / 100);
  const startMon = openMonth % 100;
  const endYear = Math.floor(amortEndMonth / 100);
  const endMon = amortEndMonth % 100;
  const months = (endYear - startYear) * 12 + (endMon - startMon) + 1;
  if (months <= 0) return 0;
  return interiorCost / months;
}

/**
 * 매장 모달 감가: 인테리어 = 월 상각액, 기간 내 월만 반영
 */
function calcDeprForMonthStoreModal(
  monthlyInterior: number,
  openMonth: number,
  amortEndMonth: number,
  closedMonth: number | null,
  currentMonth: number,
): number {
  if (openMonth <= 0 || amortEndMonth <= 0) return 0;
  if (currentMonth < openMonth || currentMonth > amortEndMonth) return 0;
  if (closedMonth !== null && currentMonth > closedMonth) return 0;
  return monthlyInterior;
}

function plGrossMarginRate(retail: number, grossProfit: number): number | null {
  if (!(retail > 0)) return null;
  return (grossProfit * PL_CALC.retailVatFactor) / retail;
}

function plCostRate(retail: number, directCost: number): number | null {
  if (!(retail > 0)) return null;
  return (directCost * PL_CALC.retailVatFactor) / retail;
}

const REF_COL = "bg-sky-200 text-slate-600";
const SUB_HEAD = "text-slate-500";
const L1_HEAD = "text-slate-700 font-semibold";

// ─── 직접비 데이터 셀 ─────────────────────────────────────────────
interface DirectCostCellsProps {
  variant: PLTableVariant;
  selectedMonth: MonthOption;
  openGroups: OpenGroups;
  retail: number;
  salary: number;
  bonus: number;
  headcount: number;
  insurance: number;
  rent: number;
  rentFixed?: number;
  rentVariable?: number;
  depr: number;
  directCost: number;
  marketing: number;
  packaging: number;
  payFee: number;
  othersLine: number;
}

function DirectCostCells({
  variant,
  selectedMonth,
  openGroups,
  retail,
  salary,
  bonus,
  headcount,
  insurance,
  rent,
  rentFixed = 0,
  rentVariable = 0,
  depr,
  directCost,
  marketing,
  packaging,
  payFee,
  othersLine,
}: DirectCostCellsProps) {
  const cls = (v: number) => (v === 0 ? "text-slate-300" : "text-slate-700");
  const clsSub = (v: number) => (v === 0 ? "text-slate-300" : "text-slate-600");
  const f = (v: number) => (v === 0 ? "—" : fmt(v));
  const labor = salary + bonus;
  const otherSum = marketing + packaging + payFee + othersLine;
  const avgLaborCost = avgLaborPerHeadForDisplay(salary, bonus, headcount, selectedMonth);
  const REF_TD = "bg-slate-100";
  const cr = plCostRate(retail, directCost);

  const subTd = (v: number) => (
    <td className={`px-3 py-2 ${clsSub(v)}`}>{f(v)}</td>
  );

  return (
    <>
      <td className={`px-3 py-2 border-l border-slate-200 ${cls(directCost)}`}>{f(directCost)}</td>
      <td className={`px-3 py-2 ${cr === null ? "text-slate-300" : "text-slate-600"}`}>
        {cr === null ? "—" : fmtRate(cr)}
      </td>
      <td className={`px-3 py-2 font-semibold text-slate-700 ${cls(labor)}`}>{f(labor)}</td>
      {openGroups.labor && (
        <>
          {subTd(salary)}
          {subTd(bonus)}
        </>
      )}
      <td
        className={`px-3 py-2 border-l border-slate-300 ${REF_TD} ${
          headcount === 0 ? "text-slate-400" : "text-slate-600"
        }`}
      >
        {headcount === 0 ? "—" : `${headcount}명`}
      </td>
      <td className={`px-3 py-2 ${REF_TD} ${avgLaborCost === 0 ? "text-slate-400" : "text-slate-700"}`}>
        {avgLaborCost === 0 ? "—" : (avgLaborCost / 1000).toFixed(2)}
      </td>
      <td className={`px-3 py-2 border-l border-slate-300 font-semibold ${cls(insurance)}`}>{f(insurance)}</td>
      <td className={`px-3 py-2 font-semibold ${cls(rent)}`}>{f(rent)}</td>
      {variant === "store" && openGroups.rent && (
        <>
          {subTd(rentFixed)}
          {subTd(rentVariable)}
        </>
      )}
      <td className={`px-3 py-2 border-l border-slate-200 font-semibold ${cls(depr)}`}>{f(depr)}</td>
      <td className={`px-3 py-2 font-semibold ${cls(otherSum)}`}>{f(otherSum)}</td>
      {openGroups.other && (
        <>
          <td className={`px-3 py-2 ${SUB_HEAD} ${clsSub(marketing)}`}>{f(marketing)}</td>
          <td className={`px-3 py-2 ${SUB_HEAD} ${clsSub(packaging)}`}>{f(packaging)}</td>
          <td className={`px-3 py-2 ${SUB_HEAD} ${clsSub(payFee)}`}>{f(payFee)}</td>
          <td className={`px-3 py-2 ${SUB_HEAD} ${clsSub(othersLine)}`}>{f(othersLine)}</td>
        </>
      )}
    </>
  );
}

function PLTableHead({
  firstColLabel,
  variant,
  openGroups,
  onToggle,
  storeColumnSort,
}: {
  firstColLabel: string;
  variant: PLTableVariant;
  openGroups: OpenGroups;
  onToggle: (key: keyof OpenGroups) => void;
  /** 매장 모달 전용: 매장명·리테일·매출이익 헤더 클릭 정렬 */
  storeColumnSort?: {
    sortKey: StoreTableSortKey;
    sortDir: "asc" | "desc";
    onSort: (key: StoreTableSortKey) => void;
  };
}) {
  // base=7: 직접비합계+비용률+인건비+보험+임차료+감가+기타
  const laborExtraCols = 2 + (openGroups.labor ? 2 : 0);
  const directSpan =
    7 +
    laborExtraCols +
    (variant === "store" && openGroups.rent ? 2 : 0) +
    (openGroups.other ? 4 : 0);

  const toggleBtn = (key: keyof OpenGroups, isOpen: boolean) => (
    <button
      type="button"
      onClick={() => onToggle(key)}
      className="ml-1 opacity-60 hover:opacity-100 transition-opacity text-[9px] leading-none"
      title={isOpen ? "접기" : "펼치기"}
    >
      {isOpen ? "▼" : "▶"}
    </button>
  );

  const sortMark = (key: StoreTableSortKey) => {
    if (!storeColumnSort || storeColumnSort.sortKey !== key) {
      return <span className="ml-0.5 text-[9px] font-normal text-slate-400">↕</span>;
    }
    return (
      <span className="ml-0.5 text-[9px] font-normal text-blue-700">
        {storeColumnSort.sortDir === "asc" ? "▲" : "▼"}
      </span>
    );
  };

  const sortableThBtnClass =
    "inline-flex max-w-full items-center rounded px-0.5 -mx-0.5 text-left font-semibold text-slate-700 hover:bg-sky-200/80 hover:text-blue-800";

  return (
    <thead className="sticky top-0 z-20">
      <tr className="bg-[#1e3a5f] border-b border-[#1e3a5f]">
        <th className="sticky left-0 z-10 bg-[#1e3a5f] px-3 py-1.5" />
        {variant === "store" && (
          <>
            <th className="px-3 py-1.5 border-l border-white/20" />
            <th className="px-3 py-1.5" />
          </>
        )}
        <th
          colSpan={2}
          className="px-3 py-1.5 text-center text-[10px] font-semibold text-white border-l border-white/20"
        >
          매출
        </th>
        <th
          colSpan={2}
          className="px-3 py-1.5 text-center text-[10px] font-semibold text-white border-l border-white/20"
        >
          원가
        </th>
        <th
          colSpan={2}
          className="px-3 py-1.5 text-center text-[10px] font-semibold text-white border-l border-white/20"
        >
          매출이익
        </th>
        <th
          colSpan={directSpan}
          className="px-3 py-1.5 text-center text-[10px] font-semibold text-sky-200 border-l border-white/20"
        >
          직접비
        </th>
        <th
          colSpan={2}
          className="px-3 py-1.5 text-center text-[10px] font-semibold text-sky-200 border-l border-white/20"
        >
          영업이익
        </th>
      </tr>
      <tr className="bg-sky-100 border-b border-sky-200">
        <th className="sticky left-0 z-10 bg-sky-100 px-3 py-2.5 text-left text-xs font-semibold text-slate-700 min-w-[200px]">
          {variant === "store" && storeColumnSort ? (
            <button
              type="button"
              className={sortableThBtnClass}
              title="매장명 기준 정렬"
              onClick={(e) => {
                e.stopPropagation();
                storeColumnSort.onSort("name");
              }}
            >
              {firstColLabel}
              {sortMark("name")}
            </button>
          ) : (
            firstColLabel
          )}
        </th>
        {variant === "store" && (
          <>
            <th className="px-3 py-2.5 text-xs font-semibold text-slate-700 whitespace-nowrap border-l border-sky-200">
              Store Type
            </th>
            <th className="px-3 py-2.5 text-xs font-semibold text-slate-700 whitespace-nowrap">
              Trade Zone
            </th>
          </>
        )}
        <th className="px-3 py-2.5 text-xs font-semibold text-slate-700 whitespace-nowrap border-l border-sky-200">
          Tag
        </th>
        <th className="px-3 py-2.5 text-xs font-semibold text-slate-700 whitespace-nowrap">
          {variant === "store" && storeColumnSort ? (
            <button
              type="button"
              className={`${sortableThBtnClass} justify-end w-full`}
              title="리테일(V+) 기준 정렬"
              onClick={(e) => {
                e.stopPropagation();
                storeColumnSort.onSort("retail");
              }}
            >
              리테일(V+)
              {sortMark("retail")}
            </button>
          ) : (
            "리테일(V+)"
          )}
        </th>
        <th className="px-3 py-2.5 text-xs font-semibold text-slate-700 whitespace-nowrap border-l border-sky-200">
          25년 출고율
        </th>
        <th className="px-3 py-2.5 text-xs font-semibold text-slate-700 whitespace-nowrap">매출원가</th>
        <th className="px-3 py-2.5 text-xs font-semibold text-slate-700 whitespace-nowrap border-l border-sky-200">
          {variant === "store" && storeColumnSort ? (
            <button
              type="button"
              className={`${sortableThBtnClass} justify-end w-full`}
              title="매출이익 기준 정렬"
              onClick={(e) => {
                e.stopPropagation();
                storeColumnSort.onSort("grossProfit");
              }}
            >
              매출이익
              {sortMark("grossProfit")}
            </button>
          ) : (
            "매출이익"
          )}
        </th>
        <th className="px-3 py-2.5 text-xs font-semibold text-slate-700 whitespace-nowrap">매출이익률</th>
        <th className="px-3 py-2.5 text-xs font-semibold text-slate-700 whitespace-nowrap border-l border-sky-200">
          직접비합계
        </th>
        <th className="px-3 py-2.5 text-xs font-semibold text-slate-700 whitespace-nowrap">비용률</th>
        <th className={`px-3 py-2.5 text-xs whitespace-nowrap cursor-pointer select-none ${L1_HEAD}`}>
          인건비{toggleBtn("labor", openGroups.labor)}
        </th>
        {openGroups.labor && (
          <>
            <th className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap ${SUB_HEAD}`}>(급여)</th>
            <th className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap ${SUB_HEAD}`}>(성과급)</th>
          </>
        )}
        <th className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap border-l border-sky-300 ${REF_COL}`}>
          인원수
        </th>
        <th className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap ${REF_COL}`}>평균인건비</th>
        <th
          className={`px-3 py-2.5 text-xs whitespace-nowrap border-l border-sky-300 ${L1_HEAD}`}
        >
          보험/공적금
        </th>
        <th className={`px-3 py-2.5 text-xs whitespace-nowrap cursor-pointer select-none ${L1_HEAD}`}>
          임차료{variant === "store" ? toggleBtn("rent", openGroups.rent) : null}
        </th>
        {variant === "store" && openGroups.rent && (
          <>
            <th className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap ${SUB_HEAD}`}>(고정)</th>
            <th className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap ${SUB_HEAD}`}>(변동)</th>
          </>
        )}
        <th className={`px-3 py-2.5 text-xs whitespace-nowrap border-l border-sky-200 ${L1_HEAD}`}>
          감가상각비
        </th>
        <th className={`px-3 py-2.5 text-xs whitespace-nowrap cursor-pointer select-none ${L1_HEAD}`}>
          기타{toggleBtn("other", openGroups.other)}
        </th>
        {openGroups.other && (
          <>
            <th className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap ${SUB_HEAD}`}>(마케팅)</th>
            <th className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap ${SUB_HEAD}`}>(포장)</th>
            <th className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap ${SUB_HEAD}`}>(지급수수료)</th>
            <th className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap ${SUB_HEAD}`}>(others)</th>
          </>
        )}
        <th className="px-3 py-2.5 text-xs font-bold text-[#1e3a5f] whitespace-nowrap border-l border-sky-300">
          영업이익
        </th>
        <th className="px-3 py-2.5 text-xs font-bold text-[#1e3a5f] whitespace-nowrap">영업이익률</th>
      </tr>
    </thead>
  );
}

interface TotalRowTotals {
  tag: number;
  retail: number;
  cogs: number;
  grossProfit: number;
  salary: number;
  bonus: number;
  headcount: number;
  insurance: number;
  rent: number;
  rentFixed?: number;
  rentVariable?: number;
  depr: number;
  directCost: number;
  operatingProfit: number;
  marketing: number;
  packaging: number;
  payFee: number;
  othersLine: number;
}

function TotalRow({
  totals,
  variant,
  selectedMonth,
  openGroups,
}: {
  totals: TotalRowTotals;
  variant: PLTableVariant;
  selectedMonth: MonthOption;
  openGroups: OpenGroups;
}) {
  const f = (v: number) => (v === 0 ? "—" : fmt(v));
  const c = (v: number) => (v === 0 ? "text-slate-300" : "text-slate-800");
  const cSub = (v: number) => (v === 0 ? "text-slate-300" : "text-slate-700");
  const labor = totals.salary + totals.bonus;
  const otherSum = totals.marketing + totals.packaging + totals.payFee + totals.othersLine;
  const avgLaborCost = avgLaborPerHeadForDisplay(
    totals.salary,
    totals.bonus,
    totals.headcount,
    selectedMonth,
  );
  const gmr = plGrossMarginRate(totals.retail, totals.grossProfit);
  const cr = plCostRate(totals.retail, totals.directCost);
  const rf = totals.rentFixed ?? 0;
  const rv = totals.rentVariable ?? 0;

  const subTd = (v: number) => (
    <td className={`px-3 py-2.5 ${cSub(v)}`}>{f(v)}</td>
  );

  return (
    <tr className="border-t-2 border-slate-300 bg-slate-100 font-semibold text-xs">
      <td className="sticky left-0 z-10 bg-slate-100 px-3 py-2.5 text-left text-slate-800">합 계</td>
      {variant === "store" && (
        <>
          <td className="px-3 py-2.5 border-l border-slate-200" />
          <td className="px-3 py-2.5" />
        </>
      )}
      <td className="px-3 py-2.5 text-slate-800 border-l border-slate-200">{fmt(totals.tag)}</td>
      <td className="px-3 py-2.5 text-slate-800">{fmt(totals.retail)}</td>
      <td className="px-3 py-2.5 text-slate-400 border-l border-slate-200">—</td>
      <td className="px-3 py-2.5 text-slate-800">{fmt(totals.cogs)}</td>
      <td className="px-3 py-2.5 text-slate-800 border-l border-slate-200">{fmt(totals.grossProfit)}</td>
      <td className={`px-3 py-2.5 ${gmr === null ? "text-slate-400" : "text-slate-800"}`}>
        {gmr === null ? "—" : fmtRate(gmr)}
      </td>
      <td className={`px-3 py-2.5 border-l border-slate-200 ${c(totals.directCost)}`}>{f(totals.directCost)}</td>
      <td className={cr === null ? "text-slate-400" : "text-slate-800"}>{cr === null ? "—" : fmtRate(cr)}</td>
      <td className={`px-3 py-2.5 text-slate-800 ${c(labor)}`}>{f(labor)}</td>
      {openGroups.labor && (
        <>
          {subTd(totals.salary)}
          {subTd(totals.bonus)}
        </>
      )}
      <td
        className={`px-3 py-2.5 bg-slate-200 border-l border-slate-300 ${
          totals.headcount === 0 ? "text-slate-400" : "text-slate-700"
        }`}
      >
        {totals.headcount === 0 ? "—" : `${totals.headcount}명`}
      </td>
      <td className={`px-3 py-2.5 bg-slate-200 ${avgLaborCost === 0 ? "text-slate-400" : "text-slate-700"}`}>
        {avgLaborCost === 0 ? "—" : (avgLaborCost / 1000).toFixed(2)}
      </td>
      <td className={`px-3 py-2.5 border-l border-slate-300 text-slate-800 ${c(totals.insurance)}`}>
        {f(totals.insurance)}
      </td>
      <td className={`px-3 py-2.5 text-slate-800 ${c(totals.rent)}`}>{f(totals.rent)}</td>
      {variant === "store" && openGroups.rent && (
        <>
          {subTd(rf)}
          {subTd(rv)}
        </>
      )}
      <td className={`px-3 py-2.5 border-l border-slate-200 text-slate-800 ${c(totals.depr)}`}>{f(totals.depr)}</td>
      <td className={`px-3 py-2.5 text-slate-800 ${c(otherSum)}`}>{f(otherSum)}</td>
      {openGroups.other && (
        <>
          <td className={`px-3 py-2.5 ${cSub(totals.marketing)}`}>{f(totals.marketing)}</td>
          <td className={`px-3 py-2.5 ${cSub(totals.packaging)}`}>{f(totals.packaging)}</td>
          <td className={`px-3 py-2.5 ${cSub(totals.payFee)}`}>{f(totals.payFee)}</td>
          <td className={`px-3 py-2.5 ${cSub(totals.othersLine)}`}>{f(totals.othersLine)}</td>
        </>
      )}
      <td
        className={`px-3 py-2.5 font-bold border-l border-slate-300 ${
          totals.operatingProfit >= 0 ? "text-blue-800" : "text-red-700"
        }`}
      >
        {fmt(totals.operatingProfit)}
      </td>
      <td
        className={`px-3 py-2.5 font-bold ${
          totals.operatingProfit >= 0 ? "text-blue-800" : "text-red-700"
        }`}
      >
        {totals.retail > 0
          ? fmtRate((totals.operatingProfit * PL_CALC.retailVatFactor) / totals.retail)
          : "—"}
      </td>
    </tr>
  );
}

/** Trade Zone KPI 표 정렬: H → F1,F2,… → O1,O2,… → 기타 → 미정 */
function compareTradeZoneKpi(a: { key: string }, b: { key: string }): number {
  const tier = (k: string): [number, number, string] => {
    if (k === "미정") return [4, 0, k];
    if (/^H$/i.test(k)) return [0, 0, k];
    const fm = /^F(\d+)$/i.exec(k);
    if (fm) return [1, parseInt(fm[1], 10), k];
    const om = /^O(\d+)$/i.exec(k);
    if (om) return [2, parseInt(om[1], 10), k];
    return [3, 0, k];
  };
  const [ta, na, sa] = tier(a.key);
  const [tb, nb, sb] = tier(b.key);
  if (ta !== tb) return ta - tb;
  if (ta === 3) return sa.localeCompare(sb, "en");
  if (na !== nb) return na - nb;
  return sa.localeCompare(sb, "en");
}

/** Store Type KPI 표 정렬: FP → FO → 기타(가나다) → 미정 */
function compareStoreTypeKpi(a: { key: string }, b: { key: string }): number {
  const rank = (k: string): number => {
    if (k === "미정") return 3;
    const t = k.trim().toUpperCase();
    if (t === "FP") return 0;
    if (t === "FO") return 1;
    return 2;
  };
  const ra = rank(a.key);
  const rb = rank(b.key);
  if (ra !== rb) return ra - rb;
  return a.key.localeCompare(b.key, "ko");
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
  retail2025Map?: Record<string, Record<number, number>> | null;
}

function StoreModal({
  dealer,
  brand,
  selectedMonth,
  storeRetailMap,
  storeDirectCostMap,
  cogsRate,
  onClose,
  retail2025Map,
}: StoreModalProps) {
  const [selectedStoreCode, setSelectedStoreCode] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<OpenGroups>(DEFAULT_OPEN_GROUPS);
  const [storeTableSortKey, setStoreTableSortKey] = useState<StoreTableSortKey>("retail");
  const [storeTableSortDir, setStoreTableSortDir] = useState<"asc" | "desc">("desc");
  const toggleGroup = (key: keyof OpenGroups) =>
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  const onStoreTableSort = useCallback((key: StoreTableSortKey) => {
    if (key === storeTableSortKey) {
      setStoreTableSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setStoreTableSortKey(key);
      setStoreTableSortDir(key === "name" ? "asc" : "desc");
    }
  }, [storeTableSortKey]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    setSelectedStoreCode(null);
    setStoreTableSortKey("retail");
    setStoreTableSortDir("desc");
  }, [dealer.accountId]);

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
        const cogs = (tag * cogsRate) / PL_CALC.retailVatFactor;
        const grossProfit = retail / PL_CALC.retailVatFactor - cogs;

        let salary = 0,
          bonus = 0,
          headcount = 0,
          insurance = 0,
          rent = 0,
          rentFixed = 0,
          rentVariable = 0,
          depr = 0,
          marketing = 0,
          packaging = 0,
          payFee = 0,
          othersLine = 0;

        if (dc) {
          headcount = dc.headcount;
          if (selectedMonth === "annual") {
            for (const m of MONTHS) {
              const curYM = ym(m);
              const retailM = s.months[m] ?? 0;
              const salM = dc.avgSalary * dc.headcount;
              const bonusM = retailM * dc.bonusRate;
              const insM = (salM + bonusM) * dc.insuranceRate;
              const deprM = calcDeprForMonthStoreModal(
                dc.interiorCost,
                dc.openMonth,
                dc.amortEndMonth,
                dc.closedMonth,
                curYM,
              );
              const rf = rentFixedMonth(dc);
              const rv = rentVariableMonth(retailM, dc);
              const oc = calcOtherCostsMonth(retailM);
              salary += salM;
              bonus += bonusM;
              insurance += insM;
              rent += rf + rv;
              rentFixed += rf;
              rentVariable += rv;
              depr += deprM;
              marketing += oc.marketing;
              packaging += oc.packaging;
              payFee += oc.payFee;
              othersLine += oc.othersLine;
            }
          } else {
            const m = selectedMonth as number;
            const curYM = ym(m);
            const retailM = s.months[m] ?? 0;
            salary = dc.avgSalary * dc.headcount;
            bonus = retailM * dc.bonusRate;
            insurance = (salary + bonus) * dc.insuranceRate;
            const rf = rentFixedMonth(dc);
            const rv = rentVariableMonth(retailM, dc);
            rent = rf + rv;
            rentFixed = rf;
            rentVariable = rv;
            depr = calcDeprForMonthStoreModal(
              dc.interiorCost,
              dc.openMonth,
              dc.amortEndMonth,
              dc.closedMonth,
              curYM,
            );
            const oc = calcOtherCostsMonth(retailM);
            marketing = oc.marketing;
            packaging = oc.packaging;
            payFee = oc.payFee;
            othersLine = oc.othersLine;
          }
        }
        const directCost = salary + bonus + insurance + rent + depr + marketing + packaging + payFee + othersLine;
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
          rentFixed,
          rentVariable,
          depr,
          directCost,
          operatingProfit,
          marketing,
          packaging,
          payFee,
          othersLine,
        };
      });
  }, [stores, selectedMonth, cogsRate, storeDirectCostMap]);

  const sortedModalStoreRows = useMemo(() => {
    const rows = storeRows.filter((r) => r.retail > 0);
    const m = storeTableSortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (storeTableSortKey === "name") return m * a.storeName.localeCompare(b.storeName, "ko");
      if (storeTableSortKey === "retail") return m * (a.retail - b.retail);
      return m * (a.grossProfit - b.grossProfit);
    });
  }, [storeRows, storeTableSortKey, storeTableSortDir]);

  type GroupKpiRow = {
    key: string;
    count: number;
    perRetail: number;
    perGrossProfit: number;
    perDirectCost: number;
    perOperatingProfit: number;
  };

  function buildGroupKpi(
    retailStores: StoreRetailRow[],
    rows: StorePL[],
    month: MonthOption,
    dcMap: StoreDirectCostMap,
    keyFn: (dc: StoreDirectCost | undefined) => string,
    rowSort?: (a: GroupKpiRow, b: GroupKpiRow) => number,
  ): GroupKpiRow[] {
    const activeRetailStores = retailStores.filter(
      (s) => MONTHS.reduce((sum, m) => sum + (s.months[m] ?? 0), 0) > 0,
    );

    const agg = new Map<string, { retail: number; grossProfit: number; directCost: number; operatingProfit: number }>();
    for (const row of rows.filter((r) => r.retail > 0)) {
      const key = keyFn(dcMap[row.storeCode]) || "미정";
      const cur = agg.get(key) ?? { retail: 0, grossProfit: 0, directCost: 0, operatingProfit: 0 };
      agg.set(key, {
        retail: cur.retail + row.retail,
        grossProfit: cur.grossProfit + row.grossProfit,
        directCost: cur.directCost + row.directCost,
        operatingProfit: cur.operatingProfit + row.operatingProfit,
      });
    }

    const denomByKey = new Map<string, number>();
    if (month === "annual") {
      for (const m of MONTHS) {
        for (const s of activeRetailStores) {
          if ((s.months[m] ?? 0) <= 0) continue;
          const key = keyFn(dcMap[s.storeCode]) || "미정";
          denomByKey.set(key, (denomByKey.get(key) ?? 0) + 1);
        }
      }
    } else {
      for (const row of rows.filter((r) => r.retail > 0)) {
        const key = keyFn(dcMap[row.storeCode]) || "미정";
        denomByKey.set(key, (denomByKey.get(key) ?? 0) + 1);
      }
    }

    return Array.from(agg.entries())
      .map(([key, v]) => {
        const d = denomByKey.get(key) ?? 0;
        return {
          key,
          count: d,
          perRetail: d > 0 ? v.retail / d : 0,
          perGrossProfit: d > 0 ? v.grossProfit / d : 0,
          perDirectCost: d > 0 ? v.directCost / d : 0,
          perOperatingProfit: d > 0 ? v.operatingProfit / d : 0,
        };
      })
      .sort(
        rowSort ??
          ((a, b) => {
            if (a.key === "미정") return 1;
            if (b.key === "미정") return -1;
            return b.perRetail - a.perRetail;
          }),
      );
  }

  const storeTypeKpi = useMemo(
    () =>
      buildGroupKpi(
        stores,
        storeRows,
        selectedMonth,
        storeDirectCostMap,
        (dc) => dc?.storeType?.trim() || "미정",
        compareStoreTypeKpi,
      ),
    [stores, storeRows, selectedMonth, storeDirectCostMap],
  );

  const tradeZoneKpi = useMemo(
    () =>
      buildGroupKpi(
        stores,
        storeRows,
        selectedMonth,
        storeDirectCostMap,
        (dc) => dc?.tradeZone?.trim() || "미정",
        compareTradeZoneKpi,
      ),
    [stores, storeRows, selectedMonth, storeDirectCostMap],
  );

  const regionNmKpi = useMemo(
    () =>
      buildGroupKpi(stores, storeRows, selectedMonth, storeDirectCostMap, (dc) => dc?.regionNm?.trim() || "미정"),
    [stores, storeRows, selectedMonth, storeDirectCostMap],
  );

  /** region_nm별 city_nm 매장 수 상위 5개 — 참고 문구용 */
  const REGION_NOTE_TOP_CITIES = 5;
  const regionNmCityNoteSegments = useMemo(() => {
    const byRegion = new Map<string, Map<string, number>>();
    for (const s of stores) {
      const dc = storeDirectCostMap[s.storeCode];
      if (!dc) continue;
      const r = dc.regionNm?.trim() || "미정";
      const c = dc.cityNm?.trim();
      if (!c) continue;
      if (!byRegion.has(r)) byRegion.set(r, new Map());
      const m = byRegion.get(r)!;
      m.set(c, (m.get(c) ?? 0) + 1);
    }
    const segments: string[] = [];
    const seen = new Set<string>();
    for (const g of regionNmKpi) {
      const r = g.key;
      if (seen.has(r)) continue;
      seen.add(r);
      const m = byRegion.get(r);
      if (!m || m.size === 0) continue;
      const top = [...m.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))
        .slice(0, REGION_NOTE_TOP_CITIES)
        .map(([city]) => city);
      if (top.length > 0) segments.push(`${r}: ${top.join(", ")}`);
    }
    return segments;
  }, [stores, storeDirectCostMap, regionNmKpi]);

  const storeTotals = useMemo(
    () => ({
      retail: storeRows.reduce((s, r) => s + r.retail, 0),
      tag: storeRows.reduce((s, r) => s + r.tag, 0),
      cogs: storeRows.reduce((s, r) => s + r.cogs, 0),
      grossProfit: storeRows.reduce((s, r) => s + r.grossProfit, 0),
      salary: storeRows.reduce((s, r) => s + r.salary, 0),
      bonus: storeRows.reduce((s, r) => s + r.bonus, 0),
      headcount: storeRows.reduce((s, r) => s + r.headcount, 0),
      insurance: storeRows.reduce((s, r) => s + r.insurance, 0),
      rent: storeRows.reduce((s, r) => s + r.rent, 0),
      rentFixed: storeRows.reduce((s, r) => s + r.rentFixed, 0),
      rentVariable: storeRows.reduce((s, r) => s + r.rentVariable, 0),
      depr: storeRows.reduce((s, r) => s + r.depr, 0),
      directCost: storeRows.reduce((s, r) => s + r.directCost, 0),
      operatingProfit: storeRows.reduce((s, r) => s + r.operatingProfit, 0),
      marketing: storeRows.reduce((s, r) => s + r.marketing, 0),
      packaging: storeRows.reduce((s, r) => s + r.packaging, 0),
      payFee: storeRows.reduce((s, r) => s + r.payFee, 0),
      othersLine: storeRows.reduce((s, r) => s + r.othersLine, 0),
    }),
    [storeRows],
  );

  useEffect(() => {
    if (selectedStoreCode && !storeRows.some((r) => r.storeCode === selectedStoreCode)) {
      setSelectedStoreCode(null);
    }
  }, [storeRows, selectedStoreCode]);

  const selectedRow = selectedStoreCode ? storeRows.find((r) => r.storeCode === selectedStoreCode) : undefined;
  const selectedDc = selectedStoreCode ? storeDirectCostMap[selectedStoreCode] : undefined;

  const monthLabel = selectedMonth === "annual" ? "26년 합계" : `26.${String(selectedMonth).padStart(2, "0")}`;

  /** 월: 당월 리테일 > 0 매장 수. 연간: Store Type별 매장수(계산용) 합 ÷ 12(월평균 슬롯). */
  const headerStoreCount =
    selectedMonth === "annual"
      ? Math.round(storeTypeKpi.reduce((s, g) => s + g.count, 0) / 12)
      : storeRows.filter((r) => r.retail > 0).length;

  const kpiOpenMonth = selectedDc ? fmtOpenMonth(selectedDc.openMonth) : "—";
  const kpiArea =
    selectedDc && selectedDc.storeAreaM2 > 0 ? `${selectedDc.storeAreaM2.toLocaleString("ko-KR")} m²` : "—";
  const kpiAvgLabor =
    selectedRow && selectedRow.headcount > 0
      ? (
          avgLaborPerHeadForDisplay(
            selectedRow.salary,
            selectedRow.bonus,
            selectedRow.headcount,
            selectedMonth,
          ) / 1000
        ).toFixed(2)
      : "";
  const kpiPerM2 =
    selectedRow && selectedDc && selectedDc.storeAreaM2 > 0
      ? ((selectedRow.retail / 1000) / selectedDc.storeAreaM2).toFixed(2)
      : "";
  const kpiPerHead =
    selectedRow && selectedRow.headcount > 0
      ? ((selectedRow.retail / selectedRow.headcount) / 1000).toFixed(2)
      : "";

  const retail2025 = selectedRow && retail2025Map
    ? selectedMonth === "annual"
      ? MONTHS.reduce((s, m) => s + (retail2025Map[selectedRow.storeCode]?.[m] ?? 0), 0)
      : (retail2025Map[selectedRow.storeCode]?.[selectedMonth as number] ?? 0)
    : 0;
  const yoy = retail2025 > 0 && selectedRow
    ? (selectedRow.retail - retail2025) / retail2025
    : null;
  const yoyPct = retail2025 > 0 && selectedRow
    ? (selectedRow.retail / retail2025) * 100
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-[95vw] max-w-[2366px] max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-slate-400">({dealer.accountId})</span>
            {dealer.accountNameKr && <span className="text-sm font-bold text-slate-800">{dealer.accountNameKr}</span>}
            {dealer.accountNameKr && dealer.accountNameEn && <span className="text-slate-300 text-sm">|</span>}
            {dealer.accountNameEn && <span className="text-sm font-semibold text-slate-500">{dealer.accountNameEn}</span>}
            <span className="ml-2 rounded-md bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
              {brand} · {monthLabel}
            </span>
            <span className="ml-1 rounded-md bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
              매장 {headerStoreCount}개
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
            aria-label="닫기"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 상단 KPI: 항상 표시 — Store Type / Trade Zone / region_nm 점당 지표 */}
        <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex gap-3 overflow-x-auto min-w-0">
            {/* 카드1: Store Type별 */}
            <div className="min-w-[260px] flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="mb-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Store Type별 점당 지표</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-slate-400 border-b border-slate-100">
                    <th className="pb-1 text-left font-medium">구분</th>
                    <th className="pb-1 text-right font-medium">점당매출</th>
                    <th className="pb-1 text-right font-medium">점당매출이익</th>
                    <th className="pb-1 text-right font-medium">이익%</th>
                    <th className="pb-1 text-right font-medium">점당직접비</th>
                    <th className="pb-1 text-right font-medium">직접비%</th>
                    <th className="pb-1 text-right font-medium">점당영업이익</th>
                    <th className="pb-1 text-right font-medium">영업%</th>
                    {selectedMonth === "annual" && (
                      <th className="pb-1 text-right font-medium">매장수</th>
                    )}
                    <th className="pb-1 text-right font-medium">
                      {selectedMonth === "annual" ? "매장수(계산용)" : "매장수"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {storeTypeKpi.map((g) => (
                    <tr key={g.key} className="border-b border-slate-50 last:border-0">
                      <td className="py-1 text-left font-semibold text-slate-700">{g.key}</td>
                      <td className="py-1 text-right tabular-nums text-slate-700">{Math.round(g.perRetail).toLocaleString()}</td>
                      <td className="py-1 text-right tabular-nums text-slate-600">{Math.round(g.perGrossProfit).toLocaleString()}</td>
                      <td className="py-1 text-right tabular-nums text-slate-500 text-[10px]">
                        {fmtPerPointVatRate(g.perGrossProfit, g.perRetail)}
                      </td>
                      <td className="py-1 text-right tabular-nums text-slate-600">{Math.round(g.perDirectCost).toLocaleString()}</td>
                      <td className="py-1 text-right tabular-nums text-slate-500 text-[10px]">
                        {fmtPerPointVatRate(g.perDirectCost, g.perRetail)}
                      </td>
                      <td className={`py-1 text-right tabular-nums ${g.perOperatingProfit >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {Math.round(g.perOperatingProfit).toLocaleString()}
                      </td>
                      <td
                        className={`py-1 text-right tabular-nums text-[10px] ${
                          g.perRetail <= 0
                            ? "text-slate-400"
                            : g.perOperatingProfit >= 0
                              ? "text-emerald-600"
                              : "text-red-500"
                        }`}
                      >
                        {fmtPerPointVatRate(g.perOperatingProfit, g.perRetail)}
                      </td>
                      {selectedMonth === "annual" && (
                        <td className="py-1 text-right text-slate-500 tabular-nums">
                          {Math.round(g.count / 12)}개
                        </td>
                      )}
                      <td className="py-1 text-right text-slate-400">{g.count}개</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* 카드2: Trade Zone별 */}
            <div className="min-w-[260px] flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="mb-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Trade Zone별 점당 지표</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-slate-400 border-b border-slate-100">
                    <th className="pb-1 text-left font-medium">구분</th>
                    <th className="pb-1 text-right font-medium">점당매출</th>
                    <th className="pb-1 text-right font-medium">점당매출이익</th>
                    <th className="pb-1 text-right font-medium">이익%</th>
                    <th className="pb-1 text-right font-medium">점당직접비</th>
                    <th className="pb-1 text-right font-medium">직접비%</th>
                    <th className="pb-1 text-right font-medium">점당영업이익</th>
                    <th className="pb-1 text-right font-medium">영업%</th>
                    {selectedMonth === "annual" && (
                      <th className="pb-1 text-right font-medium">매장수</th>
                    )}
                    <th className="pb-1 text-right font-medium">
                      {selectedMonth === "annual" ? "매장수(계산용)" : "매장수"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tradeZoneKpi.map((g) => (
                    <tr key={g.key} className="border-b border-slate-50 last:border-0">
                      <td className="py-1 text-left font-semibold text-slate-700">{g.key}</td>
                      <td className="py-1 text-right tabular-nums text-slate-700">{Math.round(g.perRetail).toLocaleString()}</td>
                      <td className="py-1 text-right tabular-nums text-slate-600">{Math.round(g.perGrossProfit).toLocaleString()}</td>
                      <td className="py-1 text-right tabular-nums text-slate-500 text-[10px]">
                        {fmtPerPointVatRate(g.perGrossProfit, g.perRetail)}
                      </td>
                      <td className="py-1 text-right tabular-nums text-slate-600">{Math.round(g.perDirectCost).toLocaleString()}</td>
                      <td className="py-1 text-right tabular-nums text-slate-500 text-[10px]">
                        {fmtPerPointVatRate(g.perDirectCost, g.perRetail)}
                      </td>
                      <td className={`py-1 text-right tabular-nums ${g.perOperatingProfit >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {Math.round(g.perOperatingProfit).toLocaleString()}
                      </td>
                      <td
                        className={`py-1 text-right tabular-nums text-[10px] ${
                          g.perRetail <= 0
                            ? "text-slate-400"
                            : g.perOperatingProfit >= 0
                              ? "text-emerald-600"
                              : "text-red-500"
                        }`}
                      >
                        {fmtPerPointVatRate(g.perOperatingProfit, g.perRetail)}
                      </td>
                      {selectedMonth === "annual" && (
                        <td className="py-1 text-right text-slate-500 tabular-nums">
                          {Math.round(g.count / 12)}개
                        </td>
                      )}
                      <td className="py-1 text-right text-slate-400">{g.count}개</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* 카드3: region_nm별 */}
            <div className="min-w-[260px] flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="mb-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">region_nm별 점당 지표</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-slate-400 border-b border-slate-100">
                    <th className="pb-1 text-left font-medium">구분</th>
                    <th className="pb-1 text-right font-medium">점당매출</th>
                    <th className="pb-1 text-right font-medium">점당매출이익</th>
                    <th className="pb-1 text-right font-medium">이익%</th>
                    <th className="pb-1 text-right font-medium">점당직접비</th>
                    <th className="pb-1 text-right font-medium">직접비%</th>
                    <th className="pb-1 text-right font-medium">점당영업이익</th>
                    <th className="pb-1 text-right font-medium">영업%</th>
                    {selectedMonth === "annual" && (
                      <th className="pb-1 text-right font-medium">매장수</th>
                    )}
                    <th className="pb-1 text-right font-medium">
                      {selectedMonth === "annual" ? "매장수(계산용)" : "매장수"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {regionNmKpi.map((g) => (
                    <tr key={g.key} className="border-b border-slate-50 last:border-0">
                      <td className="py-1 text-left font-semibold text-slate-700">{g.key}</td>
                      <td className="py-1 text-right tabular-nums text-slate-700">{Math.round(g.perRetail).toLocaleString()}</td>
                      <td className="py-1 text-right tabular-nums text-slate-600">{Math.round(g.perGrossProfit).toLocaleString()}</td>
                      <td className="py-1 text-right tabular-nums text-slate-500 text-[10px]">
                        {fmtPerPointVatRate(g.perGrossProfit, g.perRetail)}
                      </td>
                      <td className="py-1 text-right tabular-nums text-slate-600">{Math.round(g.perDirectCost).toLocaleString()}</td>
                      <td className="py-1 text-right tabular-nums text-slate-500 text-[10px]">
                        {fmtPerPointVatRate(g.perDirectCost, g.perRetail)}
                      </td>
                      <td className={`py-1 text-right tabular-nums ${g.perOperatingProfit >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {Math.round(g.perOperatingProfit).toLocaleString()}
                      </td>
                      <td
                        className={`py-1 text-right tabular-nums text-[10px] ${
                          g.perRetail <= 0
                            ? "text-slate-400"
                            : g.perOperatingProfit >= 0
                              ? "text-emerald-600"
                              : "text-red-500"
                        }`}
                      >
                        {fmtPerPointVatRate(g.perOperatingProfit, g.perRetail)}
                      </td>
                      {selectedMonth === "annual" && (
                        <td className="py-1 text-right text-slate-500 tabular-nums">
                          {Math.round(g.count / 12)}개
                        </td>
                      )}
                      <td className="py-1 text-right text-slate-400">{g.count}개</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {regionNmCityNoteSegments.length > 0 ? (
                <p className="mt-2.5 border-t border-slate-100 pt-2 text-[10px] leading-relaxed text-slate-500">
                  <span className="font-semibold text-slate-600">참고(예시):</span>{" "}
                  <span className="text-slate-600">
                    {regionNmCityNoteSegments.join(" · ")}
                  </span>
                  <span className="text-slate-400">
                    {" "}
                    (해당 대리상 매장 기준, city_nm 매장 수 상위 {REGION_NOTE_TOP_CITIES}개)
                  </span>
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {/* 하단 KPI: 매장 선택 시만 표시 */}
        {selectedRow && (
          <div className="shrink-0 border-b border-slate-100 bg-[linear-gradient(180deg,#f8fafd_0%,#ffffff_100%)] px-4 py-3">
            <div className="flex flex-wrap gap-2 overflow-x-auto pb-1">
              <StoreKpiCard label="Store Type" value={selectedDc?.storeType?.trim() || "—"} />
              <StoreKpiCard label="Trade Zone" value={selectedDc?.tradeZone?.trim() || "—"} />
              <StoreKpiCard label="오픈월" value={kpiOpenMonth} />
              <StoreKpiCard label="매장면적" value={kpiArea} />
              <StoreKpiCard
                label="인당급여"
                value={kpiAvgLabor ? `${kpiAvgLabor}K (${selectedRow.headcount}명)` : "—"}
              />
              <StoreKpiCard label="평당매출" value={kpiPerM2 ? `${kpiPerM2} K/㎡` : "—"} />
              <StoreKpiCard label="인당매출" value={kpiPerHead ? `${kpiPerHead} K/인` : "—"} />
              <StoreKpiCard
                label="리테일매출"
                value={
                  yoyPct !== null ? (
                    <span className="whitespace-nowrap">
                      {fmt(selectedRow.retail)}K{" "}
                      <span className="text-[11px] font-medium text-slate-500">
                        (전년 {fmt(retail2025)}K,{" "}
                        <span className={yoyPct >= 100 ? "text-emerald-600" : "text-red-500"}>
                          {yoyPct.toFixed(1)}%
                        </span>
                        )
                      </span>
                    </span>
                  ) : (
                    `${fmt(selectedRow.retail)}K`
                  )
                }
              />
              <StoreKpiCard
                label="영업이익률"
                value={
                  selectedRow.retail > 0
                    ? fmtRate((selectedRow.operatingProfit * PL_CALC.retailVatFactor) / selectedRow.retail)
                    : "—"
                }
              />
            </div>
          </div>
        )}

        <div className="overflow-auto flex-1">
          <table className="min-w-full text-right text-xs">
            <PLTableHead
              firstColLabel="매장코드 · 매장명"
              variant="store"
              openGroups={openGroups}
              onToggle={toggleGroup}
              storeColumnSort={{
                sortKey: storeTableSortKey,
                sortDir: storeTableSortDir,
                onSort: onStoreTableSort,
              }}
            />
            {storeRows.length > 0 && (
              <tfoot className="sticky bottom-0 z-20">
                <TotalRow totals={storeTotals} variant="store" selectedMonth={selectedMonth} openGroups={openGroups} />
              </tfoot>
            )}
            <tbody className="divide-y divide-slate-100">
              {sortedModalStoreRows.map((row, i) => {
                const isSel = row.storeCode === selectedStoreCode;
                const gmr = plGrossMarginRate(row.retail, row.grossProfit);
                return (
                  <tr
                    key={row.storeCode}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedStoreCode((prev) => (prev === row.storeCode ? null : row.storeCode));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedStoreCode((prev) => (prev === row.storeCode ? null : row.storeCode));
                      }
                    }}
                    className={`cursor-pointer transition-colors ${
                      isSel
                        ? "bg-sky-50 ring-1 ring-inset ring-sky-300"
                        : i % 2 === 0
                          ? "bg-white hover:bg-slate-50/80"
                          : "bg-slate-50/50 hover:bg-slate-100/80"
                    }`}
                  >
                    <td className="sticky left-0 z-10 bg-inherit px-3 py-2 text-left whitespace-nowrap">
                      <span className="text-[10px] text-slate-400 mr-1.5">({row.storeCode})</span>
                      <span className="text-slate-700 font-medium">{row.storeName}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-600 text-center whitespace-nowrap border-l border-slate-100">
                      {storeDirectCostMap[row.storeCode]?.storeType?.trim() || "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-600 text-center whitespace-nowrap">
                      {storeDirectCostMap[row.storeCode]?.tradeZone?.trim() || "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-700 border-l border-slate-100">{fmt(row.tag)}</td>
                    <td className="px-3 py-2 text-slate-700">{fmt(row.retail)}</td>
                    <td className="px-3 py-2 text-slate-500 border-l border-slate-100">{fmtRate(row.cogsRate)}</td>
                    <td className="px-3 py-2 text-slate-700">{fmt(row.cogs)}</td>
                    <td className="px-3 py-2 text-slate-700 border-l border-slate-100">{fmt(row.grossProfit)}</td>
                    <td className={`px-3 py-2 ${gmr === null ? "text-slate-300" : "text-slate-700"}`}>
                      {gmr === null ? "—" : fmtRate(gmr)}
                    </td>
                    <DirectCostCells
                      variant="store"
                      selectedMonth={selectedMonth}
                      openGroups={openGroups}
                      retail={row.retail}
                      salary={row.salary}
                      bonus={row.bonus}
                      headcount={row.headcount}
                      insurance={row.insurance}
                      rent={row.rent}
                      rentFixed={row.rentFixed}
                      rentVariable={row.rentVariable}
                      depr={row.depr}
                      directCost={row.directCost}
                      marketing={row.marketing}
                      packaging={row.packaging}
                      payFee={row.payFee}
                      othersLine={row.othersLine}
                    />
                    <td
                      className={`px-3 py-2 font-semibold border-l border-slate-300 ${
                        row.operatingProfit >= 0 ? "text-blue-700" : "text-red-600"
                      }`}
                    >
                      {fmt(row.operatingProfit)}
                    </td>
                    <td
                      className={`px-3 py-2 font-semibold ${
                        row.operatingProfit >= 0 ? "text-blue-700" : "text-red-600"
                      }`}
                    >
                      {row.retail > 0
                      ? fmtRate((row.operatingProfit * PL_CALC.retailVatFactor) / row.retail)
                      : "—"}
                    </td>
                  </tr>
                );
              })}
              {storeRows.length === 0 && (
                <tr>
                  <td colSpan={1 + DATA_COLS_STORE} className="py-10 text-center text-slate-400 text-sm">
                    매장 데이터가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
  retailYoy2025Map = null,
}: Props) {
  const [selectedMonth, setSelectedMonth] = useState<MonthOption>("annual");
  const [selectedBrand, setSelectedBrand] = useState<string>("");
  const [modalDealer, setModalDealer] = useState<DealerPL | null>(null);
  const [calcLogicOpen, setCalcLogicOpen] = useState(false);
  const [dealerOpenGroups, setDealerOpenGroups] = useState<OpenGroups>(DEFAULT_OPEN_GROUPS);
  const toggleDealerGroup = useCallback(
    (key: keyof OpenGroups) => setDealerOpenGroups((prev) => ({ ...prev, [key]: !prev[key] })),
    [],
  );

  const closeModal = useCallback(() => setModalDealer(null), []);

  const brands = useMemo(() => {
    return BRAND_ORDER.filter((b) => Object.keys(storeRetailMap[b] ?? {}).length > 0);
  }, [storeRetailMap]);

  const activeBrand = selectedBrand || brands[0] || "";

  const plMonthLabel =
    selectedMonth === "annual" ? "26년 합계" : `26.${String(selectedMonth).padStart(2, "0")}`;

  const plLegendCtx = useMemo(
    (): PlKpiLegendCtx => ({
      selectedMonth,
      monthLabel: plMonthLabel,
      hasDc: false,
      commissionRate: 0,
      cogsRate: 0,
      discountRate: 0,
    }),
    [selectedMonth, plMonthLabel],
  );

  const rows = useMemo((): DealerPL[] => {
    const brandStores = storeRetailMap[activeBrand] ?? {};
    const brandCogsMap = cogsRateMap[activeBrand] ?? {};
    const globalAvg = cogsRateMap["평균"]?.["평균"] ?? 0.441;

    return Object.entries(brandStores)
      .sort(([a], [b]) => a.localeCompare(b))
      .filter(([, st]) => {
        const annualTotal = st.reduce(
          (sum, s) => sum + MONTHS.reduce((ms, m) => ms + (s.months[m] ?? 0), 0),
          0,
        );
        return annualTotal > 0;
      })
      .map(([accountId, st]) => {
        const retail = st.reduce((sum, s) => {
          const v =
            selectedMonth === "annual"
              ? MONTHS.reduce((ms, m) => ms + (s.months[m] ?? 0), 0)
              : (s.months[selectedMonth as number] ?? 0);
          return sum + v;
        }, 0);

        const tag = st.reduce((sum, s) => {
          const sr =
            selectedMonth === "annual"
              ? MONTHS.reduce((ms, m) => ms + (s.months[m] ?? 0), 0)
              : (s.months[selectedMonth as number] ?? 0);
          return sum + calcTag(sr, s.discountRate);
        }, 0);

        const cogsRate = brandCogsMap[accountId] ?? globalAvg;
        const cogs = (tag * cogsRate) / PL_CALC.retailVatFactor;
        const grossProfit = retail / PL_CALC.retailVatFactor - cogs;

        let salary = 0,
          bonus = 0,
          headcount = 0,
          insurance = 0,
          rent = 0,
          depr = 0,
          marketing = 0,
          packaging = 0,
          payFee = 0,
          othersLine = 0;
        for (const s of st) {
          const dc = storeDirectCostMap[s.storeCode];
          if (!dc) continue;
          headcount += dc.headcount;
          if (selectedMonth === "annual") {
            for (const m of MONTHS) {
              const curYM = ym(m);
              const retailM = s.months[m] ?? 0;
              const salM = dc.avgSalary * dc.headcount;
              const bonusM = retailM * dc.bonusRate;
              const insM = (salM + bonusM) * dc.insuranceRate;
              const deprM = calcDeprForMonth(
                dc.interiorCost,
                dc.openMonth,
                dc.amortEndMonth,
                dc.closedMonth,
                curYM,
              );
              const oc = calcOtherCostsMonth(retailM);
              salary += salM;
              bonus += bonusM;
              insurance += insM;
              rent += rentTotalMonth(retailM, dc);
              depr += deprM;
              marketing += oc.marketing;
              packaging += oc.packaging;
              payFee += oc.payFee;
              othersLine += oc.othersLine;
            }
          } else {
            const m = selectedMonth as number;
            const curYM = ym(m);
            const retailM = s.months[m] ?? 0;
            const salM = dc.avgSalary * dc.headcount;
            const bonusM = retailM * dc.bonusRate;
            const oc = calcOtherCostsMonth(retailM);
            salary += salM;
            bonus += bonusM;
            insurance += (salM + bonusM) * dc.insuranceRate;
            rent += rentTotalMonth(retailM, dc);
            depr += calcDeprForMonth(
              dc.interiorCost,
              dc.openMonth,
              dc.amortEndMonth,
              dc.closedMonth,
              curYM,
            );
            marketing += oc.marketing;
            packaging += oc.packaging;
            payFee += oc.payFee;
            othersLine += oc.othersLine;
          }
        }
        const directCost = salary + bonus + insurance + rent + depr + marketing + packaging + payFee + othersLine;

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
          marketing,
          packaging,
          payFee,
          othersLine,
          directCost,
          operatingProfit: grossProfit - directCost,
        };
      });
  }, [storeRetailMap, activeBrand, selectedMonth, cogsRateMap, accountNameMap, storeDirectCostMap]);

  const totals = useMemo(
    () => ({
      retail: rows.reduce((s, r) => s + r.retail, 0),
      tag: rows.reduce((s, r) => s + r.tag, 0),
      cogs: rows.reduce((s, r) => s + r.cogs, 0),
      grossProfit: rows.reduce((s, r) => s + r.grossProfit, 0),
      salary: rows.reduce((s, r) => s + r.salary, 0),
      bonus: rows.reduce((s, r) => s + r.bonus, 0),
      headcount: rows.reduce((s, r) => s + r.headcount, 0),
      insurance: rows.reduce((s, r) => s + r.insurance, 0),
      rent: rows.reduce((s, r) => s + r.rent, 0),
      depr: rows.reduce((s, r) => s + r.depr, 0),
      directCost: rows.reduce((s, r) => s + r.directCost, 0),
      operatingProfit: rows.reduce((s, r) => s + r.operatingProfit, 0),
      marketing: rows.reduce((s, r) => s + r.marketing, 0),
      packaging: rows.reduce((s, r) => s + r.packaging, 0),
      payFee: rows.reduce((s, r) => s + r.payFee, 0),
      othersLine: rows.reduce((s, r) => s + r.othersLine, 0),
    }),
    [rows],
  );

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-sm font-bold text-slate-700">대리상별 손익계산서</h2>
            <div className="flex gap-1 rounded-xl bg-stone-100 p-1">
              {brands.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setSelectedBrand(b)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                    activeBrand === b ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setCalcLogicOpen(true)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-50 hover:border-slate-300 transition-colors"
            >
              계산로직
            </button>
          </div>
          <select
            value={selectedMonth === "annual" ? "annual" : String(selectedMonth)}
            onChange={(e) =>
              setSelectedMonth(e.target.value === "annual" ? "annual" : Number(e.target.value))
            }
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            {DROPDOWN_OPTIONS.map((o) => (
              <option key={String(o.value)} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-right text-xs">
            <PLTableHead firstColLabel="대리상명" variant="dealer" openGroups={dealerOpenGroups} onToggle={toggleDealerGroup} />
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, i) => {
                const gmr = plGrossMarginRate(row.retail, row.grossProfit);
                return (
                  <tr
                    key={row.accountId}
                    role="button"
                    tabIndex={0}
                    onClick={() => setModalDealer(row)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setModalDealer(row);
                      }
                    }}
                    className={`cursor-pointer transition-colors ${
                      i % 2 === 0 ? "bg-white hover:bg-blue-50/60" : "bg-slate-50/50 hover:bg-blue-50/60"
                    }`}
                  >
                    <td className="sticky left-0 z-10 bg-inherit px-3 py-2 text-left whitespace-nowrap">
                      <span className="text-slate-400 mr-1 text-[10px]">({row.accountId})</span>
                      {row.accountNameKr && <span className="text-slate-700 font-medium">{row.accountNameKr}</span>}
                      {row.accountNameKr && row.accountNameEn && <span className="text-slate-300 mx-1">|</span>}
                      {row.accountNameEn && <span className="text-slate-500">{row.accountNameEn}</span>}
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
                    <td className={`px-3 py-2 ${gmr === null ? "text-slate-300" : "text-slate-700"}`}>
                      {gmr === null ? "—" : fmtRate(gmr)}
                    </td>
                    <DirectCostCells
                      variant="dealer"
                      selectedMonth={selectedMonth}
                      openGroups={dealerOpenGroups}
                      retail={row.retail}
                      salary={row.salary}
                      bonus={row.bonus}
                      headcount={row.headcount}
                      insurance={row.insurance}
                      rent={row.rent}
                      depr={row.depr}
                      directCost={row.directCost}
                      marketing={row.marketing}
                      packaging={row.packaging}
                      payFee={row.payFee}
                      othersLine={row.othersLine}
                    />
                    <td
                      className={`px-3 py-2 font-semibold border-l border-slate-300 ${
                        row.operatingProfit >= 0 ? "text-blue-700" : "text-red-600"
                      }`}
                    >
                      {fmt(row.operatingProfit)}
                    </td>
                    <td
                      className={`px-3 py-2 font-semibold ${
                        row.operatingProfit >= 0 ? "text-blue-700" : "text-red-600"
                      }`}
                    >
                      {row.retail > 0
                      ? fmtRate((row.operatingProfit * PL_CALC.retailVatFactor) / row.retail)
                      : "—"}
                    </td>
                  </tr>
                );
              })}
              {rows.length > 0 && (
                <TotalRow totals={totals} variant="dealer" selectedMonth={selectedMonth} openGroups={dealerOpenGroups} />
              )}
            </tbody>
          </table>

          {rows.length === 0 && (
            <div className="flex items-center justify-center h-40 text-slate-400 text-sm">데이터가 없습니다.</div>
          )}
        </div>

        <p className="text-right text-[11px] text-slate-400">
          단위: 천위안(千元) · 기타(마케팅/포장/지급수수료) 항목은 추후 추가 · 대리상 행 클릭 시 매장별 상세 조회
        </p>
      </div>

      {modalDealer && (
        <StoreModal
          dealer={modalDealer}
          brand={activeBrand}
          selectedMonth={selectedMonth}
          storeRetailMap={storeRetailMap}
          storeDirectCostMap={storeDirectCostMap}
          cogsRate={modalDealer.cogsRate}
          onClose={closeModal}
          retail2025Map={retailYoy2025Map}
        />
      )}

      <PlCalcLogicModal open={calcLogicOpen} onClose={() => setCalcLogicOpen(false)} ctx={plLegendCtx} />
    </>
  );
}
