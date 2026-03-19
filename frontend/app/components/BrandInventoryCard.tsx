"use client";

import { useState, useMemo, useEffect, Fragment } from "react";
import { AccountRow, BrandKey, StockData, RetailData, InboundData, AppOtbData, MONTHS } from "../../lib/types";
import { fmtAmt } from "../../lib/utils";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";

// ─── 시즌 정렬 헬퍼 ──────────────────────────────────
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

const ACC_ORDER = ["신발", "모자", "가방", "기타"] as const;

const DEFAULT_TARGET_WEEKS: Record<string, number> = {
  신발: 30,
  모자: 20,
  가방: 25,
  기타: 39,
};

// ─── 집계 타입 ────────────────────────────────────────
interface RowData {
  base: number;
  sales: number;
}

interface YearGroup {
  label: string;
  data: RowData;
  seasons: { season: string; data: RowData }[];
}

interface InventoryRows {
  total: RowData;
  apparel: RowData;
  apparelCurrent: { season: string; data: RowData }[];
  apparelYearGroups: YearGroup[];
  apparelOld: RowData | null;
  acc: RowData;
  accItems: { item: string; data: RowData }[];
}

// ─── 3개 표(stock, retail, inbound) 대리상 합집합 ─────────────────
function mergeAccounts(
  brand: BrandKey,
  stock: StockData | null,
  retail: RetailData | null,
  inbound: InboundData | null
): AccountRow[] {
  const accIds = new Set<string>();
  const stockAccs = stock?.brands[brand] ?? [];
  const retailAccs = retail?.brands[brand] ?? [];
  const inboundAccs = inbound?.brands[brand] ?? [];
  stockAccs.forEach((a) => accIds.add(a.account_id));
  retailAccs.forEach((a) => accIds.add(a.account_id));
  inboundAccs.forEach((a) => accIds.add(a.account_id));

  const stockMap = new Map(stockAccs.map((a) => [a.account_id, a]));
  const retailMap = new Map(retailAccs.map((a) => [a.account_id, a]));
  const inboundMap = new Map(inboundAccs.map((a) => [a.account_id, a]));

  return Array.from(accIds)
    .sort()
    .map((id) => {
      const s = stockMap.get(id);
      if (s) return s;
      const r = retailMap.get(id);
      const i = inboundMap.get(id);
      const src = r ?? i;
      if (!src) return null;
      return {
        account_id: src.account_id,
        account_nm_en: src.account_nm_en ?? "",
        base_stock: 0,
        months: {} as Record<number, number>,
        categories: src.categories ?? [],
      } as AccountRow;
    })
    .filter((a): a is AccountRow => a !== null);
}

