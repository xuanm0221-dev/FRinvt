"use client";

import { useState, useMemo, useEffect, Fragment } from "react";
import { BrandKey, StockData, RetailData, AppOtbData, MONTHS } from "../../lib/types";
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

// ─── buildRows ───────────────────────────────────────
function buildRows(
  brand: BrandKey,
  stock: StockData | null,
  stockPrev: StockData | null,
  retail: RetailData | null,
  selectedAccId: string
): InventoryRows {
  const empty: RowData = { base: 0, sales: 0 };
  if (!stock) {
    return { total: empty, apparel: empty, apparelCurrent: [], apparelYearGroups: [], apparelOld: null, acc: empty, accItems: [] };
  }

  const allAccs = stock.brands[brand] ?? [];
  const filteredAccs = selectedAccId === "all"
    ? allAccs
    : allAccs.filter((a) => a.account_id === selectedAccId);

  const prevAccs = stockPrev?.brands[brand] ?? [];
  const retailAccs = retail?.brands[brand] ?? [];
  const is2026 = stock.year === "2026";

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

  const yy = parseInt(stock.year.slice(2));

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
  year: string;
  appOtb?: AppOtbData | null;
  onMetricsChange?: (brand: string, m: { purchase: number; sales: number; ending: number }) => void;
}

// ─── 셀 헬퍼 ─────────────────────────────────────────
function Num({ v }: { v: number }) {
  return <span className="tabular-nums">{fmtAmt(v)}</span>;
}
function Dash() {
  return <span className="text-slate-300">—</span>;
}

