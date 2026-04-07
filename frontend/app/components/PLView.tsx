"use client";

import { useState, useMemo, useEffect, useCallback, type ReactNode } from "react";
import {
  BRAND_ORDER,
  MONTHS,
  StoreRetailMap,
  StoreDirectCostMap,
  type StoreDirectCost,
  type StoreRetailRow,
  type RetailStoreData,
  type RetailStoreRow,
} from "../../lib/types";
import { dealerDisplayName } from "../../lib/utils";
import type { AccountNameMap } from "./StockView";

interface Props {
  cogsRateMap: Record<string, Record<string, number>>;
  /** 실적 전용 월별 출고율: brd_cd → account_id → month → rate (2026_FR_출고율.csv) */
  actualCogsRateMap?: Record<string, Record<string, Record<number, number>>> | null;
  accountNameMap: AccountNameMap;
  storeRetailMap?: StoreRetailMap;
  storeDirectCostMap?: StoreDirectCostMap;
  retailYoy2025Map?: Record<string, Record<number, number>> | null;
  retailStore2026?: RetailStoreData | null;
}

/** 월 선택 모드: annual=26년연간목표, annual25=25년연간실적, target=26월별목표, actual=26월별실적, actual25=25월별실적 */
type MonthOption =
  | "annual"
  | "annual25"
  | { kind: "target";   m: number }
  | { kind: "actual";   m: number }
  | { kind: "actual25"; m: number };
function isActualMonth(opt: MonthOption): opt is { kind: "actual"; m: number } {
  return typeof opt === "object" && opt.kind === "actual";
}
function isActual25Month(opt: MonthOption): opt is { kind: "actual25"; m: number } {
  return typeof opt === "object" && opt.kind === "actual25";
}
function isTargetMonth(opt: MonthOption): opt is { kind: "target"; m: number } {
  return typeof opt === "object" && opt.kind === "target";
}
function is2025Mode(opt: MonthOption): boolean {
  return opt === "annual25" || isActual25Month(opt);
}
function monthNum(opt: MonthOption): number | null {
  if (opt === "annual" || opt === "annual25") return null;
  return opt.m;
}
type PLTableVariant = "dealer" | "store";

/** PL·모달 공통: 선택 기간 기준 리테일(V+) > 0 인 매장 수 (목표 CSV 기준) */
function countActiveStoresForPeriod(stores: StoreRetailRow[], month: MonthOption): number {
  return stores.filter((s) => {
    const m = monthNum(month);
    const retail =
      m === null
        ? MONTHS.reduce((sum, mm) => sum + (s.months[mm] ?? 0), 0)
        : (s.months[m] ?? 0);
    return retail > 0;
  }).length;
}
/** 실적 모드: sale > 0 인 Snowflake 매장 수 */
function countActiveActualStores(stores: RetailStoreRow[], m: number): number {
  return stores.filter((s) => (s.months_sale[String(m)] ?? 0) > 0).length;
}
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
  /** CSV 임차료 → 월 미니멈 임차(하한) 산출용 나눗셈 */
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
  /** 실적 모드 매출원가 계산: 의류 출고율 */
  apparelCogsRate: 0.42,
  /** 실적 모드 매출원가 계산: ACC 출고율 */
  accCogsRate: 0.47,
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
  if (selectedMonth === "annual" || selectedMonth === "annual25") v /= PL_CALC.annualMonthsForAvgLabor;
  return v;
}

/** 실적 JSON months/months_sale에서 해당 월 or 연간합 추출 */
function actualTagSale(
  stores: RetailStoreRow[],
  opt: MonthOption,
): { tag: number; sale: number } {
  let tag = 0, sale = 0;
  const m = monthNum(opt);
  for (const s of stores) {
    if (m === null) {
      for (let mm = 1; mm <= 12; mm++) {
        tag  += s.months[String(mm)]       ?? 0;
        sale += s.months_sale[String(mm)]  ?? 0;
      }
    } else {
      tag  += s.months[String(m)]      ?? 0;
      sale += s.months_sale[String(m)] ?? 0;
    }
  }
  return { tag, sale };
}

/**
 * KPI 범례의 직접비 구성 — `directCost` 산식(매장/대리상)과 맞출 것.
 * (코드: salary+bonus+insurance+rent+depr+marketing+…)
 */
const PL_LEGEND_DIRECT_COST_FORMULA =
  "급여 + 성과급 + 보험/공적금 + 임차(max(미니멈,변동)) + 감가상각비 + 기타(마케팅·포장·지급수수료·others)";

/** 직접비 블록 열 수 — 본문 DirectCostCells·thead directSpan·TotalRow 동기화 */
function countDirectCostColumns(variant: PLTableVariant, openGroups: OpenGroups): number {
  let n = 2 + 1; // 직접비합계, 비용률, 인건비(합계)
  if (openGroups.labor) n += 2;
  if (variant === "store" || (variant === "dealer" && openGroups.labor)) n += 1; // 인원수
  if (variant === "dealer") n += 1; // 매장당 인원수
  n += 1; // 평균인건비
  n += 1; // 보험
  n += 1; // 임차
  if (variant === "store" && openGroups.rent) n += 2;
  n += 1; // 감가
  n += 1; // 기타 합계
  if (openGroups.other) n += 4;
  return n;
}

/** 매장 모달: 매장명 열을 제외한 데이터 열 수(빈 행 colSpan용) */
function countStoreModalBodyCols(
  isActualMode: boolean,
  tagDetailOpen: boolean,
  cogsRateOpen: boolean,
  openGroups: OpenGroups,
): number {
  const rev = isActualMode ? (tagDetailOpen ? 5 : 2) + 1 : 2;
  const rateCol = isActualMode ? (cogsRateOpen ? 1 : 0) : 1;
  return (
    2 +
    rev +
    rateCol +
    1 +
    2 +
    2 +
    countDirectCostColumns("store", openGroups)
  );
}

/** 인건비·임차·기타 하위 열이 모두 접힌 상태 — 직접비 상세 열 폭 균등화에 사용 */
function plDirectSubgroupsAllCollapsed(openGroups: OpenGroups): boolean {
  return !openGroups.labor && !openGroups.rent && !openGroups.other;
}

/** 대리상 PL: `DirectCostCells` 직전까지 열 개수(첫 열 포함), 본문·헤더와 동기화 */
function countDealerPlLeftColumns(isActualMode: boolean, dealerCogsRateOpen: boolean): number {
  return (
    1 + // 대리상명
    1 + // Tag
    1 + // 리테일
    (isActualMode ? 1 : 0) + // 할인율
    (dealerCogsRateOpen ? 1 : 0) + // 출고율
    1 + // 매출원가
    1 + // 매출이익
    1 + // 매출이익률
    2 // 영업이익 · 영업이익률
  );
}

/** 매장 모달 PL: `DirectCostCells` 직전까지 열 개수(첫 열 포함) */
function countStorePlLeftColumns(
  isActualMode: boolean,
  storeTagDetailOpen: boolean,
  storeCogsRateOpen: boolean,
): number {
  const tagCols = isActualMode ? 1 + (storeTagDetailOpen ? 3 : 0) : 1;
  return (
    1 + // 매장명
    2 + // Store Type, Trade Zone
    tagCols +
    1 + // 리테일
    (isActualMode ? 1 : 0) + // 할인율
    (!isActualMode || storeCogsRateOpen ? 1 : 0) + // 출고율
    1 + // 매출원가
    1 + // 매출이익
    1 + // 매출이익률
    2
  );
}

/** PL 메인(대리상) 명칭 열 최소 폭 — 매장 모달 대비 1.4배 */
const PL_NAME_COL_MIN_DEALER_REM = 17 * 1.4; // 23.8
/** PL 실적월 매장 모달 명칭 열 — 목표 모달(17rem) 대비 1.5배 */
const PL_NAME_COL_MIN_STORE_ACTUAL_REM = 17 * 1.5; // 25.5

function PlTableColGroup({
  variant,
  openGroups,
  isActualMode,
  dealerCogsRateOpen = false,
  storeTagDetailOpen = false,
  storeCogsRateOpen = false,
}: {
  variant: PLTableVariant;
  openGroups: OpenGroups;
  isActualMode: boolean;
  dealerCogsRateOpen?: boolean;
  storeTagDetailOpen?: boolean;
  storeCogsRateOpen?: boolean;
}) {
  const leftCols =
    variant === "dealer"
      ? countDealerPlLeftColumns(isActualMode, dealerCogsRateOpen)
      : countStorePlLeftColumns(isActualMode, storeTagDetailOpen, storeCogsRateOpen);
  const directSpan = countDirectCostColumns(variant, openGroups);
  const equalDetail = plDirectSubgroupsAllCollapsed(openGroups);
  const detailWidth = "6.25rem";
  const nameColMin =
    variant === "dealer"
      ? `${PL_NAME_COL_MIN_DEALER_REM}rem`
      : variant === "store" && isActualMode
        ? `${PL_NAME_COL_MIN_STORE_ACTUAL_REM}rem`
        : "17rem";

  return (
    <colgroup>
      {/* table-fixed에서 1%만 주면 다른 고정폭 열에 밀려 잘림 → minWidth로 하한 */}
      <col style={{ width: "1%", minWidth: nameColMin }} />
      {Array.from({ length: leftCols - 1 }, (_, i) => (
        <col key={`lc-${i}`} />
      ))}
      {Array.from({ length: directSpan }, (_, i) => (
        <col
          key={`dc-${i}`}
          style={equalDetail ? { width: detailWidth, minWidth: detailWidth } : undefined}
        />
      ))}
    </colgroup>
  );
}

/** PL 월 표기 — 목표 */
function plMonthTargetLabel(month: number): string {
  return `26.${String(month).padStart(2, "0")}(목표)`;
}
/** PL 월 표기 — 실적 */
function plMonthActualLabel(month: number): string {
  return `26.${String(month).padStart(2, "0")}(실적)`;
}
/** 실적 모드 PL 출고율 열 헤더 — 선택 월과 동일한 26.MM */
function plActualMonthCogsRateLabel(month: number): string {
  return `26.${String(month).padStart(2, "0")}출고율`;
}
/** MonthOption → 직렬화 키 (select value용) */
function optionKey(opt: MonthOption): string {
  if (opt === "annual") return "annual";
  if (opt === "annual25") return "annual25";
  return `${opt.kind}-${opt.m}`;
}
/** 직렬화 키 → MonthOption */
function parseOptionKey(key: string): MonthOption {
  if (key === "annual") return "annual";
  if (key === "annual25") return "annual25";
  const [kind, m] = key.split("-");
  return { kind: kind as "target" | "actual" | "actual25", m: Number(m) };
}