// ─── buildRows ───────────────────────────────────────
function buildRows(
  brand: BrandKey,
  stock: StockData | null,
  stockPrev: StockData | null,
  retail: RetailData | null,
  selectedAccId: string,
  allAccsOverride?: AccountRow[]
): InventoryRows {
  const empty: RowData = { base: 0, sales: 0 };
  const allAccs = allAccsOverride ?? (stock?.brands[brand] ?? []);
  if (allAccs.length === 0 && !stock) {
    return { total: empty, apparel: empty, apparelCurrent: [], apparelYearGroups: [], apparelOld: null, acc: empty, accItems: [] };
  }

  const stockYear = stock?.year ?? retail?.year ?? "2026";
  const is2026 = stockYear === "2026";
  const filteredAccs = selectedAccId === "all"
    ? allAccs
    : allAccs.filter((a) => a.account_id === selectedAccId);

  const prevAccs = stockPrev?.brands[brand] ?? [];
  const retailAccs = retail?.brands[brand] ?? [];

  // 시즌 수집 ("과시즌" 레이블 제외)
  const seasonSet = new Set<string>();
  for (const acc of filteredAccs) {
    for (const cat of acc.categories ?? []) {
      if (cat.대분류 !== "의류") continue;
      for (const sub of cat.subcategories) {
        if (sub.중분류 !== "과시즌") seasonSet.add(sub.중분류);
      }
    }
  }

  const yy = parseInt(stockYear.slice(2));

  function seasonYear(s: string): number { return parseInt(s.slice(0, 2)); }

  const currentSeasons = Array.from(seasonSet)
    .filter((s) => { const y = seasonYear(s); return !isNaN(y) && y >= yy; })
    .sort(cmpSesn);
  const group1Seasons = Array.from(seasonSet)
    .filter((s) => seasonYear(s) === yy - 1)
    .sort(cmpSesn);
  const group2Seasons = Array.from(seasonSet)
    .filter((s) => seasonYear(s) === yy - 2)
    .sort(cmpSesn);
  const oldSeasons = Array.from(seasonSet)
    .filter((s) => { const y = seasonYear(s); return !isNaN(y) && y < yy - 2; });

  // 합산 헬퍼
  function sumBase(accs: typeof allAccs, catKey: string, subKey: string | null): number {
    let s = 0;
    const srcAccs = is2026 ? prevAccs : accs;
    for (const acc of accs) {
      const srcAcc = srcAccs.find((a) => a.account_id === acc.account_id) ?? acc;
      for (const cat of srcAcc.categories ?? []) {
        if (cat.대분류 !== catKey) continue;
        if (subKey === null) {
          s += is2026 ? (cat.months[12] ?? 0) : (cat.base_stock ?? 0);
        } else {
          for (const sub of cat.subcategories) {
            if (sub.중분류 !== subKey) continue;
            s += is2026 ? (sub.months[12] ?? 0) : (sub.base_stock ?? 0);
          }
        }
      }
    }
    return s;
  }

  function sumSales(catKey: string, subKey: string | null): number {
    let s = 0;
    for (const acc of filteredAccs) {
      const rAcc = retailAccs.find((r) => r.account_id === acc.account_id);
      if (!rAcc) continue;
      for (const cat of rAcc.categories ?? []) {
        if (cat.대분류 !== catKey) continue;
        if (subKey === null) {
          s += MONTHS.reduce((sum, m) => sum + (cat.months[m] ?? 0), 0);
        } else {
          for (const sub of cat.subcategories) {
            if (sub.중분류 !== subKey) continue;
            s += MONTHS.reduce((sum, m) => sum + (sub.months[m] ?? 0), 0);
          }
        }
      }
    }
    return s;
  }

  function sumBaseAccount(): number {
    let s = 0;
    const srcAccs = is2026 ? prevAccs : allAccs;
    for (const acc of filteredAccs) {
      const srcAcc = srcAccs.find((a) => a.account_id === acc.account_id);
      s += is2026 ? (srcAcc?.months[12] ?? 0) : (srcAcc?.base_stock ?? acc.base_stock ?? 0);
    }
    return s;
  }

  function sumSalesAccount(): number {
    let s = 0;
    for (const acc of filteredAccs) {
      const rAcc = retailAccs.find((r) => r.account_id === acc.account_id);
      s += rAcc ? MONTHS.reduce((sum, m) => sum + (rAcc.months[m] ?? 0), 0) : 0;
    }
    return s;
  }

  function groupData(seasons: string[]): RowData {
    return {
      base: seasons.reduce((s, sn) => s + sumBase(filteredAccs, "의류", sn), 0),
      sales: seasons.reduce((s, sn) => s + sumSales("의류", sn), 0),
    };
  }

  // 과시즌 = 개별 old 시즌 합산 + JSON에 이미 "과시즌"으로 저장된 행
  const oldBase = oldSeasons.reduce((s, sn) => s + sumBase(filteredAccs, "의류", sn), 0)
    + sumBase(filteredAccs, "의류", "과시즌");
  const oldSales = oldSeasons.reduce((s, sn) => s + sumSales("의류", sn), 0)
    + sumSales("의류", "과시즌");
  const hasOld = oldBase !== 0 || oldSales !== 0;

  // 연차 그룹 (데이터 있는 것만 포함)
  const yearGroups: YearGroup[] = [];
  if (group1Seasons.length > 0) {
    yearGroups.push({
      label: "1년차",
      data: groupData(group1Seasons),
      seasons: group1Seasons.map((s) => ({
        season: s,
        data: { base: sumBase(filteredAccs, "의류", s), sales: sumSales("의류", s) },
      })),
    });
  }
  if (group2Seasons.length > 0) {
    yearGroups.push({
      label: "2년차",
      data: groupData(group2Seasons),
      seasons: group2Seasons.map((s) => ({
        season: s,
        data: { base: sumBase(filteredAccs, "의류", s), sales: sumSales("의류", s) },
      })),
    });
  }

  return {
    total: { base: sumBaseAccount(), sales: sumSalesAccount() },
    apparel: { base: sumBase(filteredAccs, "의류", null), sales: sumSales("의류", null) },
    apparelCurrent: currentSeasons.map((s) => ({
      season: s,
      data: { base: sumBase(filteredAccs, "의류", s), sales: sumSales("의류", s) },
    })),
    apparelYearGroups: yearGroups,
    apparelOld: hasOld ? { base: oldBase, sales: oldSales } : null,
    acc: { base: sumBase(filteredAccs, "ACC", null), sales: sumSales("ACC", null) },
    accItems: ACC_ORDER.map((item) => ({
      item,
      data: { base: sumBase(filteredAccs, "ACC", item), sales: sumSales("ACC", item) },
    })),
  };
}

