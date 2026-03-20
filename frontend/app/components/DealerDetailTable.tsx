"use client";

import { useState, useMemo, useCallback, useRef } from "react";

/** 대시보드 헤더 + StockView 브랜드·연도 탭(sticky top-[65px]) 아래에 맞춤 */
const DEALER_TABLE_STICKY_TOP = "124px";
import { BrandKey, StockData, RetailData, InboundData, AppOtbData } from "../../lib/types";
import { fmtAmt } from "../../lib/utils";
import {
  mergeAccounts,
  computeAccountMetrics,
  ACC_ORDER,
  DEFAULT_TARGET_WEEKS,
  DealerAccountMetrics,
  ApparelSeasonDetail,
  ApparelYearGroupDetail,
} from "../../lib/dealerMetrics";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";

interface Props {
  brand: BrandKey;
  stock: StockData | null;
  stockPrev: StockData | null;
  retail: RetailData | null;
  retailPrev: RetailData | null;
  inbound: InboundData | null;
  inboundPrev: InboundData | null;
  appOtb: AppOtbData | null;
  year: string;
  stock2025?: StockData | null;
  retail2025?: RetailData | null;
  inbound2025?: InboundData | null;
  stock2026?: StockData | null;
  retail2026?: RetailData | null;
  inbound2026?: InboundData | null;
  growthRate?: number;
  onGrowthRateChange?: (v: number) => void;
  targetWeeks?: Record<string, number>;
  onTargetWeeksChange?: (item: string, v: number) => void;
  sellThrough?: number;
  onSellThroughChange?: (v: number) => void;
  accountNameMap?: Record<string, { account_nm_en: string; account_nm_kr: string }>;
}

function Num({ v }: { v: number }) {
  return <span>{fmtAmt(v)}</span>;
}
function Yoy({ v }: { v: number | null }) {
  if (v === null) return <span>—</span>;
  const cls =
    v >= 100 ? "text-green-600 font-medium" :
    v >= 90  ? "text-amber-500" :
    v >= 80  ? "text-orange-500" :
               "text-red-600 font-medium";
  return <span className={cls}>{v.toFixed(1)}%</span>;
}

type ApparelSlot = { type: "season"; data: ApparelSeasonDetail } | { type: "group"; label: string; data: ApparelYearGroupDetail; isOpen: boolean };