/** 실적 드롭다운에 노출할 확정 월 수 (retail_store_2026.json 기준 자동 산출) */
function getActualMonthCount(retailStore: RetailStoreData | null | undefined): number {
  if (!retailStore) return 0;
  let max = 0;
  for (const accounts of Object.values(retailStore.brands)) {
    for (const acc of accounts) {
      for (const store of acc.stores) {
        const keys = Object.keys(store.months_sale ?? {}).map(Number).filter((k) => k > 0);
        if (keys.length > 0) max = Math.max(max, Math.max(...keys));
      }
    }
  }
  return max;
}

type DropdownOption = { value: MonthOption; label: string; isActual?: boolean; is2025?: boolean };

function buildDropdownOptions(actualMonths: number): DropdownOption[] {
  return [
    { value: "annual" as MonthOption, label: "26년 연간목표" },
    ...MONTHS.map((m) => ({ value: { kind: "target" as const, m }, label: plMonthTargetLabel(m) })),
    ...Array.from({ length: actualMonths }, (_, i) => ({
      value: { kind: "actual" as const, m: i + 1 },
      label: plMonthActualLabel(i + 1),
      isActual: true,
    })),
    { value: "annual25" as MonthOption, label: "25년 연간실적", is2025: true },
    ...MONTHS.map((m) => ({
      value: { kind: "actual25" as const, m },
      label: `25.${String(m).padStart(2, "0")}(실적)`,
      is2025: true,
    })),
  ];
}

function fmt(n: number): string {
  if (!isFinite(n)) return "";
  return Math.round(n / 1000).toLocaleString();
}

function fmtRate(n: number): string {
  if (!isFinite(n)) return "";
  return (n * 100).toFixed(1) + "%";
}