// ─── Props ────────────────────────────────────────────
interface Props {
  brand: BrandKey;
  stock: StockData | null;
  stockPrev: StockData | null;
  retail: RetailData | null;
  inbound?: InboundData | null;
  inboundPrev?: InboundData | null;
  retailPrev?: RetailData | null;
  year: string;
  appOtb?: AppOtbData | null;
  onMetricsChange?: (brand: string, m: { purchase: number; sales: number; ending: number; prevEnding?: number; prevInbound?: number; prevRetail?: number }) => void;
}

// ─── 셀 헬퍼 ─────────────────────────────────────────
function Num({ v }: { v: number }) {
  return <span className="tabular-nums">{fmtAmt(v)}</span>;
}
function Dash() {
  return <span className="text-slate-300">—</span>;
}

// ─── 메인 컴포넌트 ─────────────────────────────────────
export default function BrandInventoryCard({ brand, stock, stockPrev, retail, inbound, inboundPrev, retailPrev, year, appOtb, onMetricsChange }: Props) {
  const [open, setOpen] = useState(true);
  const [selectedAccId, setSelectedAccId] = useState("all");
  const [open1, setOpen1] = useState(false);
  const [open2, setOpen2] = useState(false);
  const [targetWeeks, setTargetWeeks] = useState<Record<string, number>>(DEFAULT_TARGET_WEEKS);

  const mergedAccounts = useMemo(
    () => mergeAccounts(brand, stock, retail, inbound ?? null),
    [brand, stock, retail, inbound]
  );
  const accounts = mergedAccounts;

  const rows = useMemo(
    () => buildRows(brand, stock, stockPrev, retail, selectedAccId, mergedAccounts),
    [brand, stock, stockPrev, retail, selectedAccId, mergedAccounts]
  );

  // ─── 재고자산표 집계 (KeyMetricsTable 연동 + 기말재고 계산 공유) ────
  const inventoryMetrics = useMemo(() => {
    const OTB_SEASONS_M = new Set(["26S", "26F", "27S", "27F"]);
    const is2026 = year === "2026";
    const is2025 = year === "2025";
    const canCalc2026 = appOtb && is2026;
    const useInbound2025 = inbound && is2025;

    // 2025: sumInbound 헬퍼 (선택 대리상 기준)
    function sumInbound2025(catKey: string, subKey: string | null): number {
      if (!inbound) return 0;
      const filtered = selectedAccId === "all" ? mergedAccounts : mergedAccounts.filter((a) => a.account_id === selectedAccId);
      const accIds = new Set(filtered.map((a) => a.account_id));
      let s = 0;
      for (const acc of (inbound.brands[brand] ?? []).filter((a) => accIds.has(a.account_id))) {
        for (const cat of acc.categories ?? []) {
          if (cat.대분류 !== catKey) continue;
          if (subKey === null) {
            s += MONTHS.reduce((sum, m) => sum + (cat.months[m] ?? 0), 0);
          } else {
            const sub = cat.subcategories?.find((x) => x.중분류 === subKey);
            if (sub) s += MONTHS.reduce((sum, m) => sum + (sub.months[m] ?? 0), 0);
          }
        }
      }
      return s;
    }

    // 2026: OTB 기반 계산
    function getOtbAmt(sesn: string): number {
      if (!canCalc2026 || !OTB_SEASONS_M.has(sesn)) return 0;
      const accs = appOtb!.brands[brand] ?? [];
      const raw = selectedAccId === "all"
        ? accs.reduce((s, a) => s + (a.seasons[sesn]?.otb ?? 0), 0)
        : (accs.find((a) => a.account_id === selectedAccId)?.seasons[sesn]?.otb ?? 0);
      return raw * 1000;
    }
    function sesPurchase(season: string, base: number): number {
      if (!OTB_SEASONS_M.has(season)) return 0;
      return getOtbAmt(season) - base;
    }

    let currentPurch: { season: string; purchase: number }[];
    let yearGroupPurch: { label: string; groupSum: number; seasonPurchases: { season: string; purchase: number }[] }[];
    let apparelPurch: number;
    let apparelOldPurch: number;
    let accCalcItems: { item: string; data: RowData; ending: number; purch: number }[];

    if (useInbound2025) {
      // 2025: 의류·ACC 모두 입고물량(inbound) 기반, 기말 = 기초 + 매입 − 판매
      currentPurch = rows.apparelCurrent.map(({ season }) => ({
        season,
        purchase: sumInbound2025("의류", season),
      }));
      yearGroupPurch = rows.apparelYearGroups.map((grp) => {
        const sps = grp.seasons.map(({ season }) => ({
          season,
          purchase: sumInbound2025("의류", season),
        }));
        return { label: grp.label, groupSum: sps.reduce((s, sp) => s + sp.purchase, 0), seasonPurchases: sps };
      });
      apparelPurch = sumInbound2025("의류", null);
      apparelOldPurch = rows.apparelOld ? sumInbound2025("의류", "과시즌") : 0;
      accCalcItems = rows.accItems.map(({ item, data }) => {
        const purch = sumInbound2025("ACC", item);
        const ending = data.base + purch - data.sales;
        return { item, data, ending, purch };
      });
    } else {
      // 2026: 기존 OTB / 목표재고주수 로직
      currentPurch = rows.apparelCurrent.map(({ season, data }) => ({
        season,
        purchase: canCalc2026 ? sesPurchase(season, data.base) : 0,
      }));
      yearGroupPurch = rows.apparelYearGroups.map((grp) => {
        const sps = grp.seasons.map(({ season, data }) => ({
          season,
          purchase: canCalc2026 ? sesPurchase(season, data.base) : 0,
        }));
        return { label: grp.label, groupSum: sps.reduce((s, sp) => s + sp.purchase, 0), seasonPurchases: sps };
      });
      apparelPurch = canCalc2026
        ? currentPurch.reduce((s, sp) => s + sp.purchase, 0) + yearGroupPurch.reduce((s, gp) => s + gp.groupSum, 0)
        : 0;
      apparelOldPurch = 0; // 2026 과시즌 매입=0
      accCalcItems = rows.accItems.map(({ item, data }) => {
        const weeklySales = (data.sales / 365) * 7;
        const ending = Math.round(weeklySales * (targetWeeks[item] ?? 0));
        const purch = ending - data.base + data.sales;
        return { item, data, ending, purch };
      });
    }

    const accEndingTotal = accCalcItems.reduce((s, r) => s + r.ending, 0);
    const accPurchTotal = accCalcItems.reduce((s, r) => s + r.purch, 0);
    const apparelEnding = rows.apparel.base + apparelPurch - rows.apparel.sales;

    // 2026년일 때 전년(2025) 12월 재고 = 선택 대리상 기준 (YOY 대응)
    const prevEnding = year === "2026" ? rows.total.base : undefined;

    // 2026년일 때 전년 입고·리테일 = 선택 대리상 기준 (YOY 대응)
    let prevInbound: number | undefined;
    let prevRetail: number | undefined;
    if (year === "2026") {
      const filteredAccs = selectedAccId === "all" ? mergedAccounts : mergedAccounts.filter((a) => a.account_id === selectedAccId);
      const filteredAccIds = new Set(filteredAccs.map((a) => a.account_id));

      prevInbound = inboundPrev
        ? (inboundPrev.brands[brand] ?? []).filter((acc) => filteredAccIds.has(acc.account_id)).reduce(
            (s, acc) => s + MONTHS.reduce((ms, m) => ms + (acc.months[m] ?? 0), 0),
            0
          )
        : undefined;
      prevRetail = retailPrev
        ? (retailPrev.brands[brand] ?? []).filter((acc) => filteredAccIds.has(acc.account_id)).reduce(
            (s, acc) => s + MONTHS.reduce((ms, m) => ms + (acc.months[m] ?? 0), 0),
            0
          )
        : undefined;
    }

    return {
      purchase: (canCalc2026 ? apparelPurch : useInbound2025 ? apparelPurch : 0) + accPurchTotal,
      sales: rows.total.sales,
      ending: apparelEnding + accEndingTotal,
      prevEnding,
      prevInbound,
      prevRetail,
      // 렌더 IIFE에서도 사용할 세부값
      apparelPurch: canCalc2026 ? apparelPurch : (useInbound2025 ? apparelPurch : null) as number | null,
      apparelEnding,
      accEndingTotal,
      accPurchTotal,
      accCalcItems,
      currentPurch,
      yearGroupPurch,
      apparelOldPurch,
      canShowPurchase: canCalc2026 || !!useInbound2025,
    };
  }, [rows, targetWeeks, appOtb, year, brand, selectedAccId, stock, inbound, inboundPrev, retailPrev, mergedAccounts]);

  useEffect(() => {
    onMetricsChange?.(brand, {
      purchase: inventoryMetrics.purchase,
      sales: inventoryMetrics.sales,
      ending: inventoryMetrics.ending,
      prevEnding: inventoryMetrics.prevEnding,
      prevInbound: inventoryMetrics.prevInbound,
      prevRetail: inventoryMetrics.prevRetail,
    });
  }, [inventoryMetrics, onMetricsChange, brand]);

  const th = "px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider text-slate-500 whitespace-nowrap";
  const thL = "px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500 whitespace-nowrap";
  const tdC = "px-3 py-2 text-right text-sm tabular-nums text-slate-700 whitespace-nowrap";
  const tdL = "px-3 py-2 text-sm text-slate-700 whitespace-nowrap";

  const rowBgClass = (rowType?: "total" | "apparelAccTotal") => {
    if (rowType === "total") return "bg-slate-200/70";
    if (rowType === "apparelAccTotal") return "bg-teal-50/80";
    return "";
  };

  function Row({ label, data, indent = 0, bold = false, accItem, endingStock, purchase, displayWeeks, displaySellThrough, rowType }: {
    label: string;
    data: RowData;
    indent?: number;
    bold?: boolean;
    accItem?: string;
    endingStock?: number;
    purchase?: number;
    displayWeeks?: number;
    displaySellThrough?: number;
    rowType?: "total" | "apparelAccTotal";
  }) {
    const bg = rowType ? rowBgClass(rowType) : "hover:bg-slate-50/60";
    return (
      <tr className={`border-b border-slate-100 last:border-0 ${bg}`}>
        <td className={`${tdL} ${bold ? "font-semibold" : ""}`} style={{ paddingLeft: `${12 + indent * 16}px` }}>
          {indent > 0 && <span className="mr-1 text-slate-300">ㄴ</span>}
          {label}
        </td>
        <td className={tdC}><Num v={data.base} /></td>
        <td className={tdC}>{purchase !== undefined ? <Num v={purchase} /> : <Dash />}</td>
        <td className={tdC}><Num v={data.sales} /></td>
        <td className={tdC}>{endingStock !== undefined ? <Num v={endingStock} /> : <Dash />}</td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          {accItem !== undefined ? (
            <div className="inline-flex items-center justify-end gap-1">
              <input
                type="number"
                min={0}
                step={0.5}
                value={targetWeeks[accItem] ?? ""}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v)) setTargetWeeks((prev) => ({ ...prev, [accItem]: v }));
                }}
                className="h-6 w-14 rounded border-0 bg-slate-100 py-0.5 pr-1 text-right text-sm tabular-nums text-slate-700 outline-none focus:bg-slate-200 focus:ring-0"
              />
              <span className="text-xs text-slate-400">주</span>
            </div>
          ) : displayWeeks !== undefined ? (
            <div className="flex justify-end">
              <span className={`text-sm tabular-nums ${bold ? "font-semibold text-slate-700" : "text-slate-500"}`}>
                {displayWeeks.toFixed(1)}주
              </span>
            </div>
          ) : displaySellThrough !== undefined ? (
            <div className="flex justify-end">
              <span className={`text-sm tabular-nums ${bold ? "font-semibold text-slate-700" : "text-slate-500"}`}>
                {displaySellThrough.toFixed(1)}%
              </span>
            </div>
          ) : null}
        </td>
      </tr>
    );
  }

  function CollapsibleGroupRow({ label, data, isOpen, onToggle, endingStock, purchase, displayWeeks, displaySellThrough }: {
    label: string;
    data: RowData;
    isOpen: boolean;
    onToggle: () => void;
    endingStock?: number;
    purchase?: number;
    displayWeeks?: number;
    displaySellThrough?: number;
  }) {
    return (
      <tr
        className="cursor-pointer border-b border-slate-100 hover:bg-slate-50/60"
        onClick={onToggle}
      >
        <td className={`${tdL} font-medium`} style={{ paddingLeft: `${12 + 16}px` }}>
          <div className="inline-flex items-center gap-1">
            <span className="mr-1 text-slate-300">ㄴ</span>
            <span>{label}</span>
            {isOpen
              ? <ChevronDownIcon className="ml-1 h-3 w-3 text-slate-400" />
              : <ChevronRightIcon className="ml-1 h-3 w-3 text-slate-400" />
            }
          </div>
        </td>
        <td className={tdC}><Num v={data.base} /></td>
        <td className={tdC}>{purchase !== undefined ? <Num v={purchase} /> : <Dash />}</td>
        <td className={tdC}><Num v={data.sales} /></td>
        <td className={tdC}>{endingStock !== undefined ? <Num v={endingStock} /> : <Dash />}</td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          {displayWeeks !== undefined ? (
            <span className="text-sm tabular-nums text-slate-500">{displayWeeks.toFixed(1)}주</span>
          ) : displaySellThrough !== undefined ? (
            <span className="text-sm tabular-nums text-slate-500">{displaySellThrough.toFixed(1)}%</span>
          ) : null}
        </td>
      </tr>
    );
  }

  const groupOpenStates = [open1, open2];
  const groupToggleHandlers = [() => setOpen1((v) => !v), () => setOpen2((v) => !v)];

  return (
    <div className="flex-1 min-w-[300px] overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_4px_20px_rgba(15,23,42,0.08)]">
      {/* 헤더 */}
      <div className="flex items-center justify-between bg-[#1e3a5f] px-4 py-3">
        <h3 className="text-sm font-bold tracking-tight text-white">
          {brand} 재고자산표 , CNY K
        </h3>
        <div className="flex items-center gap-2">
          <select
            value={selectedAccId}
            onChange={(e) => setSelectedAccId(e.target.value)}
            className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-medium text-white outline-none focus:ring-1 focus:ring-white/50 [&>option]:text-slate-800 [&>option]:bg-white"
          >
            <option value="all">전체</option>
            {accounts.map((acc) => (
              <option key={acc.account_id} value={acc.account_id}>
                {acc.account_id} {acc.account_nm_en || ""}
              </option>
            ))}
          </select>
          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-medium text-white hover:bg-white/30"
          >
            {open ? "접기 ▲" : "펼치기 ▼"}
          </button>
        </div>
      </div>

      {/* 테이블 */}
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr className="bg-slate-100/80">
                <th className={`${thL} min-w-[130px]`}>구분</th>
                <th className={th}>기초</th>
                <th className={th}>매입</th>
                <th className={th}>판매</th>
                <th className={th}>기말</th>
                <th className={th}>{year === "2025" ? "Sell Through/재고주수" : "목표재고주수/Sell through"}</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const {
                  apparelPurch: apparelPurchaseSum,
                  apparelEnding,
                  accEndingTotal,
                  accPurchTotal,
                  accCalcItems,
                  currentPurch: currentPurchases,
                  yearGroupPurch: yearGroupPurchases,
                  apparelOldPurch,
                  canShowPurchase,
                } = inventoryMetrics;
                const is2026 = year === "2026";
                const is2025 = year === "2025";
                const accWeeklySalesTotal = (rows.acc.sales / 365) * 7;
                const accDisplayWeeks2026 = is2026 && accWeeklySalesTotal > 0 ? accEndingTotal / accWeeklySalesTotal : undefined;
                const totalEnding = apparelEnding + accEndingTotal;
                const totalPurchase = canShowPurchase ? (apparelPurchaseSum ?? 0) + accPurchTotal : undefined;

                const calcWeeks2025 = (ending: number, purch: number): number | undefined =>
                  purch > 0 ? ending / (purch * 7 / 365) : undefined;

                const calcSellThrough = (base: number, purch: number, sales: number): number | undefined =>
                  (base + purch) > 0 ? (sales / (base + purch)) * 100 : undefined;

                const totalDisplayWeeks = is2025 && totalPurchase && totalPurchase > 0
                  ? calcWeeks2025(totalEnding, totalPurchase) : undefined;
                const accTotalDisplayWeeks = is2025 && accPurchTotal > 0
                  ? calcWeeks2025(accEndingTotal, accPurchTotal)
                  : accDisplayWeeks2026;

                return (
                  <>
                    <Row label="합계" data={rows.total} bold endingStock={totalEnding} purchase={totalPurchase} displayWeeks={totalDisplayWeeks} rowType="total" />

                    <Row
                      label="의류합계"
                      data={rows.apparel}
                      bold
                      endingStock={apparelEnding}
                      purchase={apparelPurchaseSum ?? undefined}
                      displaySellThrough={calcSellThrough(rows.apparel.base, apparelPurchaseSum ?? 0, rows.apparel.sales)}
                      rowType="apparelAccTotal"
                    />

              {rows.apparelCurrent.map(({ season, data }, i) => {
                const p = currentPurchases[i]?.purchase ?? 0;
                const ending = data.base + p - data.sales;
                return (
                  <Row
                    key={season}
                    label={season}
                    data={data}
                    indent={1}
                    endingStock={ending}
                    purchase={canShowPurchase ? p : undefined}
                    displaySellThrough={calcSellThrough(data.base, p, data.sales)}
                  />
                );
              })}

              {rows.apparelYearGroups.map((grp, idx) => {
                const gp = yearGroupPurchases[idx];
                const grpPurch = gp?.groupSum ?? 0;
                return (
                  <Fragment key={grp.label}>
                    <CollapsibleGroupRow
                      label={grp.label}
                      data={grp.data}
                      isOpen={groupOpenStates[idx]}
                      onToggle={groupToggleHandlers[idx]}
                      endingStock={grp.data.base + grpPurch - grp.data.sales}
                      purchase={canShowPurchase ? grpPurch : undefined}
                      displaySellThrough={calcSellThrough(grp.data.base, grpPurch, grp.data.sales)}
                    />
                    {groupOpenStates[idx] && grp.seasons.map(({ season, data }, si) => {
                      const sp = gp?.seasonPurchases[si]?.purchase ?? 0;
                      const sesnEnding = data.base + sp - data.sales;
                      return (
                        <Row
                          key={season}
                          label={season}
                          data={data}
                          indent={2}
                          endingStock={sesnEnding}
                          purchase={canShowPurchase ? sp : undefined}
                          displaySellThrough={calcSellThrough(data.base, sp, data.sales)}
                        />
                      );
                    })}
                  </Fragment>
                );
              })}

              {rows.apparelOld && (
                <Row
                  label="과시즌"
                  data={rows.apparelOld}
                  indent={1}
                  endingStock={rows.apparelOld.base + apparelOldPurch - rows.apparelOld.sales}
                  purchase={canShowPurchase ? apparelOldPurch : undefined}
                  displaySellThrough={calcSellThrough(rows.apparelOld.base, apparelOldPurch, rows.apparelOld.sales)}
                />
              )}

                    <Row
                      label="ACC합계"
                      data={rows.acc}
                      bold
                      endingStock={accEndingTotal}
                      purchase={canShowPurchase ? accPurchTotal : undefined}
                      displayWeeks={accTotalDisplayWeeks}
                      rowType="apparelAccTotal"
                    />
                    {accCalcItems.map(({ item, data, ending, purch }) => (
                      <Row
                        key={item}
                        label={item}
                        data={data}
                        indent={1}
                        accItem={is2026 ? item : undefined}
                        endingStock={ending}
                        purchase={canShowPurchase ? purch : undefined}
                        displayWeeks={is2025 && purch > 0 ? calcWeeks2025(ending, purch) : undefined}
                      />
                    ))}
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* 범례 (MLB 카드에만 표시) */}
      {brand === "MLB" && open && (
        <div className="border-t border-slate-100 bg-slate-50/40 px-4 py-2 text-[10px] text-slate-400 leading-relaxed">
          {year === "2025" ? (
            <>
              <span className="font-medium text-slate-500">2025년 실제</span>
              <span className="mx-1.5 text-slate-300">·</span>
              매입 = 입고물량
              <span className="mx-1.5 text-slate-300">·</span>
              판매 = 리테일매출
              <span className="mx-1.5 text-slate-300">·</span>
              기말 = 기초 + 매입 − 판매
              <span className="mx-1.5 text-slate-300">·</span>
              재고주수 = 기말 ÷ (매입 ÷ 365 × 7)
            </>
          ) : (
            <>
              <span className="font-medium text-slate-500">ACC 계산 로직</span>
              <span className="mx-1.5 text-slate-300">·</span>
              주판매 = 판매 ÷ 365 × 7
              <span className="mx-1.5 text-slate-300">·</span>
              기말 = 주판매 × 목표재고주수
              <span className="mx-1.5 text-slate-300">·</span>
              매입 = 기말 − 기초 + 판매
            </>
          )}
        </div>
      )}
    </div>
  );
}