// ─── 메인 컴포넌트 ─────────────────────────────────────
export default function BrandInventoryCard({ brand, stock, stockPrev, retail, year, appOtb, onMetricsChange }: Props) {
  const [open, setOpen] = useState(true);
  const [selectedAccId, setSelectedAccId] = useState("all");
  const [open1, setOpen1] = useState(false);
  const [open2, setOpen2] = useState(false);
  const [targetWeeks, setTargetWeeks] = useState<Record<string, number>>(DEFAULT_TARGET_WEEKS);

  const accounts = useMemo(() => stock?.brands[brand] ?? [], [stock, brand]);


  const rows = useMemo(
    () => buildRows(brand, stock, stockPrev, retail, selectedAccId),
    [brand, stock, stockPrev, retail, selectedAccId]
  );

  // ─── 재고자산표 집계 (KeyMetricsTable 연동 + 기말재고 계산 공유) ────
  const inventoryMetrics = useMemo(() => {
    const OTB_SEASONS_M = new Set(["26S", "26F", "27S", "27F"]);
    const canCalc = appOtb && year === "2026";

    function getOtbAmt(sesn: string): number {
      if (!canCalc || !OTB_SEASONS_M.has(sesn)) return 0;
      const accs = appOtb!.brands[brand] ?? [];
      let raw: number;
      if (selectedAccId === "all") {
        raw = accs.reduce((s, a) => s + (a.seasons[sesn]?.otb ?? 0), 0);
      } else {
        raw = accs.find((a) => a.account_id === selectedAccId)?.seasons[sesn]?.otb ?? 0;
      }
      return raw * 1000;
    }

    function sesPurchase(season: string, base: number): number {
      if (!OTB_SEASONS_M.has(season)) return 0;
      return getOtbAmt(season) - base;
    }

    const currentPurch = rows.apparelCurrent.map(({ season, data }) => ({
      season,
      purchase: canCalc ? sesPurchase(season, data.base) : 0,
    }));
    const yearGroupPurch = rows.apparelYearGroups.map((grp) => {
      const sps = grp.seasons.map(({ season, data }) => ({
        season,
        purchase: canCalc ? sesPurchase(season, data.base) : 0,
      }));
      return { label: grp.label, groupSum: sps.reduce((s, sp) => s + sp.purchase, 0), seasonPurchases: sps };
    });

    const apparelPurch = canCalc
      ? currentPurch.reduce((s, sp) => s + sp.purchase, 0) +
        yearGroupPurch.reduce((s, gp) => s + gp.groupSum, 0)
      : 0;

    const accItems = rows.accItems.map(({ item, data }) => {
      const weeklySales = (data.sales / 365) * 7;
      const ending = Math.round(weeklySales * (targetWeeks[item] ?? 0));
      return { ending, purch: ending - data.base + data.sales };
    });
    const accEndingTotal = accItems.reduce((s, r) => s + r.ending, 0);
    const accPurchTotal = accItems.reduce((s, r) => s + r.purch, 0);

    const apparelEnding = rows.apparel.base + apparelPurch - rows.apparel.sales;

    return {
      purchase: (canCalc ? apparelPurch : 0) + accPurchTotal,
      sales: rows.total.sales,
      ending: apparelEnding + accEndingTotal,
      // 렌더 IIFE에서도 사용할 세부값
      apparelPurch: canCalc ? apparelPurch : null as number | null,
      apparelEnding,
      accEndingTotal,
      accPurchTotal,
      currentPurch,
      yearGroupPurch,
    };
  }, [rows, targetWeeks, appOtb, year, brand, selectedAccId]);

  useEffect(() => {
    onMetricsChange?.(brand, { purchase: inventoryMetrics.purchase, sales: inventoryMetrics.sales, ending: inventoryMetrics.ending });
  }, [inventoryMetrics, onMetricsChange, brand]);

  const th = "px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider text-slate-500 whitespace-nowrap";
  const thL = "px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500 whitespace-nowrap";
  const tdR = "px-3 py-2 text-right text-sm tabular-nums text-slate-700 whitespace-nowrap";
  const tdL = "px-3 py-2 text-sm text-slate-700 whitespace-nowrap";

  function Row({ label, data, indent = 0, bold = false, accItem, endingStock, purchase, displayWeeks }: {
    label: string;
    data: RowData;
    indent?: number;
    bold?: boolean;
    accItem?: string;
    endingStock?: number;
    purchase?: number;
    displayWeeks?: number;
  }) {
    return (
      <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
        <td className={`${tdL} ${bold ? "font-semibold" : ""}`} style={{ paddingLeft: `${12 + indent * 16}px` }}>
          {indent > 0 && <span className="mr-1 text-slate-300">ㄴ</span>}
          {label}
        </td>
        <td className={tdR}><Num v={data.base} /></td>
        <td className={tdR}>{purchase !== undefined ? <Num v={purchase} /> : <Dash />}</td>
        <td className={tdR}><Num v={data.sales} /></td>
        <td className={tdR}>{endingStock !== undefined ? <Num v={endingStock} /> : <Dash />}</td>
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
            <div className="flex justify-center">
              <span className={`text-sm tabular-nums ${bold ? "font-semibold text-slate-700" : "text-slate-500"}`}>
                {displayWeeks.toFixed(1)}주
              </span>
            </div>
          ) : null}
        </td>
      </tr>
    );
  }

  function CollapsibleGroupRow({ label, data, isOpen, onToggle, endingStock, purchase }: {
    label: string;
    data: RowData;
    isOpen: boolean;
    onToggle: () => void;
    endingStock?: number;
    purchase?: number;
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
        <td className={tdR}><Num v={data.base} /></td>
        <td className={tdR}>{purchase !== undefined ? <Num v={purchase} /> : <Dash />}</td>
        <td className={tdR}><Num v={data.sales} /></td>
        <td className={tdR}>{endingStock !== undefined ? <Num v={endingStock} /> : <Dash />}</td>
        <td className="px-3 py-2" />
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
          {brand} 재고자산표
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
                <th className={th}>목표재고주수</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // inventoryMetrics useMemo에서 계산된 값 사용
                const {
                  apparelPurch: apparelPurchaseSum,
                  apparelEnding,
                  accEndingTotal,
                  accPurchTotal,
                  currentPurch: currentPurchases,
                  yearGroupPurch: yearGroupPurchases,
                } = inventoryMetrics;
                const canCalcOtb = appOtb && year === "2026";

                const accCalcItems = rows.accItems.map(({ item, data }) => {
                  const weeklySales = (data.sales / 365) * 7;
                  const ending = Math.round(weeklySales * (targetWeeks[item] ?? 0));
                  const purch = ending - data.base + data.sales;
                  return { item, data, ending, purch };
                });
                const accWeeklySalesTotal = (rows.acc.sales / 365) * 7;
                const accDisplayWeeks = accWeeklySalesTotal > 0 ? accEndingTotal / accWeeklySalesTotal : undefined;
                const totalEnding = apparelEnding + accEndingTotal;
                const totalPurchase = canCalcOtb
                  ? (apparelPurchaseSum ?? 0) + accPurchTotal
                  : undefined;

                return (
                  <>
                    {/* 합계 */}
                    <Row label="합계" data={rows.total} bold endingStock={totalEnding} purchase={totalPurchase} />

                    {/* 의류 */}
                    <Row
                      label="의류합계"
                      data={rows.apparel}
                      bold
                      endingStock={apparelEnding}
                      purchase={apparelPurchaseSum ?? undefined}
                    />

              {/* 당해 + 신시즌 (개별) */}
              {rows.apparelCurrent.map(({ season, data }, i) => {
                const p = currentPurchases[i]?.purchase ?? 0;
                return (
                  <Row
                    key={season}
                    label={season}
                    data={data}
                    indent={1}
                    endingStock={data.base + p - data.sales}
                    purchase={canCalcOtb ? p : undefined}
                  />
                );
              })}

              {/* 1년차, 2년차 연차 그룹 */}
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
                      purchase={canCalcOtb ? grpPurch : undefined}
                    />
                    {groupOpenStates[idx] && grp.seasons.map(({ season, data }, si) => {
                      const sp = gp?.seasonPurchases[si]?.purchase ?? 0;
                      return (
                        <Row
                          key={season}
                          label={season}
                          data={data}
                          indent={2}
                          endingStock={data.base + sp - data.sales}
                          purchase={canCalcOtb ? sp : undefined}
                        />
                      );
                    })}
                  </Fragment>
                );
              })}

              {/* 과시즌 (매입=0, 기말=기초-판매) */}
              {rows.apparelOld && (
                <Row
                  label="과시즌"
                  data={rows.apparelOld}
                  indent={1}
                  endingStock={rows.apparelOld.base - rows.apparelOld.sales}
                  purchase={canCalcOtb ? 0 : undefined}
                />
              )}

                    {/* ACC */}
                    <Row label="ACC합계" data={rows.acc} bold endingStock={accEndingTotal} purchase={accPurchTotal} displayWeeks={accDisplayWeeks} />
                    {accCalcItems.map(({ item, data, ending, purch }) => (
                      <Row key={item} label={item} data={data} indent={1} accItem={item} endingStock={ending} purchase={purch} />
                    ))}
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* 단위 푸터 */}
      {open && (
        <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-1.5 text-right text-[10px] text-slate-400">
          단위: 천위안
        </div>
      )}

      {/* ACC 계산 범례 (MLB 카드에만 표시) */}
      {brand === "MLB" && open && (
        <div className="border-t border-slate-100 bg-slate-50/40 px-4 py-2 text-[10px] text-slate-400 leading-relaxed">
          <span className="font-medium text-slate-500">ACC 계산 로직</span>
          <span className="mx-1.5 text-slate-300">·</span>
          주판매 = 판매 ÷ 365 × 7
          <span className="mx-1.5 text-slate-300">·</span>
          기말 = 주판매 × 목표재고주수
          <span className="mx-1.5 text-slate-300">·</span>
          매입 = 기말 − 기초 + 판매
        </div>
      )}
    </div>
  );
}