export default function DealerDetailTable({
  brand,
  stock,
  stockPrev,
  retail,
  retailPrev,
  inbound,
  inboundPrev,
  appOtb,
  year,
  stock2025,
  retail2025,
  inbound2025,
  stock2026,
  retail2026,
  inbound2026,
  growthRate = 100,
  onGrowthRateChange,
  targetWeeks: targetWeeksProp,
  onTargetWeeksChange,
  sellThrough = 70,
  onSellThroughChange,
  accountNameMap,
}: Props) {
  const targetWeeks = targetWeeksProp ?? DEFAULT_TARGET_WEEKS;
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [yearGroupOpen, setYearGroupOpen] = useState<Record<string, Set<string>>>({});
  const headScrollRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const scrollSyncLock = useRef(false);

  const onHeadTableScroll = useCallback(() => {
    if (scrollSyncLock.current) return;
    const h = headScrollRef.current;
    const b = bodyScrollRef.current;
    if (!h || !b) return;
    scrollSyncLock.current = true;
    b.scrollLeft = h.scrollLeft;
    requestAnimationFrame(() => {
      scrollSyncLock.current = false;
    });
  }, []);

  const onBodyTableScroll = useCallback(() => {
    if (scrollSyncLock.current) return;
    const h = headScrollRef.current;
    const b = bodyScrollRef.current;
    if (!h || !b) return;
    scrollSyncLock.current = true;
    h.scrollLeft = b.scrollLeft;
    requestAnimationFrame(() => {
      scrollSyncLock.current = false;
    });
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleYearGroup = useCallback((accId: string, label: string) => {
    setYearGroupOpen((prev) => {
      const accSet = prev[accId] ?? new Set();
      const next = new Set(accSet);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return { ...prev, [accId]: next };
    });
  }, []);

  const metrics = useMemo(() => {
    const merged = mergeAccounts(
      brand,
      stock ?? stock2026 ?? stock2025 ?? null,
      retail ?? retail2026 ?? retail2025 ?? null,
      inbound ?? inbound2026 ?? inbound2025 ?? null
    );
    const all2025 = (stock2025 ?? stock) && (retail2025 ?? retail)
      ? merged.map((acc) =>
          computeAccountMetrics(
            acc,
            brand,
            stock2025 ?? stock!,
            null,
            retail2025 ?? retail!,
            null,
            inbound2025 ?? inbound ?? null,
            null,
            null,
            "2025",
            targetWeeks,
            sellThrough
          )
        )
      : [];
    const all2026 = (stock2026 ?? stock) && (retail2026 ?? retail)
      ? merged.map((acc) =>
          computeAccountMetrics(
            acc,
            brand,
            stock2026 ?? stock!,
            stock2025 ?? stockPrev ?? null,
            retail2026 ?? retail!,
            retail2025 ?? retailPrev ?? null,
            inbound2026 ?? inbound ?? null,
            inbound2025 ?? inboundPrev ?? null,
            appOtb,
            "2026",
            targetWeeks,
            sellThrough
          )
        )
      : [];
    const curr = year === "2026"
      ? (all2026.length > 0 ? all2026 : merged.map((acc) => computeAccountMetrics(acc, brand, stock!, stockPrev, retail!, retailPrev, inbound!, inboundPrev, appOtb, "2026", targetWeeks, sellThrough)))
      : (all2025.length > 0 ? all2025 : merged.map((acc) => computeAccountMetrics(acc, brand, stock!, stockPrev, retail!, retailPrev, inbound!, inboundPrev, appOtb, year, targetWeeks, sellThrough)));
    if (all2025.length > 0 || all2026.length > 0) {
      // 2025·2026 병합 시: 합산 기말 0이어도 대리상은 목록에 포함 (D001 등 누락 방지)
      return curr;
    }
    return curr.filter((m) => m.apparel.ending + m.acc.ending >= 10000);
  }, [
    brand,
    stock,
    stockPrev,
    retail,
    retailPrev,
    inbound,
    inboundPrev,
    stock2025,
    retail2025,
    inbound2025,
    stock2026,
    retail2026,
    inbound2026,
    appOtb,
    year,
    targetWeeks,
    sellThrough,
  ]);

  const totalRow = useMemo(() => {
    if (metrics.length === 0) return null;
    return {
      apparel: {
        base: metrics.reduce((s, m) => s + m.apparel.base, 0),
        purchase: metrics.reduce((s, m) => s + m.apparel.purchase, 0),
        sales: metrics.reduce((s, m) => s + m.apparel.sales, 0),
        ending: metrics.reduce((s, m) => s + m.apparel.ending, 0),
        sellThrough: (() => {
          const base = metrics.reduce((s, m) => s + m.apparel.base, 0);
          const purch = metrics.reduce((s, m) => s + m.apparel.purchase, 0);
          const sales = metrics.reduce((s, m) => s + m.apparel.sales, 0);
          return base + purch > 0 ? (sales / (base + purch)) * 100 : null;
        })(),
      },
      acc: {
        base: metrics.reduce((s, m) => s + m.acc.base, 0),
        purchase: metrics.reduce((s, m) => s + m.acc.purchase, 0),
        sales: metrics.reduce((s, m) => s + m.acc.sales, 0),
        ending: metrics.reduce((s, m) => s + m.acc.ending, 0),
        weeks: (() => {
          const sales = metrics.reduce((s, m) => s + m.acc.sales, 0);
          const ending = metrics.reduce((s, m) => s + m.acc.ending, 0);
          return sales > 0 ? ending / ((sales / 365) * 7) : null;
        })(),
      },
    };
  }, [metrics]);

  const totalAgg = useMemo(() => {
    if (metrics.length === 0) return null;
    const apparelCurrent: ApparelSeasonDetail[] = [];
    const apparelYearGroups: ApparelYearGroupDetail[] = [];
    let apparelOld: ApparelSeasonDetail | null = null;
    const accItemsDetail: { item: string; base: number; purchase: number; sales: number; ending: number; weeks: number | null }[] = [];

    const currByLabel = new Map<string, { base: number; purchase: number; sales: number; ending: number }>();
    for (const m of metrics) {
      for (const s of m.apparelCurrent) {
        const ex = currByLabel.get(s.label) ?? { base: 0, purchase: 0, sales: 0, ending: 0 };
        ex.base += s.base;
        ex.purchase += s.purchase;
        ex.sales += s.sales;
        ex.ending += s.ending;
        currByLabel.set(s.label, ex);
      }
    }
    const currOrder = metrics[0]?.apparelCurrent.map((s) => s.label) ?? [];
    const seenCurr = new Set<string>();
    for (const label of currOrder) {
      if (seenCurr.has(label)) continue;
      seenCurr.add(label);
      const ex = currByLabel.get(label);
      if (!ex) continue;
      const sellThrough = ex.base + ex.purchase > 0 ? (ex.sales / (ex.base + ex.purchase)) * 100 : null;
      apparelCurrent.push({ label, ...ex, sellThrough });
    }
    for (const [label, ex] of currByLabel) {
      if (seenCurr.has(label)) continue;
      const sellThrough = ex.base + ex.purchase > 0 ? (ex.sales / (ex.base + ex.purchase)) * 100 : null;
      apparelCurrent.push({ label, ...ex, sellThrough });
    }

    const grpByLabel = new Map<string, { data: { base: number; purchase: number; sales: number; ending: number; sellThrough: number | null }; seasons: Map<string, ApparelSeasonDetail> }>();
    for (const m of metrics) {
      for (const grp of m.apparelYearGroups) {
        let g = grpByLabel.get(grp.label);
        if (!g) {
          g = { data: { base: 0, purchase: 0, sales: 0, ending: 0, sellThrough: null }, seasons: new Map() };
          grpByLabel.set(grp.label, g);
        }
        g.data.base += grp.data.base;
        g.data.purchase += grp.data.purchase;
        g.data.sales += grp.data.sales;
        g.data.ending += grp.data.ending;
        for (const s of grp.seasons) {
          const ex = g.seasons.get(s.label) ?? { label: s.label, base: 0, purchase: 0, sales: 0, ending: 0, sellThrough: null };
          ex.base += s.base;
          ex.purchase += s.purchase;
          ex.sales += s.sales;
          ex.ending += s.ending;
          g.seasons.set(s.label, ex);
        }
      }
    }
    for (const grp of metrics[0]?.apparelYearGroups ?? []) {
      const g = grpByLabel.get(grp.label);
      if (!g) continue;
      const { base, purchase, sales, ending } = g.data;
      const sellThrough = base + purchase > 0 ? (sales / (base + purchase)) * 100 : null;
      const seasons: ApparelSeasonDetail[] = [];
      for (const s of grp.seasons) {
        const ex = g.seasons.get(s.label);
        if (!ex) continue;
        const st = ex.base + ex.purchase > 0 ? (ex.sales / (ex.base + ex.purchase)) * 100 : null;
        seasons.push({ ...ex, sellThrough: st });
      }
      apparelYearGroups.push({ label: grp.label, data: { base, purchase, sales, ending, sellThrough }, seasons });
    }

    let oldSum = { base: 0, purchase: 0, sales: 0, ending: 0 };
    for (const m of metrics) {
      if (m.apparelOld) {
        oldSum.base += m.apparelOld.base;
        oldSum.purchase += m.apparelOld.purchase;
        oldSum.sales += m.apparelOld.sales;
        oldSum.ending += m.apparelOld.ending;
      }
    }
    if (oldSum.base + oldSum.purchase + oldSum.sales + oldSum.ending > 0) {
      const st = oldSum.base + oldSum.purchase > 0 ? (oldSum.sales / (oldSum.base + oldSum.purchase)) * 100 : null;
      apparelOld = { label: "과시즌", ...oldSum, sellThrough: st };
    }

    const accByItem = new Map<string, { base: number; purchase: number; sales: number; ending: number }>();
    for (const m of metrics) {
      for (const a of m.accItemsDetail) {
        const ex = accByItem.get(a.item) ?? { base: 0, purchase: 0, sales: 0, ending: 0 };
        ex.base += a.base;
        ex.purchase += a.purchase;
        ex.sales += a.sales;
        ex.ending += a.ending;
        accByItem.set(a.item, ex);
      }
    }
    for (const item of ACC_ORDER) {
      const ex = accByItem.get(item);
      if (!ex) continue;
      const weeks = ex.sales > 0 ? ex.ending / ((ex.sales / 365) * 7) : null;
      accItemsDetail.push({ item, ...ex, weeks });
    }

    return { apparelCurrent, apparelYearGroups, apparelOld, accItemsDetail };
  }, [metrics]);

  if (metrics.length === 0) return null;

  const th = "px-2 py-1.5 text-center text-[10px] font-medium uppercase tracking-wider text-slate-500 whitespace-nowrap border-b border-slate-200";
  const td = "px-2 py-1.5 text-right text-xs tabular-nums text-slate-700 whitespace-nowrap border-b border-slate-100";
  const tdApp = `${td} bg-blue-50/30`;
  const tdAcc = `${td} bg-violet-50/25`;
  const tdAccFirst = `${tdAcc} border-l-2 border-violet-200`;
  const tdL = "px-2 py-1.5 text-left text-xs text-slate-700 border-b border-slate-100 overflow-hidden";

  // [name, 중분류(의류), 기초, 매입, YOY, 판매, YOY, 기말재고, YOY, SellThrough, 중분류(ACC), 기초, 매입, YOY, 판매, YOY, 기말재고, YOY, 재고주수]
  const COL_WIDTHS = [200, 65, 72, 72, 72, 72, 72, 72, 72, 90, 65, 72, 72, 72, 72, 72, 72, 72, 72];
  const colgroup = (
    <colgroup>
      {COL_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}
    </colgroup>
  );

  return (
    <div className="mb-6 rounded-xl border border-slate-200/80 bg-white">
      <div className="sticky top-[120px] z-20 -mx-px -mt-px rounded-t-xl border border-slate-200/80 bg-white shadow-[0_4px_6px_-1px_rgba(0,0,0,0.06)]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/20 bg-[#1e3a5f] px-4 py-2.5">
          <h3 className="text-sm font-semibold text-white">대리상 상세표</h3>
        {year === "2026" && (
          <>
            <span className="text-white/50">|</span>
            <span className="text-xs text-white">리테일성장률</span>
            <input
              type="number"
              min={0}
              max={999}
              value={growthRate}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v)) onGrowthRateChange?.(v);
              }}
              className="h-6 w-14 rounded border border-white/30 bg-white/10 px-1.5 py-0 text-right text-xs tabular-nums text-white placeholder-white/60 outline-none focus:border-white/50 focus:ring-1 focus:ring-white/30"
            />
            <span className="text-xs text-white/80">%</span>
            <span className="text-white/50">|</span>
            <span className="text-xs text-white">목표재고주수:</span>
            {ACC_ORDER.map((item, i) => (
              <span key={item} className="inline-flex items-center gap-1">
                {i > 0 && <span className="text-white/50">,</span>}
                <span className="text-xs text-white/90">{item}</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={targetWeeks[item] ?? ""}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v)) onTargetWeeksChange?.(item, v);
                  }}
                  className="h-6 w-10 rounded border border-white/30 bg-white/10 px-1 py-0 text-right text-xs tabular-nums text-white placeholder-white/60 outline-none focus:border-white/50 focus:ring-1 focus:ring-white/30"
                />
                <span className="text-[10px] text-white/70">주</span>
              </span>
            ))}
            <span className="text-white/50">|</span>
            <span className="text-xs text-white">Sell through</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={sellThrough}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v)) onSellThroughChange?.(v);
              }}
              className="h-6 w-14 rounded border border-white/30 bg-white/10 px-1.5 py-0 text-right text-xs tabular-nums text-white placeholder-white/60 outline-none focus:border-white/50 focus:ring-1 focus:ring-white/30"
            />
            <span className="text-xs text-white/80">%</span>
          </>
        )}
      </div>
      {year === "2026" && (
        <div className="border-b border-slate-200 bg-slate-50/40 px-4 py-2 text-[11px] text-slate-500">
          ACC 계산 로직
          <span className="mx-1.5 text-slate-300">·</span>
          주판매 = 판매 ÷ 365 × 7
          <span className="mx-1.5 text-slate-300">·</span>
          기말 = 주판매 × 목표재고주수
          <span className="mx-1.5 text-slate-300">·</span>
          매입 = 기말 − 기초 + 판매
          <span className="mx-2 text-slate-300">|</span>
          의류 계산 로직
          <span className="mx-1.5 text-slate-300">·</span>
          판매 = (기초+매입) × Sell through%
          <span className="mx-1.5 text-slate-300">·</span>
          기말재고 = 기초+매입−판매
        </div>
      )}
        <div ref={headScrollRef} className="overflow-hidden">
        <table className="w-full border-collapse" style={{ tableLayout: "fixed", minWidth: 950 }}>
          {colgroup}
        <thead>
          <tr>
            <th className={`${th} text-left overflow-hidden`} rowSpan={2}>
              (코드) 대리상명칭
            </th>
            <th className={`${th} bg-blue-50/60`} colSpan={9}>
              의류
            </th>
            <th className={`${th} bg-violet-100/60`} colSpan={9}>
              ACC
            </th>
          </tr>
          <tr>
            <th className={`${th} bg-blue-50/40`}>중분류</th>
            <th className={`${th} bg-blue-50/40`}>기초</th>
            <th className={`${th} bg-blue-50/40`}>매입</th>
            <th className={`${th} bg-blue-50/40`}>YOY</th>
            <th className={`${th} bg-blue-50/40`}>판매</th>
            <th className={`${th} bg-blue-50/40`}>YOY</th>
            <th className={`${th} bg-blue-50/40`}>기말재고</th>
            <th className={`${th} bg-blue-50/40`}>YOY</th>
            <th className={`${th} bg-blue-50/40`}>Sell Through</th>
            <th className={`${th} bg-violet-50/50 border-l-2 border-violet-200`}>중분류</th>
            <th className={`${th} bg-violet-50/50`}>기초</th>
            <th className={`${th} bg-violet-50/50`}>매입</th>
            <th className={`${th} bg-violet-50/50`}>YOY</th>
            <th className={`${th} bg-violet-50/50`}>판매</th>
            <th className={`${th} bg-violet-50/50`}>YOY</th>
            <th className={`${th} bg-violet-50/50`}>기말재고</th>
            <th className={`${th} bg-violet-50/50`}>YOY</th>
            <th className={`${th} bg-violet-50/50`}>재고주수</th>
          </tr>
        </thead>
        <tbody>
          {totalRow && (
            <tr
              onClick={() => toggleExpand("__total__")}
              className="cursor-pointer bg-slate-200/70 font-semibold hover:bg-slate-200/90"
            >
              <td className={tdL}>
                <div className="inline-flex items-center gap-1">
                  {expandedIds.has("__total__") ? (
                    <ChevronDownIcon className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                  ) : (
                    <ChevronRightIcon className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                  )}
                  <span>전체</span>
                </div>
              </td>
              <td className={tdApp}>—</td>
              <td className={tdApp}><Num v={totalRow.apparel.base} /></td>
              <td className={tdApp}><Num v={totalRow.apparel.purchase} /></td>
              <td className={tdApp}>—</td>
              <td className={tdApp}><Num v={totalRow.apparel.sales} /></td>
              <td className={tdApp}>—</td>
              <td className={tdApp}><Num v={totalRow.apparel.ending} /></td>
              <td className={tdApp}>—</td>
              <td className={tdApp}>{totalRow.apparel.sellThrough != null ? `${totalRow.apparel.sellThrough.toFixed(1)}%` : "—"}</td>
              <td className={tdAccFirst}>—</td>
              <td className={tdAcc}><Num v={totalRow.acc.base} /></td>
              <td className={tdAcc}><Num v={totalRow.acc.purchase} /></td>
              <td className={tdAcc}>—</td>
              <td className={tdAcc}><Num v={totalRow.acc.sales} /></td>
              <td className={tdAcc}>—</td>
              <td className={tdAcc}><Num v={totalRow.acc.ending} /></td>
              <td className={tdAcc}>—</td>
              <td className={`${tdAcc} ${totalRow.acc.weeks != null ? (totalRow.acc.weeks >= 30 ? "text-red-500 font-semibold" : "text-violet-600") : ""}`}>
                {totalRow.acc.weeks != null ? `${totalRow.acc.weeks.toFixed(1)}주` : "—"}
              </td>
            </tr>
          )}
        </tbody>
      </table>
        </div>
      </div>
      <div
        ref={bodyScrollRef}
        onScroll={onBodyTableScroll}
        className="overflow-x-auto"
      >
      <table className="w-full border-collapse" style={{ tableLayout: "fixed", minWidth: 950 }}>
        {colgroup}
        <thead style={{ height: 0, visibility: "hidden" }} aria-hidden="true">
          <tr>
            <th className="min-w-[200px]" rowSpan={2} />
            <th colSpan={9} />
            <th colSpan={9} />
          </tr>
          <tr>
            <th className="w-16" /><th /><th /><th /><th /><th /><th /><th /><th />
            <th className="w-16" /><th /><th /><th /><th /><th /><th /><th /><th />
          </tr>
        </thead>
        <tbody>
          {totalRow && expandedIds.has("__total__") && totalAgg && (
            <SlotsDetailRows
              apparelCurrent={totalAgg.apparelCurrent}
              apparelYearGroups={totalAgg.apparelYearGroups}
              apparelOld={totalAgg.apparelOld}
              accItemsDetail={totalAgg.accItemsDetail}
              yearGroupOpen={yearGroupOpen["__total__"] ?? new Set()}
              onToggleYearGroup={(label) => toggleYearGroup("__total__", label)}
              td={td}
              tdL={tdL}
            />
          )}
          {metrics.map((m) => (
            <DealerRow
              key={m.account_id}
              m={m}
              accountNameMap={accountNameMap}
              expanded={expandedIds.has(m.account_id)}
              onToggle={() => toggleExpand(m.account_id)}
              yearGroupOpen={yearGroupOpen[m.account_id] ?? new Set()}
              onToggleYearGroup={(label) => toggleYearGroup(m.account_id, label)}
              td={td}
              tdApp={tdApp}
              tdAcc={tdAcc}
              tdAccFirst={tdAccFirst}
              tdL={tdL}
            />
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function SlotsDetailRows({
  apparelCurrent,
  apparelYearGroups,
  apparelOld,
  accItemsDetail,
  yearGroupOpen,
  onToggleYearGroup,
  td,
  tdL,
}: {
  apparelCurrent: ApparelSeasonDetail[];
  apparelYearGroups: ApparelYearGroupDetail[];
  apparelOld: ApparelSeasonDetail | null;
  accItemsDetail: { item: string; base: number; purchase: number; sales: number; ending: number; weeks: number | null }[];
  yearGroupOpen: Set<string>;
  onToggleYearGroup: (label: string) => void;
  td: string;
  tdL: string;
}) {
  const apparelSlots: ApparelSlot[] = [];
  apparelCurrent.forEach((s) => apparelSlots.push({ type: "season", data: s }));
  apparelYearGroups.forEach((grp) => {
    const isOpen = yearGroupOpen.has(grp.label);
    apparelSlots.push({ type: "group", label: grp.label, data: grp, isOpen });
    if (isOpen) {
      grp.seasons.forEach((s) => apparelSlots.push({ type: "season", data: s }));
    }
  });
  if (apparelOld) apparelSlots.push({ type: "season", data: apparelOld });
  const accSlots = accItemsDetail;
  const maxLen = Math.max(apparelSlots.length, accSlots.length);

  return (
    <>
      {Array.from({ length: maxLen }, (_, i) => {
        const ap = apparelSlots[i];
        const ac = accSlots[i];
        if (!ap && !ac) return null;
        if (ap?.type === "group") {
          const grp = ap.data;
          return (
            <tr
              key={`grp-${grp.label}`}
              onClick={(e) => { e.stopPropagation(); onToggleYearGroup(grp.label); }}
              className="cursor-pointer bg-slate-50/30 hover:bg-slate-50/50"
            >
              <td className={tdL} style={{ paddingLeft: 28 }}><span className="text-slate-400">ㄴ</span></td>
              <td className={`${td} bg-blue-50/30 font-medium`}>
                <div className="inline-flex items-center gap-1">
                  {ap.isOpen ? <ChevronDownIcon className="h-3 w-3" /> : <ChevronRightIcon className="h-3 w-3" />}
                  {grp.label}
                </div>
              </td>
              <td className={td}><Num v={grp.data.base} /></td>
              <td className={td}><Num v={grp.data.purchase} /></td>
              <td className={td}>—</td>
              <td className={td}><Num v={grp.data.sales} /></td>
              <td className={td}>—</td>
              <td className={td}><Num v={grp.data.ending} /></td>
              <td className={td}>—</td>
              <td className={td}>{grp.data.sellThrough != null ? `${grp.data.sellThrough.toFixed(1)}%` : "—"}</td>
              <td className={`${td} bg-violet-50/25 border-l-2 border-violet-200 ${ac ? "font-medium" : ""}`}>{ac?.item ?? ""}</td>
              {ac ? (
                <>
                  <td className={`${td} bg-violet-50/25`}><Num v={ac.base} /></td>
                  <td className={`${td} bg-violet-50/25`}><Num v={ac.purchase} /></td>
                  <td className={`${td} bg-violet-50/25`}>—</td>
                  <td className={`${td} bg-violet-50/25`}><Num v={ac.sales} /></td>
                  <td className={`${td} bg-violet-50/25`}>—</td>
                  <td className={`${td} bg-violet-50/25`}><Num v={ac.ending} /></td>
                  <td className={`${td} bg-violet-50/25`}>—</td>
                  <td className={`${td} bg-violet-50/25 ${ac.weeks != null ? (ac.weeks >= 30 ? "text-red-500 font-semibold" : "text-violet-600") : ""}`}>
                    {ac.weeks != null ? `${ac.weeks.toFixed(1)}주` : "—"}
                  </td>
                </>
              ) : (
                <td className={`${td} bg-violet-50/25`} colSpan={8} />
              )}
            </tr>
          );
        }
        return (
          <tr key={i} className="bg-slate-50/30 hover:bg-slate-50/50">
            <td className={tdL} style={{ paddingLeft: 28 }}><span className="text-slate-400">ㄴ</span></td>
            <td className={`${td} bg-blue-50/30 font-medium`}>{ap?.type === "season" ? ap.data.label : ""}</td>
            {ap?.type === "season" ? (
              <>
                <td className={td}><Num v={ap.data.base} /></td>
                <td className={td}><Num v={ap.data.purchase} /></td>
                <td className={td}>—</td>
                <td className={td}><Num v={ap.data.sales} /></td>
                <td className={td}>—</td>
                <td className={td}><Num v={ap.data.ending} /></td>
                <td className={td}>—</td>
                <td className={td}>{ap.data.sellThrough != null ? `${ap.data.sellThrough.toFixed(1)}%` : "—"}</td>
              </>
            ) : (
              <td className={td} colSpan={8} />
            )}
            <td className={`${td} bg-violet-50/25 border-l-2 border-violet-200 font-medium`}>{ac?.item ?? ""}</td>
            {ac ? (
              <>
                <td className={`${td} bg-violet-50/25`}><Num v={ac.base} /></td>
                <td className={`${td} bg-violet-50/25`}><Num v={ac.purchase} /></td>
                <td className={`${td} bg-violet-50/25`}>—</td>
                <td className={`${td} bg-violet-50/25`}><Num v={ac.sales} /></td>
                <td className={`${td} bg-violet-50/25`}>—</td>
                <td className={`${td} bg-violet-50/25`}><Num v={ac.ending} /></td>
                <td className={`${td} bg-violet-50/25`}>—</td>
                <td className={`${td} bg-violet-50/25 ${ac.weeks != null ? (ac.weeks >= 30 ? "text-red-500 font-semibold" : "text-violet-600") : ""}`}>
                  {ac.weeks != null ? `${ac.weeks.toFixed(1)}주` : "—"}
                </td>
              </>
            ) : (
              <td className={`${td} bg-violet-50/25`} colSpan={8} />
            )}
          </tr>
        );
      })}
    </>
  );
}

function DealerRow({
  m,
  accountNameMap,
  expanded,
  onToggle,
  yearGroupOpen,
  onToggleYearGroup,
  td,
  tdApp,
  tdAcc,
  tdAccFirst,
  tdL,
}: {
  m: DealerAccountMetrics;
  accountNameMap?: Record<string, { account_nm_en: string; account_nm_kr: string }>;
  expanded: boolean;
  onToggle: () => void;
  yearGroupOpen: Set<string>;
  onToggleYearGroup: (label: string) => void;
  td: string;
  tdApp: string;
  tdAcc: string;
  tdAccFirst: string;
  tdL: string;
}) {
  const names = accountNameMap?.[m.account_id];
  const displayEn = names?.account_nm_en || m.account_nm_en;
  const displayKr = names?.account_nm_kr;
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer hover:bg-slate-50/50 border-b border-slate-100"
      >
        <td className={tdL}>
          <div className="inline-flex items-center gap-1">
            {expanded ? (
              <ChevronDownIcon className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            ) : (
              <ChevronRightIcon className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            )}
            <span className="whitespace-pre-line">
              ({m.account_id}) {displayEn}
              {displayKr ? `\n       ${displayKr}` : ""}
            </span>
          </div>
        </td>
        <td className={tdApp}>—</td>
        <td className={tdApp}><Num v={m.apparel.base} /></td>
        <td className={tdApp}><Num v={m.apparel.purchase} /></td>
        <td className={tdApp}><Yoy v={m.apparel.purchaseYoy} /></td>
        <td className={tdApp}><Num v={m.apparel.sales} /></td>
        <td className={tdApp}><Yoy v={m.apparel.salesYoy} /></td>
        <td className={tdApp}><Num v={m.apparel.ending} /></td>
        <td className={tdApp}><Yoy v={m.apparel.endingYoy} /></td>
        <td className={tdApp}>
          {m.apparel.sellThrough !== null ? `${m.apparel.sellThrough.toFixed(1)}%` : "—"}
        </td>
        <td className={tdAccFirst}>—</td>
        <td className={tdAcc}><Num v={m.acc.base} /></td>
        <td className={tdAcc}><Num v={m.acc.purchase} /></td>
        <td className={tdAcc}><Yoy v={m.acc.purchaseYoy} /></td>
        <td className={tdAcc}><Num v={m.acc.sales} /></td>
        <td className={tdAcc}><Yoy v={m.acc.salesYoy} /></td>
        <td className={tdAcc}><Num v={m.acc.ending} /></td>
        <td className={tdAcc}><Yoy v={m.acc.endingYoy} /></td>
        <td className={`${tdAcc} ${m.acc.weeks !== null ? (m.acc.weeks >= 30 ? "text-red-500 font-semibold" : "text-violet-600") : ""}`}>
          {m.acc.weeks !== null ? `${m.acc.weeks.toFixed(1)}주` : "—"}
        </td>
      </tr>
      {expanded && (
        <SlotsDetailRows
          apparelCurrent={m.apparelCurrent}
          apparelYearGroups={m.apparelYearGroups}
          apparelOld={m.apparelOld}
          accItemsDetail={m.accItemsDetail}
          yearGroupOpen={yearGroupOpen}
          onToggleYearGroup={onToggleYearGroup}
          td={td}
          tdL={tdL}
        />
      )}
    </>
  );
}