/** 실적 모드: 할인율 = 1 − 리테일(V+)/Tag (표시 0.0% 형식, Tag≤0이면 —) */
function plActualDiscountRateDisplay(tag: number, retail: number): string {
  if (!(tag > 0)) return "—";
  return fmtRate(1 - retail / tag);
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
  const isActual = isActualMonth(ctx.selectedMonth);
  const bonusScope = ctx.selectedMonth === "annual" ? "월별 동일 합산" : "해당 월";

  return [
    <li key="tag">
      <span className="font-semibold text-slate-700">Tag</span>{" "}
      {isActual
        ? "= Snowflake dw_sale tag_amt 월별 집계 (할인율 역산 없음)."
        : <>= 리테일(V+) ÷ (1 − 전년할인율){ctx.hasDc ? ` (할인율 ${fmtRate(ctx.discountRate)})` : ""}.</>}
    </li>,
    <li key="retail">
      <span className="font-semibold text-slate-700">리테일(V+)</span>{" "}
      {isActual
        ? "= Snowflake dw_sale sale_amt 월별 집계."
        : "= 2026_monthlyretail.csv 매장별 월 합산."}
    </li>,
    <li key="cogsRateBasis">
      <span className="font-semibold text-slate-700">출고율 적용 규칙</span> (대시보드 PL 메인·모달 본문과 동일)
      {isActual ? (
        <>
          {" "}
          — <span className="font-semibold text-slate-700">실적</span>: 매출원가 산출에 CSV 출고율 맵을 쓰지 않고, Snowflake에서 온
          월별 <span className="font-semibold text-slate-700">의류 Tag</span>·<span className="font-semibold text-slate-700">ACC Tag</span>·
          <span className="font-semibold text-slate-700">미정</span>(기타) 금액에 고정 비율을 곱해 합산합니다. 의류·미정 ={" "}
          {fmtRate(PL_CALC.apparelCogsRate)}, ACC = {fmtRate(PL_CALC.accCogsRate)} (
          <code className="text-[9px] bg-slate-200/80 px-0.5 rounded">PL_CALC.apparelCogsRate</code>,{" "}
          <code className="text-[9px] bg-slate-200/80 px-0.5 rounded">accCogsRate</code>). 표의「가중출고율」열은 합계 Tag가 0이
          아니면 (의류×비율+ACC×비율+미정×비율) ÷ 합계 Tag 로 표시합니다.
        </>
      ) : (
        <>
          {" "}
          — <span className="font-semibold text-slate-700">목표·연간목표</span>: 브랜드·대리상(account)당 하나의 출고율을{" "}
          <code className="text-[9px] bg-slate-200/80 px-0.5 rounded">2025_FR_출고율.csv</code>에서 읽고, 없으면 같은 파일의
          「평균」값을 씁니다.
        </>
      )}
    </li>,
    <li key="cogs">
      <span className="font-semibold text-slate-700">매출원가</span>{" "}
      {isActual ? (
        <>
          (실적) ={" "}
          <span className="whitespace-nowrap">
            (의류Tag×{fmtRate(PL_CALC.apparelCogsRate)} + ACC Tag×{fmtRate(PL_CALC.accCogsRate)} + 미정×
            {fmtRate(PL_CALC.apparelCogsRate)})
          </span>
          ÷ {v}. (코드: <code className="text-[9px] bg-slate-200/80 px-0.5 rounded">cogsMixed / retailVatFactor</code>,{" "}
          <code className="text-[9px] bg-slate-200/80 px-0.5 rounded">cogsMixed</code>는 위 가중합.)
        </>
      ) : (
        <>
          (목표) = 합계 Tag × 출고율 ÷ {v}. 출고율은 대리상별 CSV, 없으면 평균.
          {ctx.hasDc ? ` 예시 출고율 ${fmtRate(ctx.cogsRate)}` : ""}
        </>
      )}
    </li>,
    <li key="gp">
      <span className="font-semibold text-slate-700">매출이익</span> = 리테일(V+) ÷ {v} − 매출원가.
    </li>,
    <li key="gmr">
      <span className="font-semibold text-slate-700">매출이익률</span> = 매출이익 × {v} ÷ 리테일(V+).
    </li>,
    <li key="dc">
      <span className="font-semibold text-slate-700">직접비합계</span> = {PL_LEGEND_DIRECT_COST_FORMULA}.
      {isActual && (
        <span className="text-amber-600"> FR수익구조 미등록 매장은 직접비 0 → 비용률이 실제보다 낮을 수 있음.</span>
      )}
    </li>,
    <li key="costRate">
      <span className="font-semibold text-slate-700">비용률</span> = 직접비합계 × {v} ÷ 리테일(V+).
    </li>,
    <li key="labor">
      <span className="font-semibold text-slate-700">인건비</span> = 급여 + 성과급. 급여 = 평균급여×인원({bonusScope}
      ). 성과급 = 해당 월 리테일×bonus%.{" "}
      <span className="font-semibold text-slate-700">평균인건비</span>·인당급여 KPI = (급여+성과급)÷인원 → 천위안
      표시; 26년 연간목표일 때 ÷{PL_CALC.annualMonthsForAvgLabor}(월 환산).
    </li>,
    <li key="ins">
      <span className="font-semibold text-slate-700">보험/공적금</span> = (급여+성과급) × 보험율.
    </li>,
    <li key="rent">
      <span className="font-semibold text-slate-700">임차(메인·모달 동일)</span> ={" "}
      <span className="text-slate-500">미니멈</span>(FR 임차료÷{r}, 월)과{" "}
      <span className="text-slate-500">변동</span>(해당 월 리테일÷{v}×수수료율) 중{" "}
      <span className="font-semibold text-slate-600">큰 금액</span>
      {ctx.hasDc ? ` — 수수료율 ${fmtRate(ctx.commissionRate)}` : " (수수료율 CSV)"}.
    </li>,
    <li key="depr">
      <span className="font-semibold text-slate-700">감가상각비</span>: 모달은 인테리어(CSV)를 월 상각액으로 두고{" "}
      <code className="text-[9px] bg-slate-200/80 px-0.5 rounded">calcDeprForMonthStoreModal</code> (Open~Remodeling end·휴점
      반영). 메인은{" "}
      <code className="text-[9px] bg-slate-200/80 px-0.5 rounded">calcDeprForMonth</code> — 인테리어÷상각월수(종료월=CSV
      Remodeling end Month, 없으면 Amortization end Month).
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
    <li key="script-actual" className="text-slate-500 pt-0.5 border-t border-slate-200/80">
      <span className="font-semibold text-slate-600">실적 데이터 갱신</span> — 아래 명령어 실행 후 새로고침:
      <code className="block mt-1 select-all rounded bg-slate-100 px-2 py-1 text-[10px] font-mono text-slate-700">
        python scripts/preprocess_retail_pl_actual.py
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
  const isActual = isActualMonth(ctx.selectedMonth);
  const sectionCards = [
    {
      title: "기본 산식",
      caption: "매출과 원가의 기준이 되는 핵심 계산",
      tone: "from-sky-50 via-white to-cyan-50 border-sky-200/80",
      accent: "bg-sky-500",
      items: items.slice(0, 7),
    },
    {
      title: "직접비 상세",
      caption: "인건비, 임차, 감가와 기타 직접비 구성",
      tone: "from-emerald-50 via-white to-teal-50 border-emerald-200/80",
      accent: "bg-emerald-500",
      items: items.slice(7, 14),
    },
    {
      title: "참고 및 데이터",
      caption: "표시 규칙과 데이터 갱신 참고",
      tone: "from-amber-50 via-white to-orange-50 border-amber-200/80",
      accent: "bg-amber-500",
      items: items.slice(14),
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative flex max-h-[min(90vh,1280px)] w-full max-w-[min(96rem,98vw)] flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.24)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pl-calc-logic-title"
      >
        <div className="shrink-0 border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.14),_transparent_42%),linear-gradient(135deg,_#f8fafc_0%,_#ffffff_58%,_#eef6ff_100%)] px-5 py-4 sm:px-6 sm:py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold tracking-[0.01em] text-sky-700">
                  PL 계산 가이드
                </span>
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                  {ctx.monthLabel}
                </span>
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                    isActual
                      ? "border-blue-200 bg-blue-50 text-blue-700"
                      : "border-emerald-200 bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {isActual ? "실적 기준" : "목표 기준"}
                </span>
              </div>
              <h3 id="pl-calc-logic-title" className="text-lg font-bold tracking-[-0.02em] text-slate-800">
                계산 로직
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                계산식 자체는 그대로 두고, 주요 기준과 비용 구조를 한눈에 볼 수 있게 정리한 안내 팝업입니다.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-xl border border-slate-200 bg-white/80 p-2 text-slate-400 shadow-sm transition-colors hover:bg-slate-100 hover:text-slate-700"
              aria-label="닫기"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/80 bg-white/85 px-4 py-3 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Retail Factor</div>
              <div className="mt-1 text-lg font-bold text-slate-800">{PL_CALC.retailVatFactor}</div>
              <div className="mt-1 text-xs leading-5 text-slate-500">리테일(V+)를 순매출 기준으로 환산할 때 공통 사용</div>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white/85 px-4 py-3 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Rent Rule</div>
              <div className="mt-1 text-sm font-bold text-slate-800">미니멈 vs 변동 임차 비교</div>
              <div className="mt-1 text-xs leading-5 text-slate-500">두 값 중 큰 금액을 임차 비용으로 반영</div>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white/85 px-4 py-3 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">View Mode</div>
              <div className="mt-1 text-sm font-bold text-slate-800">{isActual ? "Snowflake 실적 기반" : "CSV 목표 기반"}</div>
              <div className="mt-1 text-xs leading-5 text-slate-500">선택 월 기준 데이터 소스와 원가 계산 기준을 함께 표시</div>
            </div>
          </div>
        </div>
        <div className="overflow-y-auto bg-slate-50/70 px-5 py-5 text-left sm:px-6 sm:py-6">
          <div className="grid gap-4 xl:grid-cols-[1.1fr_1.1fr_0.9fr]">
            {sectionCards.map((section) => (
              <section
                key={section.title}
                className={`overflow-hidden rounded-[24px] border bg-gradient-to-br ${section.tone} shadow-[0_14px_34px_rgba(15,23,42,0.08)]`}
              >
                <div className="border-b border-white/70 px-4 py-4 sm:px-5">
                  <div className="flex items-center gap-3">
                    <span className={`h-10 w-1.5 rounded-full ${section.accent}`} aria-hidden="true" />
                    <div>
                      <h4 className="text-sm font-bold tracking-[-0.01em] text-slate-800">{section.title}</h4>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{section.caption}</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-3 px-4 py-4 sm:px-5 sm:py-5">
                  {section.items.map((item, index) => (
                    <ul
                      key={`${section.title}-${index}`}
                      className="list-none rounded-2xl border border-white/80 bg-white/92 px-4 py-3 text-sm leading-7 text-slate-600 shadow-sm"
                    >
                      {item}
                    </ul>
                  ))}
                </div>
              </section>
            ))}
          </div>
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
  /** 실적 모달: MST_SHOP_ALL.shop_nm_cn */
  shopNmCn?: string;
  /** 모달 KPI: 목표=CSV·맵, 실적=Snowflake */
  cityTierNm?: string;
  /** 실적: region_nm 한글(지역 코드 매핑) */
  regionKr?: string;
  /** 실적: MST_SHOP_ALL anlys_shop_type_nm (CSV 없을 때 KPI용) */
  actualStoreType?: string;
  /** 실적: MST_SHOP_ALL trade_zone_nm */
  actualTradeZone?: string;
  retail: number;
  tag: number;
  tagApparel?: number;
  tagAcc?: number;
  tagEtc?: number;
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

/** yyyyMM 정수 생성: 월 1~12, year 기본값 2026 */
function ym(month: number, year: 2025 | 2026 = 2026): number {
  return year * 100 + month;
}

/** 월 미니멈 임차(하한) = CSV 임차료 / PL_CALC.rentFixedDivisor */
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
  return Math.max(rentFixedMonth(dc), rentVariableMonth(retailM, dc));
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
 * @param amortEndMonth 상각 종료 yyyyMM (로더: Remodeling end Month 우선, 없으면 Amortization end Month)
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
 * @param amortEndMonth 상각 종료 yyyyMM (로더: Remodeling end Month 우선, 없으면 Amortization end Month)
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

/** 매장 모달(store) 직접비 서브헤더: 1줄 제목 + 2줄 연한 회색 안내(일부 고정 문구) */
function PlStoreTwoLineTh({
  title,
  subLine,
  className,
}: {
  title: ReactNode;
  subLine: string;
  className: string;
}) {
  return (
    <th className={`px-3 py-2 text-xs align-top whitespace-normal ${className}`}>
      <div className="flex flex-col items-end gap-0.5 leading-tight">
        <div className="font-semibold text-slate-700">{title}</div>
        <div className="text-[10px] font-normal text-slate-400">{subLine}</div>
      </div>
    </th>
  );
}

const PL_STORE_HEAD_SUB = {
  salary: "고정",
  bonus: "(V+)*3%",
  insurance: "인건비x5%",
  rent: "max[미니멈, (V+)÷1.13×%]",
  depr: "(고정)",
  marketing: `(V+)÷${PL_CALC.retailVatFactor}×${(PL_CALC.marketingRate * 100).toFixed(1)}%`,
  packaging: `(V+)÷${PL_CALC.retailVatFactor}×${(PL_CALC.packagingRate * 100).toFixed(1)}%`,
  payFee: `(V+)÷${PL_CALC.retailVatFactor}×${(PL_CALC.payFeeRate * 100).toFixed(1)}%+2K`,
  others: `(V+)÷${PL_CALC.retailVatFactor}×${(PL_CALC.othersRate * 100).toFixed(1)}%`,
} as const;

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
  /** 대리상 표만: 활성 매장 수 — 있으면 인원수·평균인건비 사이에 매장당 인원수 열 */
  activeStoreCount?: number;
  /** 대리상: 인건비 접힘 시 인원수 열 숨김 — store는 항상 true */
  showHeadcountCol?: boolean;
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
  activeStoreCount,
  showHeadcountCol = true,
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
      <td className={`px-3 py-2 tabular-nums ${cr === null ? "text-slate-300" : "text-slate-600"}`}>
        {cr === null ? "—" : fmtRate(cr)}
      </td>
      <td className={`px-3 py-2 border-l border-slate-200 font-semibold text-slate-700 ${cls(labor)}`}>{f(labor)}</td>
      {openGroups.labor && (
        <>
          {subTd(salary)}
          {subTd(bonus)}
        </>
      )}
      {showHeadcountCol && (
        <td
          className={`px-3 py-2 border-l border-slate-200 ${REF_TD} ${
            headcount === 0 ? "text-slate-400" : "text-slate-600"
          }`}
        >
          {headcount === 0 ? "—" : `${headcount}명`}
        </td>
      )}
      {activeStoreCount !== undefined && (
        <td
          className={`px-3 py-2 ${REF_TD} ${
            activeStoreCount > 0 && headcount > 0 ? "text-slate-600" : "text-slate-400"
          }`}
        >
          {activeStoreCount > 0 && headcount > 0
            ? `${Math.ceil(headcount / activeStoreCount)}명`
            : "—"}
        </td>
      )}
      <td className={`px-3 py-2 ${REF_TD} ${avgLaborCost === 0 ? "text-slate-400" : "text-slate-700"}`}>
        {avgLaborCost === 0 ? "—" : (avgLaborCost / 1000).toFixed(2)}
      </td>
      <td className={`px-3 py-2 border-l border-slate-200 font-semibold ${cls(insurance)}`}>{f(insurance)}</td>
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
  cogsRateColumnLabel = "25년 출고율",
  isActualMode = false,
  dealerCogsRateOpen = false,
  onDealerCogsRateToggle,
  storeTagDetailOpen = false,
  onStoreTagDetailToggle,
  storeCogsRateOpen = false,
  onStoreCogsRateToggle,
}: {
  firstColLabel: string;
  variant: PLTableVariant;
  openGroups: OpenGroups;
  onToggle: (key: keyof OpenGroups) => void;
  /** 목표=25년 CSV, 실적=26.MM출고율(해당월) — 출고율 열 헤더 */
  cogsRateColumnLabel?: string;
  /** 매장 모달 전용: 매장명·리테일·매출이익 헤더 클릭 정렬 */
  storeColumnSort?: {
    sortKey: StoreTableSortKey;
    sortDir: "asc" | "desc";
    onSort: (key: StoreTableSortKey) => void;
  };
  /** 실적 모드 여부 — 의류/ACC Tag 컬럼 표시 여부 */
  isActualMode?: boolean;
  /** 대리상 메인: 출고율 열 표시(기본 접힘=false) */
  dealerCogsRateOpen?: boolean;
  onDealerCogsRateToggle?: () => void;
  /** 실적 매장 모달: 의류/ACC/미정 세부 열 표시(접힘=Tag+리테일만) */
  storeTagDetailOpen?: boolean;
  onStoreTagDetailToggle?: () => void;
  /** 실적 매장 모달: 가중출고율 열 표시 */
  storeCogsRateOpen?: boolean;
  onStoreCogsRateToggle?: () => void;
}) {
  const directSpan = countDirectCostColumns(variant, openGroups);
  const directSpanDetail = directSpan - 2;
  const showHeadcountCol = variant === "store" || (variant === "dealer" && openGroups.labor);
  const showCogsRateCol =
    variant === "dealer"
      ? dealerCogsRateOpen
      : isActualMode
        ? storeCogsRateOpen
        : true;
  const revenueColSpan =
    variant === "store"
      ? isActualMode
        ? (storeTagDetailOpen ? 5 : 2) + 1
        : 2
      : isActualMode
        ? 3
        : 2;
  const cogsGroupColSpan = showCogsRateCol ? 2 : 1;

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

  const tagDetailToggleBtn = onStoreTagDetailToggle ? (
    <button
      type="button"
      onClick={onStoreTagDetailToggle}
      className="ml-1 opacity-60 hover:opacity-100 transition-opacity text-[9px] leading-none"
      title={storeTagDetailOpen ? "접기" : "펼치기"}
    >
      {storeTagDetailOpen ? "▼" : "▶"}
    </button>
  ) : null;

  const cogsRateToggleBtn =
    variant === "dealer" && onDealerCogsRateToggle ? (
      <button
        type="button"
        onClick={onDealerCogsRateToggle}
        className="ml-1 opacity-60 hover:opacity-100 transition-opacity text-[9px] leading-none"
        title={dealerCogsRateOpen ? "접기" : "펼치기"}
      >
        {dealerCogsRateOpen ? "▼" : "▶"}
      </button>
    ) : variant === "store" && isActualMode && onStoreCogsRateToggle ? (
      <button
        type="button"
        onClick={onStoreCogsRateToggle}
        className="ml-1 opacity-60 hover:opacity-100 transition-opacity text-[9px] leading-none"
        title={storeCogsRateOpen ? "접기" : "펼치기"}
      >
        {storeCogsRateOpen ? "▼" : "▶"}
      </button>
    ) : null;

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
          colSpan={revenueColSpan}
          className="px-3 py-1.5 text-center text-[10px] font-semibold text-white border-l border-white/20"
        >
          매출
        </th>
        <th
          colSpan={cogsGroupColSpan}
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
          colSpan={2}
          className="px-3 py-1.5 text-center text-[10px] font-semibold text-sky-200 border-l border-white/20"
        >
          영업이익
        </th>
        <th
          colSpan={2}
          className="px-3 py-1.5 text-center text-[10px] font-semibold text-sky-200 border-l border-white/20"
        >
          직접비
        </th>
        <th
          colSpan={directSpanDetail}
          className="px-3 py-1.5 text-center text-[10px] font-semibold text-sky-200 border-l border-white/20"
        >
          직접비 상세
        </th>
      </tr>
      <tr className="bg-sky-100 border-b border-slate-200">
        <th
          className={`sticky left-0 z-10 bg-sky-100 px-3 py-2.5 text-left text-xs font-semibold text-slate-700 ${
            variant === "dealer"
              ? "min-w-[23.8rem]"
              : variant === "store" && isActualMode
                ? "min-w-[25.5rem]"
                : "min-w-[17rem]"
          }`}
        >
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
            <th className="px-3 py-2.5 text-xs font-semibold text-slate-700 whitespace-nowrap border-l border-slate-200">
              Store Type
            </th>
            <th className="px-3 py-2.5 text-xs font-semibold text-slate-700 whitespace-nowrap">
              Trade Zone
            </th>
          </>
        )}
        {variant === "store" && isActualMode ? (
          <>
            <th className="px-3 py-2.5 text-xs font-semibold text-slate-700 whitespace-nowrap border-l border-slate-200">
              Tag
              {tagDetailToggleBtn}
            </th>
            {storeTagDetailOpen && (
              <>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 whitespace-nowrap">의류Tag</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 whitespace-nowrap">ACC Tag</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-400 whitespace-nowrap">미정</th>
              </>
            )}
          </>
        ) : (
          <th className="px-3 py-2.5 text-xs font-semibold text-slate-700 whitespace-nowrap border-l border-slate-200">
            Tag
          </th>
        )}
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
        {isActualMode && (
          <th className="px-3 py-2.5 text-xs font-semibold text-slate-700 whitespace-nowrap">할인율</th>
        )}
        {showCogsRateCol && (
          <th className="px-3 py-2.5 text-xs font-semibold text-slate-700 whitespace-nowrap border-l border-slate-200">
            {cogsRateColumnLabel}
            {cogsRateToggleBtn}
          </th>
        )}
        <th
          className={`px-3 py-2.5 text-xs font-semibold text-slate-700 whitespace-nowrap ${
            !showCogsRateCol ? "border-l border-slate-200" : ""
          }`}
        >
          매출원가
        </th>
        <th className="px-3 py-2.5 text-xs font-semibold text-slate-700 whitespace-nowrap border-l border-slate-200">
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
        <th className="px-3 py-2.5 text-xs font-bold text-[#1e3a5f] whitespace-nowrap border-l border-slate-200">
          영업이익
        </th>
        <th className="px-3 py-2.5 text-xs font-bold text-[#1e3a5f] whitespace-nowrap">영업이익률</th>
        <th className="px-3 py-2.5 text-xs font-semibold text-slate-700 whitespace-nowrap border-l border-slate-200">
          직접비합계
        </th>
        <th className="px-3 py-2.5 text-xs font-semibold text-slate-700 whitespace-nowrap">비용률</th>
        <th
          className={`px-3 py-2.5 text-xs whitespace-nowrap cursor-pointer select-none border-l border-slate-200 ${L1_HEAD}`}
        >
          인건비{toggleBtn("labor", openGroups.labor)}
        </th>
        {openGroups.labor &&
          (variant === "store" ? (
            <>
              <PlStoreTwoLineTh title="(급여)" subLine={PL_STORE_HEAD_SUB.salary} className={SUB_HEAD} />
              <PlStoreTwoLineTh title="(성과급)" subLine={PL_STORE_HEAD_SUB.bonus} className={SUB_HEAD} />
            </>
          ) : (
            <>
              <th className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap ${SUB_HEAD}`}>(급여)</th>
              <th className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap ${SUB_HEAD}`}>(성과급)</th>
            </>
          ))}
        {showHeadcountCol && (
          <th className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap border-l border-slate-200 ${REF_COL}`}>
            인원수
          </th>
        )}
        {variant === "dealer" && (
          <th className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap ${REF_COL}`}>매장당 인원수</th>
        )}
        <th className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap ${REF_COL}`}>평균인건비</th>
        {variant === "store" ? (
          <PlStoreTwoLineTh title="보험/공적금" subLine={PL_STORE_HEAD_SUB.insurance} className="border-l border-slate-200" />
        ) : (
          <th className={`px-3 py-2.5 text-xs whitespace-nowrap border-l border-slate-200 ${L1_HEAD}`}>
            보험/공적금
          </th>
        )}
        {variant === "store" ? (
          <PlStoreTwoLineTh
            title={
              <>
                임차료
                {toggleBtn("rent", openGroups.rent)}
              </>
            }
            subLine={PL_STORE_HEAD_SUB.rent}
            className="cursor-pointer select-none"
          />
        ) : (
          <th className={`px-3 py-2.5 text-xs whitespace-nowrap cursor-pointer select-none ${L1_HEAD}`}>
            임차료
          </th>
        )}
        {variant === "store" && openGroups.rent && (
          <>
            <th className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap ${SUB_HEAD}`}>(미니멈)</th>
            <th className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap ${SUB_HEAD}`}>(변동)</th>
          </>
        )}
        {variant === "store" ? (
          <PlStoreTwoLineTh title="감가상각비" subLine={PL_STORE_HEAD_SUB.depr} className="" />
        ) : (
          <th className={`px-3 py-2.5 text-xs whitespace-nowrap border-l border-slate-200 ${L1_HEAD}`}>
            감가상각비
          </th>
        )}
        <th className={`px-3 py-2.5 text-xs whitespace-nowrap cursor-pointer select-none ${L1_HEAD}`}>
          기타{toggleBtn("other", openGroups.other)}
        </th>
        {openGroups.other &&
          (variant === "store" ? (
            <>
              <PlStoreTwoLineTh title="(마케팅)" subLine={PL_STORE_HEAD_SUB.marketing} className={SUB_HEAD} />
              <PlStoreTwoLineTh title="(포장)" subLine={PL_STORE_HEAD_SUB.packaging} className={SUB_HEAD} />
              <PlStoreTwoLineTh title="(지급수수료)" subLine={PL_STORE_HEAD_SUB.payFee} className={SUB_HEAD} />
              <PlStoreTwoLineTh title="(others)" subLine={PL_STORE_HEAD_SUB.others} className={SUB_HEAD} />
            </>
          ) : (
            <>
              <th className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap ${SUB_HEAD}`}>(마케팅)</th>
              <th className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap ${SUB_HEAD}`}>(포장)</th>
              <th className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap ${SUB_HEAD}`}>(지급수수료)</th>
              <th className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap ${SUB_HEAD}`}>(others)</th>
            </>
          ))}
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
  isActualMode = false,
  dealerTotalActiveStores,
  dealerCogsRateOpen = false,
  storeTagDetailOpen = false,
  storeCogsRateOpen = false,
}: {
  totals: TotalRowTotals;
  variant: PLTableVariant;
  selectedMonth: MonthOption;
  openGroups: OpenGroups;
  isActualMode?: boolean;
  /** 대리상 합계 행: 표에 포함된 활성 매장 수 합 */
  dealerTotalActiveStores?: number;
  dealerCogsRateOpen?: boolean;
  storeTagDetailOpen?: boolean;
  storeCogsRateOpen?: boolean;
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
  const showHeadcountCol = variant === "store" || (variant === "dealer" && openGroups.labor);
  const showCogsRateCol =
    variant === "dealer"
      ? dealerCogsRateOpen
      : isActualMode
        ? storeCogsRateOpen
        : true;

  const subTd = (v: number) => (
    <td className={`px-3 py-2.5 ${cSub(v)}`}>{f(v)}</td>
  );

  return (
    <tr className="border-t-2 border-slate-200 bg-slate-100 font-semibold text-xs">
      <td className="sticky left-0 z-10 bg-slate-100 px-3 py-2.5 text-left text-slate-800">합 계</td>
      {variant === "store" && (
        <>
          <td className="px-3 py-2.5 border-l border-slate-200" />
          <td className="px-3 py-2.5" />
        </>
      )}
      {variant === "dealer" && (
        <td className="px-3 py-2.5 text-slate-800 border-l border-slate-200">{fmt(totals.tag)}</td>
      )}
      {variant === "store" && (
        <>
          <td className="px-3 py-2.5 text-slate-800 border-l border-slate-200">{fmt(totals.tag)}</td>
          {isActualMode && storeTagDetailOpen && (
            <>
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5" />
            </>
          )}
        </>
      )}
      <td className="px-3 py-2.5 text-slate-800">{fmt(totals.retail)}</td>
      {isActualMode && (
        <td className="px-3 py-2.5 text-slate-600">{plActualDiscountRateDisplay(totals.tag, totals.retail)}</td>
      )}
      {showCogsRateCol && <td className="px-3 py-2.5 text-slate-400 border-l border-slate-200">—</td>}
      <td
        className={`px-3 py-2.5 text-slate-800 ${!showCogsRateCol ? "border-l border-slate-200" : ""}`}
      >
        {fmt(totals.cogs)}
      </td>
      <td className="px-3 py-2.5 text-slate-800 border-l border-slate-200">{fmt(totals.grossProfit)}</td>
      <td className={`px-3 py-2.5 ${gmr === null ? "text-slate-400" : "text-slate-800"}`}>
        {gmr === null ? "—" : fmtRate(gmr)}
      </td>
      <td
        className={`px-3 py-2.5 font-bold border-l border-slate-200 ${
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
      <td className={`px-3 py-2.5 border-l border-slate-200 ${c(totals.directCost)}`}>{f(totals.directCost)}</td>
      <td
        className={`px-3 py-2.5 tabular-nums ${cr === null ? "text-slate-400" : "text-slate-800"}`}
      >
        {cr === null ? "—" : fmtRate(cr)}
      </td>
      <td className={`px-3 py-2.5 border-l border-slate-200 text-slate-800 ${c(labor)}`}>{f(labor)}</td>
      {openGroups.labor && (
        <>
          {subTd(totals.salary)}
          {subTd(totals.bonus)}
        </>
      )}
      {showHeadcountCol && (
        <td
          className={`px-3 py-2.5 bg-slate-200 border-l border-slate-200 ${
            totals.headcount === 0 ? "text-slate-400" : "text-slate-700"
          }`}
        >
          {totals.headcount === 0 ? "—" : `${totals.headcount}명`}
        </td>
      )}
      {variant === "dealer" && (
        <td
          className={`px-3 py-2.5 bg-slate-200 ${
            (dealerTotalActiveStores ?? 0) > 0 && totals.headcount > 0 ? "text-slate-700" : "text-slate-400"
          }`}
        >
          {(dealerTotalActiveStores ?? 0) > 0 && totals.headcount > 0
            ? `${Math.ceil(totals.headcount / (dealerTotalActiveStores ?? 0))}명`
            : "—"}
        </td>
      )}
      <td className={`px-3 py-2.5 bg-slate-200 ${avgLaborCost === 0 ? "text-slate-400" : "text-slate-700"}`}>
        {avgLaborCost === 0 ? "—" : (avgLaborCost / 1000).toFixed(2)}
      </td>
      <td className={`px-3 py-2.5 border-l border-slate-200 text-slate-800 ${c(totals.insurance)}`}>
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

/**
 * City tier KPI 그룹 키 정규화 — 전각 숫자·NFKC·NBSP 제거로 동일 티어가 한 행으로 묶이게 함.
 * (표시·집계 키 동일)
 */
function normalizeCityTierKpiKey(raw: string | undefined | null): string {
  if (raw == null) return "";
  let s = raw.normalize("NFKC").replace(/\u00A0/g, " ").trim();
  if (!s) return "";
  s = s.replace(/[\uFF10-\uFF19]/g, (ch) =>
    String.fromCodePoint((ch.codePointAt(0) ?? 0xff10) - 0xff10 + 0x30),
  );
  return s.trim();
}

function cityTierKpiKeyFn(sc: string, pl: StorePL | null, dcMap: StoreDirectCostMap): string {
  const fromPl = normalizeCityTierKpiKey(pl?.cityTierNm);
  if (fromPl) return fromPl;
  const fromDc = normalizeCityTierKpiKey(dcMap[sc]?.cityTierNm);
  return fromDc || "미정";
}

/** City tier KPI 표 정렬: T0, T1, …(숫자 오름차순) → ^T\\d+$ 아닌 값(ONLINE, Tier1 등) → 미정 */
function compareCityTierKpi(a: { key: string }, b: { key: string }): number {
  const rank = (k: string): [number, number, string] => {
    const t = k.trim();
    if (t === "미정") return [2, 0, t];
    const m = /^T(\d+)$/i.exec(t);
    if (m) return [0, parseInt(m[1], 10), t];
    return [1, 0, t];
  };
  const [ra, na, sa] = rank(a.key);
  const [rb, nb, sb] = rank(b.key);
  if (ra !== rb) return ra - rb;
  if (ra === 0) {
    if (na !== nb) return na - nb;
    return sa.localeCompare(sb, undefined, { sensitivity: "base", numeric: true });
  }
  return sa.localeCompare(sb, undefined, { sensitivity: "base", numeric: true });
}

/** 매장 모달 상단 점당 KPI 표 (그룹별 동일 레이아웃) */
interface PlModalGroupKpiRow {
  key: string;
  count: number;
  perRetail: number;
  perGrossProfit: number;
  perDirectCost: number;
  perOperatingProfit: number;
}

function PlModalGroupKpiTable({
  title,
  groups,
  selectedMonth,
  footer,
}: {
  title: string;
  groups: PlModalGroupKpiRow[];
  selectedMonth: MonthOption;
  footer?: ReactNode;
}) {
  return (
    <div className="min-w-0 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-emerald-200/55 bg-[linear-gradient(180deg,#f0f7f4_0%,#d9e8e0_100%)] px-3 py-2">
        <p className="text-[12px] font-semibold leading-snug text-emerald-950/80">{title}</p>
      </div>
      <div className="min-w-0 overflow-x-auto px-3 py-2.5">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-100 text-[10px] font-semibold text-black">
            <th className="px-1 py-2 text-left">구분</th>
            <th className="px-1 py-2 text-right">점당매출</th>
            <th className="px-1 py-2 text-right">점당매출이익</th>
            <th className="px-1 py-2 text-right">이익%</th>
            <th className="px-1 py-2 text-right">점당직접비</th>
            <th className="px-1 py-2 text-right">직접비%</th>
            <th className="px-1 py-2 text-right">점당영업이익</th>
            <th className="px-1 py-2 text-right">영업%</th>
            {selectedMonth === "annual" && <th className="px-1 py-2 text-right">매장수</th>}
            <th className="px-1 py-2 text-right">
              {selectedMonth === "annual" ? "매장수(계산용)" : "매장수"}
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
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
                <td className="py-1 text-right text-slate-500 tabular-nums">{Math.round(g.count / 12)}개</td>
              )}
              <td className="py-1 text-right text-slate-400">{g.count}개</td>
            </tr>
          ))}
        </tbody>
      </table>
      {footer}
      </div>
    </div>
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
  retail2025Map?: Record<string, Record<number, number>> | null;
  actualStores?: RetailStoreRow[];
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
  actualStores,
}: StoreModalProps) {
  const isActualMode = isActualMonth(selectedMonth);
  const [selectedStoreCode, setSelectedStoreCode] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<OpenGroups>(DEFAULT_OPEN_GROUPS);
  const [storeTagDetailOpen, setStoreTagDetailOpen] = useState(false);
  const [storeCogsRateOpen, setStoreCogsRateOpen] = useState(false);
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
    setStoreTagDetailOpen(false);
    setStoreCogsRateOpen(false);
  }, [dealer.accountId]);

  const csvStores = storeRetailMap[brand]?.[dealer.accountId] ?? [];

  const storeRows = useMemo((): StorePL[] => {
    // 실적 모드: Snowflake 매장 배열 사용
    if (isActualMode && actualStores) {
      const m = (selectedMonth as { kind: "actual"; m: number }).m;
      return actualStores
        .filter((s) => (s.months_sale[String(m)] ?? 0) > 0)
        .map((s) => {
          const dc = storeDirectCostMap[s.storeCode];
          const retail     = s.months_sale[String(m)]        ?? 0;
          const tag        = s.months[String(m)]              ?? 0;
          const tagApparel = s.months_apparel?.[String(m)]    ?? 0;
          const tagAcc     = s.months_acc?.[String(m)]        ?? 0;
          const tagEtc     = s.months_etc?.[String(m)]        ?? 0;
          // 실적: 의류 42%, ACC 47%, 미정 42% 적용
          const cogsMixed =
            tagApparel * PL_CALC.apparelCogsRate +
            tagAcc     * PL_CALC.accCogsRate +
            tagEtc     * PL_CALC.apparelCogsRate;
          const cogs = cogsMixed / PL_CALC.retailVatFactor;
          // 가중평균 출고율 (출고율 열 표시용)
          const effectiveCogsRate = tag > 0 ? cogsMixed / tag : cogsRate;
          const grossProfit = retail / PL_CALC.retailVatFactor - cogs;

          let salary = 0, bonus = 0, headcount = 0, insurance = 0,
              rent = 0, rentFixed = 0, rentVariable = 0, depr = 0,
              marketing = 0, packaging = 0, payFee = 0, othersLine = 0;

          if (dc) {
            headcount = dc.headcount;
            const curYM = ym(m);
            const salM = dc.avgSalary * dc.headcount;
            const bonusM = retail * dc.bonusRate;
            const rf = rentFixedMonth(dc);
            const rv = rentVariableMonth(retail, dc);
            const oc = calcOtherCostsMonth(retail);
            salary = salM; bonus = bonusM;
            insurance = (salM + bonusM) * dc.insuranceRate;
            rent = Math.max(rf, rv); rentFixed = rf; rentVariable = rv;
            depr = calcDeprForMonthStoreModal(dc.interiorCost, dc.openMonth, dc.amortEndMonth, dc.closedMonth, curYM);
            marketing = oc.marketing; packaging = oc.packaging;
            payFee = oc.payFee; othersLine = oc.othersLine;
          }
          const directCost = salary + bonus + insurance + rent + depr + marketing + packaging + payFee + othersLine;
          return {
            storeCode: s.storeCode,
            storeName: s.shopNmEn?.trim() ? s.shopNmEn.trim() : s.storeCode,
            shopNmCn: s.shopNmCn?.trim() || undefined,
            cityTierNm: s.cityTierNm?.trim() || undefined,
            regionKr: s.regionKr?.trim() || undefined,
            actualStoreType: s.storeType?.trim() || undefined,
            actualTradeZone: s.tradeZone?.trim() || undefined,
            retail, tag, tagApparel, tagAcc, tagEtc, cogsRate: effectiveCogsRate, discountRate: 0,
            cogs, grossProfit, salary, bonus, headcount, insurance,
            rent, rentFixed, rentVariable, depr, directCost,
            operatingProfit: grossProfit - directCost,
            marketing, packaging, payFee, othersLine,
          };
        });
    }

    // 목표 모드: 기존 CSV 기반
    return csvStores
      .filter((s) => MONTHS.reduce((sum, m) => sum + (s.months[m] ?? 0), 0) > 0)
      .map((s) => {
        const dc = storeDirectCostMap[s.storeCode];
        const mNum = monthNum(selectedMonth);
        const retail = mNum === null
          ? MONTHS.reduce((sum, m) => sum + (s.months[m] ?? 0), 0)
          : (s.months[mNum] ?? 0);
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
          if (mNum === null) {
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
              rent += Math.max(rf, rv);
              rentFixed += rf;
              rentVariable += rv;
              depr += deprM;
              marketing += oc.marketing;
              packaging += oc.packaging;
              payFee += oc.payFee;
              othersLine += oc.othersLine;
            }
          } else {
            const m = mNum!;
            const curYM = ym(m);
            const retailM = s.months[m] ?? 0;
            salary = dc.avgSalary * dc.headcount;
            bonus = retailM * dc.bonusRate;
            insurance = (salary + bonus) * dc.insuranceRate;
            const rf = rentFixedMonth(dc);
            const rv = rentVariableMonth(retailM, dc);
            rent = Math.max(rf, rv);
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
          cityTierNm: dc?.cityTierNm?.trim() || undefined,
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
  }, [csvStores, actualStores, isActualMode, selectedMonth, cogsRate, storeDirectCostMap]);

  const sortedModalStoreRows = useMemo(() => {
    const rows = storeRows.filter((r) => r.retail > 0);
    const m = storeTableSortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (storeTableSortKey === "name") return m * a.storeName.localeCompare(b.storeName, "ko");
      if (storeTableSortKey === "retail") return m * (a.retail - b.retail);
      return m * (a.grossProfit - b.grossProfit);
    });
  }, [storeRows, storeTableSortKey, storeTableSortDir]);

  function buildGroupKpi(
    activeRetailStores: StoreRetailRow[],
    rows: StorePL[],
    month: MonthOption,
    dcMap: StoreDirectCostMap,
    keyFn: (storeCode: string, plRow: StorePL | null) => string,
    rowSort?: (a: PlModalGroupKpiRow, b: PlModalGroupKpiRow) => number,
  ): PlModalGroupKpiRow[] {
    const activeRetail = activeRetailStores.filter(
      (s) => MONTHS.reduce((sum, m) => sum + (s.months[m] ?? 0), 0) > 0,
    );

    const agg = new Map<string, { retail: number; grossProfit: number; directCost: number; operatingProfit: number }>();
    for (const row of rows.filter((r) => r.retail > 0)) {
      const key = keyFn(row.storeCode, row) || "미정";
      const cur = agg.get(key) ?? { retail: 0, grossProfit: 0, directCost: 0, operatingProfit: 0 };
      agg.set(key, {
        retail: cur.retail + row.retail,
        grossProfit: cur.grossProfit + row.grossProfit,
        directCost: cur.directCost + row.directCost,
        operatingProfit: cur.operatingProfit + row.operatingProfit,
      });
    }

    const denomByKey = new Map<string, number>();
    if (month === "annual" || month === "annual25") {
      for (const m of MONTHS) {
        for (const s of activeRetail) {
          if ((s.months[m] ?? 0) <= 0) continue;
          const key = keyFn(s.storeCode, null) || "미정";
          denomByKey.set(key, (denomByKey.get(key) ?? 0) + 1);
        }
      }
    } else {
      for (const row of rows.filter((r) => r.retail > 0)) {
        const key = keyFn(row.storeCode, row) || "미정";
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
        csvStores,
        storeRows,
        selectedMonth,
        storeDirectCostMap,
        (sc, pl) => pl?.actualStoreType?.trim() || storeDirectCostMap[sc]?.storeType?.trim() || "미정",
        compareStoreTypeKpi,
      ),
    [csvStores, storeRows, selectedMonth, storeDirectCostMap],
  );

  const tradeZoneKpi = useMemo(
    () =>
      buildGroupKpi(
        csvStores,
        storeRows,
        selectedMonth,
        storeDirectCostMap,
        (sc, pl) => pl?.actualTradeZone?.trim() || storeDirectCostMap[sc]?.tradeZone?.trim() || "미정",
        compareTradeZoneKpi,
      ),
    [csvStores, storeRows, selectedMonth, storeDirectCostMap],
  );

  const regionNmKpi = useMemo(
    () =>
      buildGroupKpi(csvStores, storeRows, selectedMonth, storeDirectCostMap, (sc, pl) => {
        const dc = storeDirectCostMap[sc];
        return pl?.regionKr?.trim() || dc?.regionNm?.trim() || "미정";
      }),
    [csvStores, storeRows, selectedMonth, storeDirectCostMap],
  );

  const cityTierKpi = useMemo(
    () =>
      buildGroupKpi(
        csvStores,
        storeRows,
        selectedMonth,
        storeDirectCostMap,
        (sc, pl) => cityTierKpiKeyFn(sc, pl, storeDirectCostMap),
        compareCityTierKpi,
      ),
    [csvStores, storeRows, selectedMonth, storeDirectCostMap],
  );

  /** region_nm별 city_nm 매장 수 상위 5개 — 참고 문구용 */
  const REGION_NOTE_TOP_CITIES = 5;
  const regionNmCityNoteSegments = useMemo(() => {
    const byRegion = new Map<string, Map<string, number>>();
    if (isActualMode && actualStores) {
      for (const row of storeRows) {
        if (row.retail <= 0) continue;
        const dc = storeDirectCostMap[row.storeCode];
        const r = row.regionKr?.trim() || dc?.regionNm?.trim() || "미정";
        const c = dc?.cityNm?.trim();
        if (!c) continue;
        if (!byRegion.has(r)) byRegion.set(r, new Map());
        const m = byRegion.get(r)!;
        m.set(c, (m.get(c) ?? 0) + 1);
      }
    } else {
      for (const s of csvStores) {
        const dc = storeDirectCostMap[s.storeCode];
        if (!dc) continue;
        const r = dc.regionNm?.trim() || "미정";
        const c = dc.cityNm?.trim();
        if (!c) continue;
        if (!byRegion.has(r)) byRegion.set(r, new Map());
        const m = byRegion.get(r)!;
        m.set(c, (m.get(c) ?? 0) + 1);
      }
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
  }, [
    isActualMode,
    actualStores,
    storeRows,
    csvStores,
    storeDirectCostMap,
    regionNmKpi,
  ]);

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

  const monthLabel =
    selectedMonth === "annual"
      ? "26년 연간목표"
      : isTargetMonth(selectedMonth)
      ? plMonthTargetLabel(selectedMonth.m)
      : isActualMonth(selectedMonth)
      ? plMonthActualLabel(selectedMonth.m)
      : "";

  /** PL 표 `▶ N개 매장`과 동일: 선택 기간 기준 리테일(V+) > 0 인 고유 매장 수 */
  const headerStoreCount = storeRows.filter((r) => r.retail > 0).length;

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
      : (retail2025Map[selectedRow.storeCode]?.[monthNum(selectedMonth) as number] ?? 0)
    : 0;
  const yoy = retail2025 > 0 && selectedRow
    ? (selectedRow.retail - retail2025) / retail2025
    : null;
  const yoyPct = retail2025 > 0 && selectedRow
    ? (selectedRow.retail / retail2025) * 100
    : null;

  const dealerNameLabel = dealerDisplayName(dealer.accountNameKr, dealer.accountNameEn);

  const modalBodyColSpan = useMemo(
    () => countStoreModalBodyCols(isActualMode, storeTagDetailOpen, storeCogsRateOpen, openGroups),
    [isActualMode, storeTagDetailOpen, storeCogsRateOpen, openGroups],
  );

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
            {dealerNameLabel && (
              <span
                className="text-sm font-bold text-slate-800 cursor-default"
                title={
                  dealer.accountNameKr.trim()
                    ? dealer.accountNameEn.trim() || undefined
                    : undefined
                }
              >
                {dealerNameLabel}
              </span>
            )}
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

        {/* 상단 KPI: 1열 Store Type + region_nm / 2열 Trade Zone / 3열 City tier */}
        <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div className="grid min-w-0 w-full grid-cols-3 gap-3">
            <div className="min-w-0 flex min-h-0 flex-col gap-3">
              <PlModalGroupKpiTable
                title="Store Type별 점당 지표"
                groups={storeTypeKpi}
                selectedMonth={selectedMonth}
              />
              <PlModalGroupKpiTable
                title="region_nm별 점당 지표"
                groups={regionNmKpi}
                selectedMonth={selectedMonth}
                footer={
                  regionNmCityNoteSegments.length > 0 ? (
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
                  ) : undefined
                }
              />
            </div>
            <PlModalGroupKpiTable
              title="Trade Zone별 점당 지표"
              groups={tradeZoneKpi}
              selectedMonth={selectedMonth}
            />
            <PlModalGroupKpiTable
              title="City tier별 점당 지표"
              groups={cityTierKpi}
              selectedMonth={selectedMonth}
            />
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
          <table className="min-w-full w-full table-fixed text-right text-xs">
            <PlTableColGroup
              variant="store"
              openGroups={openGroups}
              isActualMode={isActualMode}
              storeTagDetailOpen={storeTagDetailOpen}
              storeCogsRateOpen={storeCogsRateOpen}
            />
            <PLTableHead
              firstColLabel="매장코드 · 매장명"
              variant="store"
              openGroups={openGroups}
              onToggle={toggleGroup}
              cogsRateColumnLabel={
                isActualMonth(selectedMonth)
                  ? "가중출고율"
                  : "25년 출고율"
              }
              storeColumnSort={{
                sortKey: storeTableSortKey,
                sortDir: storeTableSortDir,
                onSort: onStoreTableSort,
              }}
              isActualMode={isActualMode}
              storeTagDetailOpen={storeTagDetailOpen}
              onStoreTagDetailToggle={() => setStoreTagDetailOpen((v) => !v)}
              storeCogsRateOpen={storeCogsRateOpen}
              onStoreCogsRateToggle={() => setStoreCogsRateOpen((v) => !v)}
            />
            {storeRows.length > 0 && (
              <tfoot className="sticky bottom-0 z-20">
                <TotalRow
                  totals={storeTotals}
                  variant="store"
                  selectedMonth={selectedMonth}
                  openGroups={openGroups}
                  isActualMode={isActualMode}
                  storeTagDetailOpen={storeTagDetailOpen}
                  storeCogsRateOpen={storeCogsRateOpen}
                />
              </tfoot>
            )}
            <tbody className="divide-y divide-slate-200">
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
                      {!isActualMode && row.shopNmCn ? (
                        <>
                          <span className="text-slate-300 mx-1">|</span>
                          <span className="text-slate-600 font-medium">{row.shopNmCn}</span>
                        </>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-slate-600 text-center whitespace-nowrap border-l border-slate-200">
                      {storeDirectCostMap[row.storeCode]?.storeType?.trim() || "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-600 text-center whitespace-nowrap">
                      {storeDirectCostMap[row.storeCode]?.tradeZone?.trim() || "—"}
                    </td>
                    {!isActualMode && (
                      <td className="px-3 py-2 text-slate-700 border-l border-slate-200">{fmt(row.tag)}</td>
                    )}
                    {isActualMode && (
                      <>
                        <td className="px-3 py-2 text-slate-700 border-l border-slate-200">{fmt(row.tag)}</td>
                        {storeTagDetailOpen && (
                          <>
                            <td className="px-3 py-2 text-slate-500">{row.tagApparel ? fmt(row.tagApparel) : "—"}</td>
                            <td className="px-3 py-2 text-slate-500">{row.tagAcc ? fmt(row.tagAcc) : "—"}</td>
                            <td className="px-3 py-2 text-slate-400">{row.tagEtc ? fmt(row.tagEtc) : "—"}</td>
                          </>
                        )}
                      </>
                    )}
                    <td className="px-3 py-2 text-slate-700">{fmt(row.retail)}</td>
                    {isActualMode && (
                      <td className="px-3 py-2 text-slate-600">{plActualDiscountRateDisplay(row.tag, row.retail)}</td>
                    )}
                    {(!isActualMode || storeCogsRateOpen) && (
                      <td className="px-3 py-2 text-slate-500 border-l border-slate-200">{fmtRate(row.cogsRate)}</td>
                    )}
                    <td
                      className={`px-3 py-2 text-slate-700 ${
                        isActualMode && !storeCogsRateOpen ? "border-l border-slate-200" : ""
                      }`}
                    >
                      {fmt(row.cogs)}
                    </td>
                    <td className="px-3 py-2 text-slate-700 border-l border-slate-200">{fmt(row.grossProfit)}</td>
                    <td className={`px-3 py-2 ${gmr === null ? "text-slate-300" : "text-slate-700"}`}>
                      {gmr === null ? "—" : fmtRate(gmr)}
                    </td>
                    <td
                      className={`px-3 py-2 font-semibold border-l border-slate-200 ${
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
                  </tr>
                );
              })}
              {storeRows.length === 0 && (
                <tr>
                  <td colSpan={1 + modalBodyColSpan} className="py-10 text-center text-slate-400 text-sm">
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
  actualCogsRateMap = null,
  accountNameMap,
  storeRetailMap = {},
  storeDirectCostMap = {},
  retailYoy2025Map = null,
  retailStore2026 = null,
}: Props) {
  const [selectedMonth, setSelectedMonth] = useState<MonthOption>("annual");
  const [selectedBrand, setSelectedBrand] = useState<string>("");
  const [modalDealer, setModalDealer] = useState<DealerPL | null>(null);
  const [calcLogicOpen, setCalcLogicOpen] = useState(false);
  const [dealerOpenGroups, setDealerOpenGroups] = useState<OpenGroups>(DEFAULT_OPEN_GROUPS);
  const [dealerCogsRateOpen, setDealerCogsRateOpen] = useState(false);
  const toggleDealerGroup = useCallback(
    (key: keyof OpenGroups) => setDealerOpenGroups((prev) => ({ ...prev, [key]: !prev[key] })),
    [],
  );

  const closeModal = useCallback(() => setModalDealer(null), []);

  const isActual = isActualMonth(selectedMonth);
  const is2025 = is2025Mode(selectedMonth);

  const actualMonthCount = useMemo(() => getActualMonthCount(retailStore2026), [retailStore2026]);
  const dropdownOptions = useMemo(() => buildDropdownOptions(actualMonthCount), [actualMonthCount]);

  const brands = useMemo(() => {
    return BRAND_ORDER.filter((b) => Object.keys(storeRetailMap[b] ?? {}).length > 0);
  }, [storeRetailMap]);

  const activeBrand = selectedBrand || brands[0] || "";

  const plMonthLabel = useMemo(() => {
    if (selectedMonth === "annual") return "26년 연간목표";
    if (selectedMonth === "annual25") return "25년 연간실적";
    if (isTargetMonth(selectedMonth)) return plMonthTargetLabel(selectedMonth.m);
    if (isActualMonth(selectedMonth)) return plMonthActualLabel(selectedMonth.m);
    if (isActual25Month(selectedMonth)) return `25.${String(selectedMonth.m).padStart(2, "0")}(실적)`;
    return "";
  }, [selectedMonth]);

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

  /** 실적 모드: brand → account_id → RetailStoreRow[] 맵 */
  const actualStoreMap = useMemo((): Record<string, RetailStoreRow[]> => {
    if (!isActual || !retailStore2026) return {};
    const accounts = retailStore2026.brands[activeBrand] ?? [];
    return Object.fromEntries(accounts.map((a) => [a.account_id, a.stores]));
  }, [isActual, retailStore2026, activeBrand]);

  const rows = useMemo((): DealerPL[] => {
    const brandCogsMap = cogsRateMap[activeBrand] ?? {};
    const globalAvg = cogsRateMap["평균"]?.["평균"] ?? 0.441;

    // ── 2025 실적 모드: retailYoy2025Map 기반, 목표 로직 동일 적용 ──
    if (is2025Mode(selectedMonth)) {
      const is25Annual = selectedMonth === "annual25";
      const m25 = isActual25Month(selectedMonth) ? selectedMonth.m : null;
      const brandStores = storeRetailMap[activeBrand] ?? {};
      return Object.entries(brandStores)
        .sort(([a], [b]) => a.localeCompare(b))
        .filter(([, st]) => {
          const months = is25Annual ? MONTHS : [m25!];
          return st.some((s) =>
            months.some((mm) => (retailYoy2025Map?.[s.storeCode]?.[mm] ?? 0) > 0)
          );
        })
        .map(([accountId, st]) => {
          const retail = st.reduce((sum, s) => {
            const v = is25Annual
              ? MONTHS.reduce((ms, mm) => ms + (retailYoy2025Map?.[s.storeCode]?.[mm] ?? 0), 0)
              : (retailYoy2025Map?.[s.storeCode]?.[m25!] ?? 0);
            return sum + v;
          }, 0);

          const tag = st.reduce((sum, s) => {
            const sr = is25Annual
              ? MONTHS.reduce((ms, mm) => ms + (retailYoy2025Map?.[s.storeCode]?.[mm] ?? 0), 0)
              : (retailYoy2025Map?.[s.storeCode]?.[m25!] ?? 0);
            return sum + calcTag(sr, s.discountRate);
          }, 0);

          const cogsRate = brandCogsMap[accountId] ?? globalAvg;
          const cogs = (tag * cogsRate) / PL_CALC.retailVatFactor;
          const grossProfit = retail / PL_CALC.retailVatFactor - cogs;

          let salary = 0, bonus = 0, headcount = 0, insurance = 0, rent = 0,
              depr = 0, marketing = 0, packaging = 0, payFee = 0, othersLine = 0;
          for (const s of st) {
            const dc = storeDirectCostMap[s.storeCode];
            if (!dc) continue;
            headcount += dc.headcount;
            if (is25Annual) {
              for (const mm of MONTHS) {
                const curYM = ym(mm, 2025);
                const retailM = retailYoy2025Map?.[s.storeCode]?.[mm] ?? 0;
                const salM = dc.avgSalary * dc.headcount;
                const bonusM = retailM * dc.bonusRate;
                const insM = (salM + bonusM) * dc.insuranceRate;
                const deprM = calcDeprForMonth(dc.interiorCost, dc.openMonth, dc.amortEndMonth, dc.closedMonth, curYM);
                const oc = calcOtherCostsMonth(retailM);
                salary += salM; bonus += bonusM; insurance += insM;
                rent += rentTotalMonth(retailM, dc); depr += deprM;
                marketing += oc.marketing; packaging += oc.packaging;
                payFee += oc.payFee; othersLine += oc.othersLine;
              }
            } else {
              const curYM = ym(m25!, 2025);
              const retailM = retailYoy2025Map?.[s.storeCode]?.[m25!] ?? 0;
              const salM = dc.avgSalary * dc.headcount;
              const bonusM = retailM * dc.bonusRate;
              const oc = calcOtherCostsMonth(retailM);
              salary += salM; bonus += bonusM;
              insurance += (salM + bonusM) * dc.insuranceRate;
              rent += rentTotalMonth(retailM, dc);
              depr += calcDeprForMonth(dc.interiorCost, dc.openMonth, dc.amortEndMonth, dc.closedMonth, curYM);
              marketing += oc.marketing; packaging += oc.packaging;
              payFee += oc.payFee; othersLine += oc.othersLine;
            }
          }
          const directCost = salary + bonus + insurance + rent + depr + marketing + packaging + payFee + othersLine;
          return {
            accountId,
            accountNameKr: accountNameMap[accountId]?.account_nm_kr ?? "",
            accountNameEn: accountNameMap[accountId]?.account_nm_en ?? "",
            retail, tag, cogsRate, cogs, grossProfit,
            salary, bonus, headcount, insurance, rent, depr,
            marketing, packaging, payFee, othersLine, directCost,
            operatingProfit: grossProfit - directCost,
          };
        });
    }

    if (isActual) {
      // ── 실적 모드: Snowflake 기반 매장 배열만 사용 (CSV 금지) ──
      const actualBrandMap = actualCogsRateMap?.[activeBrand] ?? {};
      const actualBrandAvg = actualCogsRateMap?.[activeBrand]?.["평균"] ?? {};

      return Object.entries(actualStoreMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .filter(([, stores]) => {
          const m = (selectedMonth as { kind: "actual"; m: number }).m;
          return stores.some((s) => (s.months_sale[String(m)] ?? 0) > 0);
        })
        .map(([accountId, stores]) => {
          const m = (selectedMonth as { kind: "actual"; m: number }).m;
          let tag = 0, retail = 0, tagApparel = 0, tagAcc = 0, tagEtc = 0;
          for (const s of stores) {
            tag        += s.months[String(m)]               ?? 0;
            retail     += s.months_sale[String(m)]          ?? 0;
            tagApparel += s.months_apparel?.[String(m)]     ?? 0;
            tagAcc     += s.months_acc?.[String(m)]         ?? 0;
            tagEtc     += s.months_etc?.[String(m)]         ?? 0;
          }

          // 실적: 매장별 합산과 동일한 가중평균 공식 적용
          const cogsMixed =
            tagApparel * PL_CALC.apparelCogsRate +
            tagAcc     * PL_CALC.accCogsRate +
            tagEtc     * PL_CALC.apparelCogsRate;
          const cogs = cogsMixed / PL_CALC.retailVatFactor;
          const cogsRate = tag > 0 ? cogsMixed / tag : 0;
          const grossProfit = retail / PL_CALC.retailVatFactor - cogs;

          let salary = 0, bonus = 0, headcount = 0, insurance = 0, rent = 0,
              depr = 0, marketing = 0, packaging = 0, payFee = 0, othersLine = 0;

          for (const s of stores) {
            const dc = storeDirectCostMap[s.storeCode];
            if (!dc) continue;
            const retailM = s.months_sale[String(m)] ?? 0;
            const curYM = ym(m);
            headcount += dc.headcount;
            const salM = dc.avgSalary * dc.headcount;
            const bonusM = retailM * dc.bonusRate;
            const oc = calcOtherCostsMonth(retailM);
            salary += salM;
            bonus += bonusM;
            insurance += (salM + bonusM) * dc.insuranceRate;
            rent += rentTotalMonth(retailM, dc);
            depr += calcDeprForMonth(dc.interiorCost, dc.openMonth, dc.amortEndMonth, dc.closedMonth, curYM);
            marketing += oc.marketing;
            packaging += oc.packaging;
            payFee += oc.payFee;
            othersLine += oc.othersLine;
          }
          const directCost = salary + bonus + insurance + rent + depr + marketing + packaging + payFee + othersLine;
          return {
            accountId,
            accountNameKr: accountNameMap[accountId]?.account_nm_kr ?? "",
            accountNameEn: accountNameMap[accountId]?.account_nm_en ?? "",
            retail, tag, cogsRate, cogs, grossProfit,
            salary, bonus, headcount, insurance, rent, depr,
            marketing, packaging, payFee, othersLine, directCost,
            operatingProfit: grossProfit - directCost,
          };
        });
    }

    // ── 목표 모드: 기존 CSV 기반 로직 ──
    const brandStores = storeRetailMap[activeBrand] ?? {};
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
        const m = monthNum(selectedMonth);
        const retail = st.reduce((sum, s) => {
          const v = m === null
            ? MONTHS.reduce((ms, mm) => ms + (s.months[mm] ?? 0), 0)
            : (s.months[m] ?? 0);
          return sum + v;
        }, 0);

        const tag = st.reduce((sum, s) => {
          const sr = m === null
            ? MONTHS.reduce((ms, mm) => ms + (s.months[mm] ?? 0), 0)
            : (s.months[m] ?? 0);
          return sum + calcTag(sr, s.discountRate);
        }, 0);

        const cogsRate = brandCogsMap[accountId] ?? globalAvg;
        const cogs = (tag * cogsRate) / PL_CALC.retailVatFactor;
        const grossProfit = retail / PL_CALC.retailVatFactor - cogs;

        let salary = 0, bonus = 0, headcount = 0, insurance = 0, rent = 0,
            depr = 0, marketing = 0, packaging = 0, payFee = 0, othersLine = 0;
        for (const s of st) {
          const dc = storeDirectCostMap[s.storeCode];
          if (!dc) continue;
          headcount += dc.headcount;
          if (m === null) {
            for (const mm of MONTHS) {
              const curYM = ym(mm);
              const retailM = s.months[mm] ?? 0;
              const salM = dc.avgSalary * dc.headcount;
              const bonusM = retailM * dc.bonusRate;
              const insM = (salM + bonusM) * dc.insuranceRate;
              const deprM = calcDeprForMonth(dc.interiorCost, dc.openMonth, dc.amortEndMonth, dc.closedMonth, curYM);
              const oc = calcOtherCostsMonth(retailM);
              salary += salM; bonus += bonusM; insurance += insM;
              rent += rentTotalMonth(retailM, dc); depr += deprM;
              marketing += oc.marketing; packaging += oc.packaging;
              payFee += oc.payFee; othersLine += oc.othersLine;
            }
          } else {
            const curYM = ym(m);
            const retailM = s.months[m] ?? 0;
            const salM = dc.avgSalary * dc.headcount;
            const bonusM = retailM * dc.bonusRate;
            const oc = calcOtherCostsMonth(retailM);
            salary += salM; bonus += bonusM;
            insurance += (salM + bonusM) * dc.insuranceRate;
            rent += rentTotalMonth(retailM, dc);
            depr += calcDeprForMonth(dc.interiorCost, dc.openMonth, dc.amortEndMonth, dc.closedMonth, curYM);
            marketing += oc.marketing; packaging += oc.packaging;
            payFee += oc.payFee; othersLine += oc.othersLine;
          }
        }
        const directCost = salary + bonus + insurance + rent + depr + marketing + packaging + payFee + othersLine;
        return {
          accountId,
          accountNameKr: accountNameMap[accountId]?.account_nm_kr ?? "",
          accountNameEn: accountNameMap[accountId]?.account_nm_en ?? "",
          retail, tag, cogsRate, cogs, grossProfit,
          salary, bonus, headcount, insurance, rent, depr,
          marketing, packaging, payFee, othersLine, directCost,
          operatingProfit: grossProfit - directCost,
        };
      });
  }, [storeRetailMap, actualStoreMap, isActual, activeBrand, selectedMonth, cogsRateMap, actualCogsRateMap, accountNameMap, storeDirectCostMap, retailYoy2025Map]);

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

  /** 대리상 표 합계용: 각 행과 동일 기준 활성 매장 수 합 */
  const dealerTotalActiveStores = useMemo(() => {
    if (rows.length === 0) return 0;
    if (isActual) {
      const m = (selectedMonth as { kind: "actual"; m: number }).m;
      return rows.reduce(
        (sum, r) => sum + countActiveActualStores(actualStoreMap[r.accountId] ?? [], m),
        0,
      );
    }
    return rows.reduce(
      (sum, r) =>
        sum +
        countActiveStoresForPeriod(storeRetailMap[activeBrand]?.[r.accountId] ?? [], selectedMonth),
      0,
    );
  }, [rows, isActual, selectedMonth, actualStoreMap, storeRetailMap, activeBrand]);

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
            value={optionKey(selectedMonth)}
            onChange={(e) => setSelectedMonth(parseOptionKey(e.target.value))}
            className={`rounded-lg border px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 ${
              isActual
                ? "border-blue-300 bg-blue-50 font-bold text-blue-700 focus:ring-blue-300"
                : is2025
                  ? "border-purple-300 bg-purple-50 font-bold text-purple-700 focus:ring-purple-300"
                  : "border-slate-200 bg-white font-normal text-black focus:ring-blue-300"
            }`}
          >
            {dropdownOptions.map((o) => (
              <option
                key={optionKey(o.value)}
                value={optionKey(o.value)}
                style={
                  o.isActual
                    ? { color: "#1d4ed8", fontWeight: 700 }
                    : o.is2025
                      ? { color: "#7e22ce", fontWeight: 700 }
                      : { color: "#000000", fontWeight: 400 }
                }
              >
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {isActual && (
          <div className="rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-2.5 text-[11px] text-slate-600 leading-relaxed">
            <span className="font-semibold text-blue-700">[실적]</span>{" "}
            Tag = Snowflake <code className="text-[10px] bg-blue-100 px-0.5 rounded">tag_amt</code> 집계 ·
            리테일(V+) = <code className="text-[10px] bg-blue-100 px-0.5 rounded">sale_amt</code> 집계 (할인율 역산 없음).{" "}
            직접비는 FR수익구조 등록 매장(<code className="text-[10px] bg-blue-100 px-0.5 rounded">shop_id</code>)만 반영 —
            미등록 매장은 직접비 0으로 비용률이 실제보다 낮게 표시될 수 있습니다.
          </div>
        )}
        {is2025 && (
          <div className="rounded-lg border border-purple-100 bg-purple-50/60 px-4 py-2.5 text-[11px] text-slate-600 leading-relaxed">
            <span className="font-semibold text-purple-700">[2025 실적]</span>{" "}
            리테일(V+) = retail_yoy_2025.json 매장별 실적 집계.{" "}
            매출원가는 26년 목표와 동일하게 CSV 출고율(cogsRateMap) 적용.{" "}
            직접비는 FR수익구조 등록 매장만 반영 — 미등록 매장은 직접비 0. 매장 모달은 제공되지 않습니다.
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full w-full table-fixed text-right text-xs">
            <PlTableColGroup
              variant="dealer"
              openGroups={dealerOpenGroups}
              isActualMode={isActual}
              dealerCogsRateOpen={dealerCogsRateOpen}
            />
            <PLTableHead
              firstColLabel="대리상명"
              variant="dealer"
              openGroups={dealerOpenGroups}
              onToggle={toggleDealerGroup}
              cogsRateColumnLabel={
                isActualMonth(selectedMonth)
                  ? plActualMonthCogsRateLabel(selectedMonth.m)
                  : "25년 출고율"
              }
              dealerCogsRateOpen={dealerCogsRateOpen}
              onDealerCogsRateToggle={() => setDealerCogsRateOpen((v) => !v)}
              isActualMode={isActual}
            />
            <tbody className="divide-y divide-slate-200">
              {rows.length > 0 && (
                <TotalRow
                  totals={totals}
                  variant="dealer"
                  selectedMonth={selectedMonth}
                  openGroups={dealerOpenGroups}
                  dealerTotalActiveStores={dealerTotalActiveStores}
                  dealerCogsRateOpen={dealerCogsRateOpen}
                  isActualMode={isActual}
                />
              )}
              {rows.map((row, i) => {
                const gmr = plGrossMarginRate(row.retail, row.grossProfit);
                const rowNameLabel = dealerDisplayName(row.accountNameKr, row.accountNameEn);
                const activeStoreCount = isActual
                  ? countActiveActualStores(
                      actualStoreMap[row.accountId] ?? [],
                      (selectedMonth as { kind: "actual"; m: number }).m,
                    )
                  : is2025
                    ? (() => {
                        const m25 = isActual25Month(selectedMonth) ? selectedMonth.m : null;
                        const st = storeRetailMap[activeBrand]?.[row.accountId] ?? [];
                        return st.filter((s) => {
                          const v = m25 === null
                            ? MONTHS.some((mm) => (retailYoy2025Map?.[s.storeCode]?.[mm] ?? 0) > 0)
                            : (retailYoy2025Map?.[s.storeCode]?.[m25] ?? 0) > 0;
                          return v;
                        }).length;
                      })()
                    : countActiveStoresForPeriod(
                        storeRetailMap[activeBrand]?.[row.accountId] ?? [],
                        selectedMonth,
                      );
                return (
                  <tr
                    key={row.accountId}
                    role={is2025 ? undefined : "button"}
                    tabIndex={is2025 ? undefined : 0}
                    onClick={is2025 ? undefined : () => setModalDealer(row)}
                    onKeyDown={is2025 ? undefined : (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setModalDealer(row);
                      }
                    }}
                    className={`transition-colors ${
                      is2025
                        ? i % 2 === 0 ? "bg-white" : "bg-slate-50/50"
                        : `cursor-pointer ${i % 2 === 0 ? "bg-white hover:bg-blue-50/60" : "bg-slate-50/50 hover:bg-blue-50/60"}`
                    }`}
                  >
                    <td className="sticky left-0 z-10 bg-inherit px-3 py-2 text-left whitespace-nowrap">
                      <span className="text-slate-400 mr-1 text-[10px]">({row.accountId})</span>
                      {rowNameLabel && (
                        <span
                          className="text-slate-700 font-medium cursor-default"
                          title={
                            row.accountNameKr.trim()
                              ? row.accountNameEn.trim() || undefined
                              : undefined
                          }
                        >
                          {rowNameLabel}
                        </span>
                      )}
                      {activeStoreCount > 0 && (
                        <span className="ml-2 text-[10px] text-blue-400">
                          ▶ {activeStoreCount}개 매장
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700 border-l border-slate-200">{fmt(row.tag)}</td>
                    <td className="px-3 py-2 text-slate-700">{fmt(row.retail)}</td>
                    {isActual && (
                      <td className="px-3 py-2 text-slate-600">{plActualDiscountRateDisplay(row.tag, row.retail)}</td>
                    )}
                    {dealerCogsRateOpen && (
                      <td className="px-3 py-2 text-slate-500 border-l border-slate-200">{fmtRate(row.cogsRate)}</td>
                    )}
                    <td
                      className={`px-3 py-2 text-slate-700 ${!dealerCogsRateOpen ? "border-l border-slate-200" : ""}`}
                    >
                      {fmt(row.cogs)}
                    </td>
                    <td className="px-3 py-2 text-slate-700 border-l border-slate-200">{fmt(row.grossProfit)}</td>
                    <td className={`px-3 py-2 ${gmr === null ? "text-slate-300" : "text-slate-700"}`}>
                      {gmr === null ? "—" : fmtRate(gmr)}
                    </td>
                    <td
                      className={`px-3 py-2 font-semibold border-l border-slate-200 ${
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
                      activeStoreCount={activeStoreCount}
                      showHeadcountCol={dealerOpenGroups.labor}
                    />
                  </tr>
                );
              })}
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
          actualStores={isActual ? (actualStoreMap[modalDealer.accountId] ?? []) : undefined}
        />
      )}

      <PlCalcLogicModal open={calcLogicOpen} onClose={() => setCalcLogicOpen(false)} ctx={plLegendCtx} />
    </>
  );
}
