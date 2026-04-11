"use client";

import { useState, useMemo, useCallback, useRef, type ReactNode } from "react";

import { BrandKey, StockData, RetailData, InboundData, AppOtbData } from "../../lib/types";
import { fmtAmt } from "../../lib/utils";
import {
  mergeAccounts,
  computeAccountMetrics,
  prevSeason,
  ACC_ORDER,
  DEFAULT_TARGET_WEEKS,
  DEFAULT_SELL_THROUGH_RATES,
  type SellThroughRates,
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
  /** 2026 YOY(25년POS) 분모 — retail_dw_2025.json */
  retailDw2025?: RetailData | null;
  inbound2026?: InboundData | null;
  growthRate?: number;
  onGrowthRateChange?: (v: number) => void;
  targetWeeks?: Record<string, number>;
  onTargetWeeksChange?: (item: string, v: number) => void;
  /** 2026 탭 의류 Sell through % (시즌·연차·과시즌) */
  sellThroughRates?: SellThroughRates;
  onSellThroughRatesChange?: (next: SellThroughRates) => void;
  accountNameMap?: Record<string, { account_nm_en: string; account_nm_kr: string }>;
  /** 상단 sticky 바 좌측에 노출할 연도 탭 등 (2026 모드 전용) */
  yearTabs?: ReactNode;
}

function Num({ v }: { v: number }) {
  return <span>{fmtAmt(v)}</span>;
}
function Yoy({ v }: { v: number | null }) {
  if (v === null) return <span></span>;
  const cls =
    v >= 100 ? "text-green-600 font-medium" :
    v >= 90  ? "text-amber-500" :
    v >= 80  ? "text-orange-500" :
               "text-red-600 font-medium";
  return <span className={cls}>{Math.round(v)}%</span>;
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
  retailDw2025 = null,
  inbound2026,
  growthRate = 100,
  onGrowthRateChange,
  targetWeeks: targetWeeksProp,
  onTargetWeeksChange,
  sellThroughRates: sellThroughRatesProp,
  onSellThroughRatesChange,
  accountNameMap,
  yearTabs,
}: Props) {
  const targetWeeks = targetWeeksProp ?? DEFAULT_TARGET_WEEKS;
  const sellThroughRates = sellThroughRatesProp ?? DEFAULT_SELL_THROUGH_RATES;
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

  const { metrics, metricsPrev } = useMemo(() => {
    const merged = mergeAccounts(
      brand,
      stock ?? stock2026 ?? stock2025 ?? null,
      retail ?? retail2026 ?? retail2025 ?? null,
      inbound ?? inbound2026 ?? inbound2025 ?? null,
      appOtb
    );
    /** 2025 탭: 부모 retail(POS 우선) 사용 · 2026 탭의 전년지표: 역산 retail2025 우선(26년 blended retail 제외) */
    const canBuildAll2025 = !!(stock2025 ?? stock) && !!(retail2025 ?? retail);
    const retailForAll2025 =
      year === "2025" ? (retail ?? retail2025) : (retail2025 ?? retail);
    const all2025 =
      canBuildAll2025 && retailForAll2025
        ? merged.map((acc) =>
            computeAccountMetrics(
              acc,
              brand,
              stock2025 ?? stock!,
              null,
              retailForAll2025,
              null,
              inbound2025 ?? inbound ?? null,
              null,
              null,
              "2025",
              targetWeeks,
              sellThroughRates
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
            sellThroughRates,
            retailDw2025
          )
        )
      : [];
    const curr = year === "2026"
      ? (all2026.length > 0 ? all2026 : merged.map((acc) => computeAccountMetrics(acc, brand, stock!, stockPrev, retail!, retailPrev, inbound!, inboundPrev, appOtb, "2026", targetWeeks, sellThroughRates, retailDw2025)))
      : (all2025.length > 0 ? all2025 : merged.map((acc) => computeAccountMetrics(acc, brand, stock!, stockPrev, retail!, retailPrev, inbound!, inboundPrev, appOtb, year, targetWeeks, sellThroughRates)));
    const filtered =
      year === "2026"
        ? curr.filter((m) => m.apparel.ending + m.acc.ending > 0)
        : curr;
    const accountIds = new Set(filtered.map((m) => m.account_id));
    const prev =
      year === "2026" && all2025.length > 0 ? all2025.filter((m) => accountIds.has(m.account_id)) : [];
    return { metrics: filtered, metricsPrev: prev };
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
    retailDw2025,
    inbound2026,
    appOtb,
    year,
    targetWeeks,
    sellThroughRates,
  ]);

  const totalRow = useMemo(() => {
    if (metrics.length === 0) return null;
    const apparelBase = metrics.reduce((s, m) => s + m.apparel.base, 0);
    const apparelPurchase = metrics.reduce((s, m) => s + m.apparel.purchase, 0);
    const apparelSales = metrics.reduce((s, m) => s + m.apparel.sales, 0);
    const apparelEnding = metrics.reduce((s, m) => s + m.apparel.ending, 0);
    const accBase = metrics.reduce((s, m) => s + m.acc.base, 0);
    const accPurchase = metrics.reduce((s, m) => s + m.acc.purchase, 0);
    const accSales = metrics.reduce((s, m) => s + m.acc.sales, 0);
    const accEnding = metrics.reduce((s, m) => s + m.acc.ending, 0);

    let apparelPurchaseYoy: number | null = null;
    let apparelSalesYoy: number | null = null;
    let apparelEndingYoy: number | null = null;
    let accPurchaseYoy: number | null = null;
    let accSalesYoy: number | null = null;
    let accEndingYoy: number | null = null;
    let apparelSalesYoyPos: number | null = null;
    let accSalesYoyPos: number | null = null;

    if (year === "2026" && metricsPrev.length === metrics.length) {
      const prevApparelPurchase = metricsPrev.reduce((s, m) => s + m.apparel.purchase, 0);
      const prevApparelSales = metricsPrev.reduce((s, m) => s + m.apparel.sales, 0);
      const prevApparelEnding = metricsPrev.reduce((s, m) => s + m.apparel.ending, 0);
      const prevAccPurchase = metricsPrev.reduce((s, m) => s + m.acc.purchase, 0);
      const prevAccSales = metricsPrev.reduce((s, m) => s + m.acc.sales, 0);
      const prevAccEnding = metricsPrev.reduce((s, m) => s + m.acc.ending, 0);
      const yoy = (curr: number, prev: number) => (prev === 0 ? null : (curr / prev) * 100);
      apparelPurchaseYoy = yoy(apparelPurchase, prevApparelPurchase);
      apparelSalesYoy = yoy(apparelSales, prevApparelSales);
      apparelEndingYoy = yoy(apparelEnding, prevApparelEnding);
      accPurchaseYoy = yoy(accPurchase, prevAccPurchase);
      accSalesYoy = yoy(accSales, prevAccSales);
      accEndingYoy = yoy(accEnding, prevAccEnding);
    }

    if (year === "2026") {
      const sumPosCurrA = metrics.reduce((s, m) => s + (m.apparel.retailSalesPos ?? 0), 0);
      const sumPosPrevA = metrics.reduce((s, m) => s + (m.apparel.prevRetailSalesPos ?? 0), 0);
      apparelSalesYoyPos = sumPosPrevA === 0 ? null : (sumPosCurrA / sumPosPrevA) * 100;
      const sumPosCurrAcc = metrics.reduce((s, m) => s + (m.acc.retailSalesPos ?? 0), 0);
      const sumPosPrevAcc = metrics.reduce((s, m) => s + (m.acc.prevRetailSalesPos ?? 0), 0);
      accSalesYoyPos = sumPosPrevAcc === 0 ? null : (sumPosCurrAcc / sumPosPrevAcc) * 100;
    }

    return {
      apparel: {
        base: apparelBase,
        purchase: apparelPurchase,
        sales: apparelSales,
        ending: apparelEnding,
        sellThrough: apparelBase + apparelPurchase > 0 ? (apparelSales / (apparelBase + apparelPurchase)) * 100 : null,
        purchaseYoy: apparelPurchaseYoy,
        salesYoy: apparelSalesYoy,
        endingYoy: apparelEndingYoy,
        salesYoyPos: apparelSalesYoyPos,
      },
      acc: {
        base: accBase,
        purchase: accPurchase,
        sales: accSales,
        ending: accEnding,
        weeks: accSales > 0 ? accEnding / ((accSales / 365) * 7) : null,
        purchaseYoy: accPurchaseYoy,
        salesYoy: accSalesYoy,
        endingYoy: accEndingYoy,
        salesYoyPos: accSalesYoyPos,
      },
    };
  }, [metrics, metricsPrev, year]);

  const totalAgg = useMemo(() => {
    if (metrics.length === 0) return null;
    const apparelCurrent: (ApparelSeasonDetail & { purchaseYoy?: number | null; salesYoy?: number | null; endingYoy?: number | null })[] = [];
    const apparelYearGroups: (ApparelYearGroupDetail & { data: ApparelYearGroupDetail["data"] & { purchaseYoy?: number | null; salesYoy?: number | null; endingYoy?: number | null } })[] = [];
    let apparelOld: (ApparelSeasonDetail & { purchaseYoy?: number | null; salesYoy?: number | null; endingYoy?: number | null }) | null = null;
    const accItemsDetail: {
      item: string;
      base: number;
      purchase: number;
      sales: number;
      ending: number;
      weeks: number | null;
      purchaseYoy?: number | null;
      salesYoy?: number | null;
      endingYoy?: number | null;
      salesYoyPos?: number | null;
      prevRetailPosSales?: number;
    }[] = [];

    const yoyFn = (curr: number, prev: number) => (prev === 0 ? null : (curr / prev) * 100);

    const prevByLabel = new Map<string, { purchase: number; sales: number; ending: number }>();
    if (year === "2026" && metricsPrev.length === metrics.length) {
      for (const m of metricsPrev) {
        for (const s of m.apparelCurrent) {
          const ex = prevByLabel.get(s.label) ?? { purchase: 0, sales: 0, ending: 0 };
          ex.purchase += s.purchase;
          ex.sales += s.sales;
          ex.ending += s.ending;
          prevByLabel.set(s.label, ex);
        }
        for (const grp of m.apparelYearGroups) {
          for (const s of grp.seasons) {
            const ex = prevByLabel.get(s.label) ?? { purchase: 0, sales: 0, ending: 0 };
            ex.purchase += s.purchase;
            ex.sales += s.sales;
            ex.ending += s.ending;
            prevByLabel.set(s.label, ex);
          }
        }
        if (m.apparelOld) {
          const ex = prevByLabel.get("과시즌") ?? { purchase: 0, sales: 0, ending: 0 };
          ex.purchase += m.apparelOld.purchase;
          ex.sales += m.apparelOld.sales;
          ex.ending += m.apparelOld.ending;
          prevByLabel.set("과시즌", ex);
        }
      }
    }

    const currByLabel = new Map<
      string,
      { base: number; purchase: number; sales: number; ending: number; retailSalesPos: number; prevRetailPosSales: number }
    >();
    for (const m of metrics) {
      for (const s of m.apparelCurrent) {
        const ex = currByLabel.get(s.label) ?? {
          base: 0,
          purchase: 0,
          sales: 0,
          ending: 0,
          retailSalesPos: 0,
          prevRetailPosSales: 0,
        };
        ex.base += s.base;
        ex.purchase += s.purchase;
        ex.sales += s.sales;
        ex.ending += s.ending;
        ex.retailSalesPos += s.retailSalesPos ?? 0;
        ex.prevRetailPosSales += s.prevRetailPosSales ?? 0;
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
      const prev = prevByLabel.get(prevSeason(label));
      const pp = ex.prevRetailPosSales;
      const pc = ex.retailSalesPos;
      apparelCurrent.push({
        label,
        ...ex,
        sellThrough,
        purchaseYoy: prev ? yoyFn(ex.purchase, prev.purchase) : null,
        salesYoy: prev ? yoyFn(ex.sales, prev.sales) : null,
        endingYoy: prev ? yoyFn(ex.ending, prev.ending) : null,
        salesYoyPos: year === "2026" && pp > 0 ? yoyFn(pc, pp) : null,
      });
    }
    for (const [label, ex] of currByLabel) {
      if (seenCurr.has(label)) continue;
      const sellThrough = ex.base + ex.purchase > 0 ? (ex.sales / (ex.base + ex.purchase)) * 100 : null;
      const prev = prevByLabel.get(prevSeason(label));
      const pp = ex.prevRetailPosSales;
      const pc = ex.retailSalesPos;
      apparelCurrent.push({
        label,
        ...ex,
        sellThrough,
        purchaseYoy: prev ? yoyFn(ex.purchase, prev.purchase) : null,
        salesYoy: prev ? yoyFn(ex.sales, prev.sales) : null,
        endingYoy: prev ? yoyFn(ex.ending, prev.ending) : null,
        salesYoyPos: year === "2026" && pp > 0 ? yoyFn(pc, pp) : null,
      });
    }

    const grpByLabel = new Map<
      string,
      {
        data: {
          base: number;
          purchase: number;
          sales: number;
          ending: number;
          sellThrough: number | null;
          retailSalesPos: number;
          prevRetailPosSales: number;
        };
        seasons: Map<string, ApparelSeasonDetail & { retailSalesPos?: number; prevRetailPosSales?: number }>;
      }
    >();
    for (const m of metrics) {
      for (const grp of m.apparelYearGroups) {
        let g = grpByLabel.get(grp.label);
        if (!g) {
          g = {
            data: { base: 0, purchase: 0, sales: 0, ending: 0, sellThrough: null, retailSalesPos: 0, prevRetailPosSales: 0 },
            seasons: new Map(),
          };
          grpByLabel.set(grp.label, g);
        }
        g.data.base += grp.data.base;
        g.data.purchase += grp.data.purchase;
        g.data.sales += grp.data.sales;
        g.data.ending += grp.data.ending;
        g.data.retailSalesPos += grp.data.retailSalesPos ?? 0;
        g.data.prevRetailPosSales += grp.data.prevRetailPosSales ?? 0;
        for (const s of grp.seasons) {
          const ex = g.seasons.get(s.label) ?? {
            label: s.label,
            base: 0,
            purchase: 0,
            sales: 0,
            ending: 0,
            sellThrough: null,
            retailSalesPos: 0,
            prevRetailPosSales: 0,
          };
          ex.base += s.base;
          ex.purchase += s.purchase;
          ex.sales += s.sales;
          ex.ending += s.ending;
          ex.retailSalesPos = (ex.retailSalesPos ?? 0) + (s.retailSalesPos ?? 0);
          ex.prevRetailPosSales = (ex.prevRetailPosSales ?? 0) + (s.prevRetailPosSales ?? 0);
          g.seasons.set(s.label, ex);
        }
      }
    }
    const prevByGrpLabel = new Map<string, { purchase: number; sales: number; ending: number }>();
    if (year === "2026" && metricsPrev.length === metrics.length) {
      for (const m of metricsPrev) {
        for (const grp of m.apparelYearGroups) {
          const ex = prevByGrpLabel.get(grp.label) ?? { purchase: 0, sales: 0, ending: 0 };
          ex.purchase += grp.data.purchase;
          ex.sales += grp.data.sales;
          ex.ending += grp.data.ending;
          prevByGrpLabel.set(grp.label, ex);
        }
      }
    }
    const prevByAccItem = new Map<string, { purchase: number; sales: number; ending: number }>();
    if (year === "2026" && metricsPrev.length === metrics.length) {
      for (const m of metricsPrev) {
        for (const a of m.accItemsDetail) {
          const ex = prevByAccItem.get(a.item) ?? { purchase: 0, sales: 0, ending: 0 };
          ex.purchase += a.purchase;
          ex.sales += a.sales;
          ex.ending += a.ending;
          prevByAccItem.set(a.item, ex);
        }
      }
    }

    for (const grp of metrics[0]?.apparelYearGroups ?? []) {
      const g = grpByLabel.get(grp.label);
      if (!g) continue;
      const { base, purchase, sales, ending } = g.data;
      const sellThrough = base + purchase > 0 ? (sales / (base + purchase)) * 100 : null;
      const seasons: (ApparelSeasonDetail & { purchaseYoy?: number | null; salesYoy?: number | null; endingYoy?: number | null })[] = [];
      for (const s of grp.seasons) {
        const ex = g.seasons.get(s.label);
        if (!ex) continue;
        const st = ex.base + ex.purchase > 0 ? (ex.sales / (ex.base + ex.purchase)) * 100 : null;
        const prev = prevByLabel.get(prevSeason(s.label));
        const pp = ex.prevRetailPosSales ?? 0;
        const pc = ex.retailSalesPos ?? 0;
        seasons.push({
          ...ex,
          sellThrough: st,
          purchaseYoy: prev ? yoyFn(ex.purchase, prev.purchase) : null,
          salesYoy: prev ? yoyFn(ex.sales, prev.sales) : null,
          endingYoy: prev ? yoyFn(ex.ending, prev.ending) : null,
          salesYoyPos: year === "2026" && pp > 0 ? yoyFn(pc, pp) : null,
        });
      }
      const grpPrev = prevByGrpLabel.get(grp.label);
      const gpp = g.data.prevRetailPosSales;
      const gpc = g.data.retailSalesPos;
      apparelYearGroups.push({
        label: grp.label,
        data: {
          base,
          purchase,
          sales,
          ending,
          sellThrough,
          purchaseYoy: grpPrev ? yoyFn(purchase, grpPrev.purchase) : null,
          salesYoy: grpPrev ? yoyFn(sales, grpPrev.sales) : null,
          endingYoy: grpPrev ? yoyFn(ending, grpPrev.ending) : null,
          salesYoyPos: year === "2026" && gpp > 0 ? yoyFn(gpc, gpp) : null,
        },
        seasons,
      });
    }

    let oldSum = { base: 0, purchase: 0, sales: 0, ending: 0, retailSalesPos: 0, prevRetailPosSales: 0 };
    for (const m of metrics) {
      if (m.apparelOld) {
        oldSum.base += m.apparelOld.base;
        oldSum.purchase += m.apparelOld.purchase;
        oldSum.sales += m.apparelOld.sales;
        oldSum.ending += m.apparelOld.ending;
        oldSum.retailSalesPos += m.apparelOld.retailSalesPos ?? 0;
        oldSum.prevRetailPosSales += m.apparelOld.prevRetailPosSales ?? 0;
      }
    }
    if (oldSum.base + oldSum.purchase + oldSum.sales + oldSum.ending > 0) {
      const st = oldSum.base + oldSum.purchase > 0 ? (oldSum.sales / (oldSum.base + oldSum.purchase)) * 100 : null;
      const oldPrev = prevByLabel.get("과시즌");
      apparelOld = {
        label: "과시즌",
        ...oldSum,
        sellThrough: st,
        purchaseYoy: oldPrev ? yoyFn(oldSum.purchase, oldPrev.purchase) : null,
        salesYoy: oldPrev ? yoyFn(oldSum.sales, oldPrev.sales) : null,
        endingYoy: oldPrev ? yoyFn(oldSum.ending, oldPrev.ending) : null,
        salesYoyPos:
          year === "2026" && oldSum.prevRetailPosSales > 0
            ? yoyFn(oldSum.retailSalesPos, oldSum.prevRetailPosSales)
            : null,
      };
    }

    const accByItem = new Map<string, { base: number; purchase: number; sales: number; ending: number; prevRetailPosSales: number }>();
    for (const m of metrics) {
      for (const a of m.accItemsDetail) {
        const ex = accByItem.get(a.item) ?? { base: 0, purchase: 0, sales: 0, ending: 0, prevRetailPosSales: 0 };
        ex.base += a.base;
        ex.purchase += a.purchase;
        ex.sales += a.sales;
        ex.ending += a.ending;
        ex.prevRetailPosSales += a.prevRetailPosSales ?? 0;
        accByItem.set(a.item, ex);
      }
    }
    for (const item of ACC_ORDER) {
      const ex = accByItem.get(item);
      if (!ex) continue;
      const weeks = ex.sales > 0 ? ex.ending / ((ex.sales / 365) * 7) : null;
      const accPrev = prevByAccItem.get(item);
      const pps = ex.prevRetailPosSales;
      accItemsDetail.push({
        item,
        ...ex,
        weeks,
        purchaseYoy: accPrev ? yoyFn(ex.purchase, accPrev.purchase) : null,
        salesYoy: accPrev ? yoyFn(ex.sales, accPrev.sales) : null,
        endingYoy: accPrev ? yoyFn(ex.ending, accPrev.ending) : null,
        salesYoyPos: year === "2026" && pps > 0 ? yoyFn(ex.sales, pps) : null,
      });
    }

    return { apparelCurrent, apparelYearGroups, apparelOld, accItemsDetail };
  }, [metrics, metricsPrev, year]);

  if (metrics.length === 0) return null;

  const th = "px-2 py-1.5 text-center text-[10px] font-medium uppercase tracking-wider text-slate-500 whitespace-nowrap border-b border-slate-200 border-r border-slate-200";
  const thNoRight = "px-2 py-1.5 text-center text-[10px] font-medium uppercase tracking-wider text-slate-500 whitespace-nowrap border-b border-slate-200 border-r-0";
  const thL = `${th} text-left sticky left-0 bg-white z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.05)] border-r-[6px] border-r-slate-300`;
  const thLast = "px-2 py-1.5 text-center text-[10px] font-medium uppercase tracking-wider text-slate-500 whitespace-nowrap border-b border-slate-200 border-r-0";
  const td = "px-2 py-1.5 text-right text-xs tabular-nums text-slate-700 whitespace-nowrap border-b border-slate-200";
  const tdDottedRight = "border-r border-slate-200 [border-right-style:dashed]";
  const tdApp = td;
  const tdAppNoRight = tdApp;
  const tdAppBase = `${tdApp} ${tdDottedRight}`;
  const tdAppPurchaseYoy = `${tdApp} ${tdDottedRight}`;
  const tdAppSalesYoy = year === "2026" ? tdApp : `${tdApp} ${tdDottedRight}`;
  const tdAppSalesYoyPos = `${tdApp} ${tdDottedRight}`;
  const tdAppSellThrough = `${tdApp} border-r-[6px] border-r-slate-300`;
  const tdAcc = td;
  const tdAccNoRight = tdAcc;
  const tdAccBase = `${tdAcc} ${tdDottedRight}`;
  const tdAccPurchaseYoy = `${tdAcc} ${tdDottedRight}`;
  const tdAccSalesYoy = year === "2026" ? tdAcc : `${tdAcc} ${tdDottedRight}`;
  const tdAccSalesYoyPos = `${tdAcc} ${tdDottedRight}`;
  const tdAccFirst = tdAcc;
  const tdAccLast = `${tdAcc} border-r-0`;
  const tdSub = "px-2 py-1.5 text-right text-xs tabular-nums text-slate-700 whitespace-nowrap border-b border-slate-100/30";
  const tdSubDottedRight = "border-r border-slate-200 [border-right-style:dashed] border-b-slate-100/30";
  const tdSubApp = tdSub;
  const tdSubAppBase = `${tdSubApp} ${tdSubDottedRight}`;
  const tdSubAppPurchaseYoy = `${tdSubApp} ${tdSubDottedRight}`;
  const tdSubAppSalesYoy = year === "2026" ? tdSubApp : `${tdSubApp} ${tdSubDottedRight}`;
  const tdSubAppSalesYoyPos = `${tdSubApp} ${tdSubDottedRight}`;
  const tdSubAppSellThrough = `${tdSubApp} border-r-[6px] border-r-slate-300 border-b-slate-100/30`;
  const tdSubAcc = tdSub;
  const tdSubAccBase = `${tdSubAcc} ${tdSubDottedRight}`;
  const tdSubAccPurchaseYoy = `${tdSubAcc} ${tdSubDottedRight}`;
  const tdSubAccSalesYoy = year === "2026" ? tdSubAcc : `${tdSubAcc} ${tdSubDottedRight}`;
  const tdSubAccSalesYoyPos = `${tdSubAcc} ${tdSubDottedRight}`;
  const tdSubAccLast = `${tdSubAcc} border-r-0`;
  const tdLSub = "px-2 py-1.5 text-left text-xs text-slate-700 border-b border-slate-100/30 overflow-hidden";
  const tdLSubWithRight = `${tdLSub} border-r-[6px] border-r-slate-300 border-b-slate-100/30`;
  const tdLBase = "px-2 py-1.5 text-left text-xs text-slate-700 border-b border-slate-200 border-r-[6px] border-r-slate-300 overflow-hidden sticky left-0 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.05)]";
  const tdL = `${tdLBase} bg-white`;
  const tdLTotal = "px-2 py-1.5 text-left text-xs text-slate-700 border-b border-slate-200 border-r-[6px] border-r-slate-300 overflow-hidden sticky left-0 bg-slate-100 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.05)] font-semibold";

  // 2025: name + 의류9 + ACC9 | 2026: 의류9+ACC9 (판매 옆 YOY(25년POS)만, 역산 YOY 열 없음)
  const COL_WIDTHS =
    year === "2026"
      ? [180, 58, 62, 62, 62, 62, 62, 62, 62, 78, 58, 62, 62, 62, 62, 62, 62, 62, 62]
      : [180, 58, 62, 62, 62, 62, 62, 62, 62, 78, 58, 62, 62, 62, 62, 62, 62, 62, 62];
  const colgroup = (
    <colgroup>
      {COL_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}
    </colgroup>
  );
  const spanAppAcc = 9;

  return (
    <div className="mb-6 space-y-6">
      {year === "2026" && (
        <div className="sticky top-[65px] z-30 rounded-xl border border-slate-200/80 bg-white overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 gap-y-2 border-b border-white/20 bg-[#1e3a5f] px-4 py-2.5">
            {yearTabs}
            <div className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-xs text-white">리테일성장율(ACC 계획월만 적용)</span>
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
            </div>
            <div className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-xs text-white">목표재고주수:</span>
              {ACC_ORDER.map((item, i) => (
                <span key={item} className="inline-flex items-center gap-1">
                  {i > 0 && <span className="text-white/50">,</span>}
                  <span className="text-xs text-white/90">{item}</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={targetWeeks[item] ?? ""}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v)) onTargetWeeksChange?.(item, Math.round(v));
                    }}
                    className="h-6 w-10 rounded border border-white/30 bg-white/10 px-1 py-0 text-right text-xs tabular-nums text-white placeholder-white/60 outline-none focus:border-white/50 focus:ring-1 focus:ring-white/30"
                  />
                  <span className="text-[10px] text-white/70">주</span>
                </span>
              ))}
            </div>
            <div className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 flex-1">
              <span className="text-xs font-semibold text-white shrink-0">Sell through(의류) %</span>
            {(["27S", "26F", "26S"] as const).map((sesn) => (
              <span key={sesn} className="inline-flex items-center gap-1">
                <span className="text-[10px] text-white/90">{sesn}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={sellThroughRates.bySeason[sesn] ?? ""}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (isNaN(v) || !onSellThroughRatesChange) return;
                    onSellThroughRatesChange({
                      ...sellThroughRates,
                      bySeason: { ...sellThroughRates.bySeason, [sesn]: Math.min(100, Math.max(0, v)) },
                    });
                  }}
                  className="h-6 w-11 rounded border border-white/30 bg-white/10 px-1 py-0 text-right text-xs tabular-nums text-white outline-none focus:border-white/50 focus:ring-1 focus:ring-white/30"
                />
                <span className="text-[10px] text-white/70">%</span>
              </span>
            ))}
            <span className="inline-flex items-center gap-1">
              <span className="text-[10px] text-white/90">27F</span>
              <span className="text-[10px] tabular-nums text-white/50">0% 고정</span>
            </span>
            <span className="text-white/40">|</span>
            {(["1년차", "2년차"] as const).map((yg) => (
              <span key={yg} className="inline-flex items-center gap-1">
                <span className="text-[10px] text-white/90">{yg}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={sellThroughRates.yearGroup[yg] ?? ""}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (isNaN(v) || !onSellThroughRatesChange) return;
                    onSellThroughRatesChange({
                      ...sellThroughRates,
                      yearGroup: { ...sellThroughRates.yearGroup, [yg]: Math.min(100, Math.max(0, v)) },
                    });
                  }}
                  className="h-6 w-11 rounded border border-white/30 bg-white/10 px-1 py-0 text-right text-xs tabular-nums text-white outline-none focus:border-white/50 focus:ring-1 focus:ring-white/30"
                />
                <span className="text-[10px] text-white/70">%</span>
              </span>
            ))}
            <span className="text-white/40">|</span>
            <span className="inline-flex items-center gap-1">
              <span className="text-[10px] text-white/90">과시즌</span>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={sellThroughRates.oldSeason}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (isNaN(v) || !onSellThroughRatesChange) return;
                  onSellThroughRatesChange({ ...sellThroughRates, oldSeason: Math.min(100, Math.max(0, v)) });
                }}
                className="h-6 w-11 rounded border border-white/30 bg-white/10 px-1 py-0 text-right text-xs tabular-nums text-white outline-none focus:border-white/50 focus:ring-1 focus:ring-white/30"
              />
              <span className="text-[10px] text-white/70">%</span>
            </span>
            </div>
          </div>
          <div className="border-b border-slate-200 bg-blue-50 px-4 py-2 text-[11px] text-blue-700">
            <span className="font-semibold bg-blue-100 rounded px-1.5 py-0.5 mr-1">의류 계산 로직</span>
            <span className="mx-1.5 text-blue-300">·</span>
            매입 = OTB − 25년 누적입고
            <span className="mx-1.5 text-blue-300">·</span>
            판매 = (기초+매입) × Sell through% (상단 패널 시즌·연차·과시즌별)
            <span className="mx-1.5 text-blue-300">·</span>
            기말재고 = 기초+매입−판매
            <span className="mx-3 text-blue-200">|</span>
            <span className="font-semibold bg-blue-100 rounded px-1.5 py-0.5 mr-1">ACC 계산 로직</span>
            <span className="mx-1.5 text-blue-300">·</span>
            주판매 = 판매 ÷ 365 × 7
            <span className="mx-1.5 text-blue-300">·</span>
            기말 = 주판매 × 목표재고주수
            <span className="mx-1.5 text-blue-300">·</span>
            매입 = 기말 − 기초 + 판매
          </div>
        </div>
      )}
      <div className="rounded-xl border border-slate-200/80 bg-white">
        <div
          ref={headScrollRef}
          className="overflow-hidden sticky z-20 bg-white rounded-t-xl"
          style={{ top: year === "2026" ? "160px" : "120px" }}
        >
        <table className="w-full border-collapse" style={{ tableLayout: "fixed", minWidth: 1186 }}>
          {colgroup}
        <thead>
          <tr>
            <th className="px-2 py-1.5 text-left text-[10px] font-medium uppercase tracking-wider text-white whitespace-nowrap border-b border-slate-400 border-r-[6px] border-slate-400 overflow-hidden sticky left-0 bg-[#1e3a5f] z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.05)]" rowSpan={2}>
              (코드) 대리상명칭
            </th>
            <th className="px-2 py-1.5 text-center text-[10px] font-medium uppercase tracking-wider text-white whitespace-nowrap border-b border-slate-400 border-r-[6px] border-r-slate-400 bg-[#1e3a5f]" colSpan={spanAppAcc}>
              의류
            </th>
            <th className="px-2 py-1.5 text-center text-[10px] font-medium uppercase tracking-wider text-white whitespace-nowrap border-b border-slate-400 border-r-0 bg-[#1e3a5f]" colSpan={spanAppAcc}>
              ACC
            </th>
          </tr>
          <tr>
            <th className={`${th} bg-sky-100 text-slate-700 border-l-[6px] border-l-slate-300`}>중분류</th>
            <th className={`${th} bg-sky-100 text-slate-700 border-r border-slate-200 [border-right-style:dashed]`}>기초</th>
            <th className={`${thNoRight} bg-sky-100 text-slate-700`}>
              {year === "2025" ? "매입" : "매입(OTB-25년누적)"}
            </th>
            <th className={`${th} bg-sky-100 text-slate-700 border-r border-slate-200 [border-right-style:dashed]`}>YOY</th>
            <th className={`${thNoRight} bg-sky-100 text-slate-700`}>
              {year === "2025" ? (retailDw2025 ? "판매(POS)" : "판매(역산)") : "판매(역산)"}
            </th>
            {year === "2026" ? (
              <th className={`${th} bg-sky-100 text-slate-700 border-r border-slate-200 [border-right-style:dashed]`}>YOY(25년POS)</th>
            ) : (
              <th className={`${th} bg-sky-100 text-slate-700 border-r border-slate-200 [border-right-style:dashed]`}>YOY</th>
            )}
            <th className={`${thNoRight} bg-sky-100 text-slate-700`}>기말재고</th>
            <th className={`${thNoRight} bg-sky-100 text-slate-700`}>YOY</th>
            <th className="px-2 py-1.5 text-center text-[10px] font-medium tracking-wider bg-sky-100 text-slate-700 whitespace-nowrap border-b border-slate-200 border-r-[6px] border-r-slate-300">Sell Through</th>

            <th className={`${th} bg-sky-100 text-slate-700`}>중분류</th>
            <th className={`${th} bg-sky-100 text-slate-700 border-r border-slate-200 [border-right-style:dashed]`}>기초</th>
            <th className={`${thNoRight} bg-sky-100 text-slate-700`}>매입</th>
            <th className={`${th} bg-sky-100 text-slate-700 border-r border-slate-200 [border-right-style:dashed]`}>YOY</th>
            <th className={`${thNoRight} bg-sky-100 text-slate-700`}>
              {year === "2025" ? (retailDw2025 ? "판매(POS)" : "판매(역산)") : "판매(실적+예상)"}
            </th>
            {year === "2026" ? (
              <th className={`${th} bg-sky-100 text-slate-700 border-r border-slate-200 [border-right-style:dashed]`}>YOY(25년POS)</th>
            ) : (
              <th className={`${th} bg-sky-100 text-slate-700 border-r border-slate-200 [border-right-style:dashed]`}>YOY</th>
            )}
            <th className={`${thNoRight} bg-sky-100 text-slate-700`}>기말재고</th>
            <th className={`${thNoRight} bg-sky-100 text-slate-700`}>YOY</th>
            <th className={`${thLast} bg-sky-100 text-slate-700`}>재고주수</th>
          </tr>
        </thead>
        <tbody>
          {totalRow && (
            <tr
              onClick={() => toggleExpand("__total__")}
              className="cursor-pointer bg-slate-200/70 font-semibold hover:bg-slate-200/90"
            >
              <td className={tdLTotal}>
                <div className="inline-flex items-center gap-1">
                  {expandedIds.has("__total__") ? (
                    <ChevronDownIcon className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                  ) : (
                    <ChevronRightIcon className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                  )}
                  <span>전체</span>
                </div>
              </td>
              <td className={tdApp} />
              <td className={tdAppBase}><Num v={totalRow.apparel.base} /></td>
              <td className={tdAppNoRight}><Num v={totalRow.apparel.purchase} /></td>
              <td className={tdAppPurchaseYoy}><Yoy v={totalRow.apparel.purchaseYoy ?? null} /></td>
              <td className={tdAppNoRight}><Num v={totalRow.apparel.sales} /></td>
              {year !== "2026" && (
                <td className={tdAppSalesYoy}><Yoy v={totalRow.apparel.salesYoy ?? null} /></td>
              )}
              {year === "2026" && (
                <td className={tdAppSalesYoyPos}><Yoy v={totalRow.apparel.salesYoyPos ?? null} /></td>
              )}
              <td className={tdAppNoRight}><Num v={totalRow.apparel.ending} /></td>
              <td className={tdApp}><Yoy v={totalRow.apparel.endingYoy ?? null} /></td>
              <td className={tdAppSellThrough}>{totalRow.apparel.sellThrough != null ? `${totalRow.apparel.sellThrough.toFixed(1)}%` : ""}</td>
              <td className={tdAccFirst} />
              <td className={tdAccBase}><Num v={totalRow.acc.base} /></td>
              <td className={tdAccNoRight}><Num v={totalRow.acc.purchase} /></td>
              <td className={tdAccPurchaseYoy}><Yoy v={totalRow.acc.purchaseYoy ?? null} /></td>
              <td className={tdAccNoRight}><Num v={totalRow.acc.sales} /></td>
              {year !== "2026" && (
                <td className={tdAccSalesYoy}><Yoy v={totalRow.acc.salesYoy ?? null} /></td>
              )}
              {year === "2026" && (
                <td className={tdAccSalesYoyPos}><Yoy v={totalRow.acc.salesYoyPos ?? null} /></td>
              )}
              <td className={tdAccNoRight}><Num v={totalRow.acc.ending} /></td>
              <td className={tdAcc}><Yoy v={totalRow.acc.endingYoy ?? null} /></td>
              <td className={`${tdAccLast} ${totalRow.acc.weeks != null ? (totalRow.acc.weeks >= 30 ? "text-red-500 font-semibold" : "text-violet-600") : ""}`}>
                {totalRow.acc.weeks != null ? `${totalRow.acc.weeks.toFixed(1)}주` : ""}
              </td>
            </tr>
          )}
        </tbody>
      </table>
        </div>
      <div
        ref={bodyScrollRef}
        onScroll={onBodyTableScroll}
        className="overflow-x-auto"
      >
      <table className="w-full border-collapse" style={{ tableLayout: "fixed", minWidth: 1186 }}>
        {colgroup}
        <thead style={{ height: 0, visibility: "hidden" }} aria-hidden="true">
          <tr>
            <th className="min-w-[200px]" rowSpan={2} />
            <th colSpan={spanAppAcc} />
            <th colSpan={spanAppAcc} />
          </tr>
          <tr>
            {Array.from({ length: spanAppAcc }, (_, i) => (
              <th key={`h1-${i}`} className={i === 0 ? "w-16" : ""} />
            ))}
            {Array.from({ length: spanAppAcc }, (_, i) => (
              <th key={`h2-${i}`} className={i === 0 ? "w-16" : ""} />
            ))}
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
              year={year}
              tdSubApp={tdSubApp}
              tdSubAppBase={tdSubAppBase}
              tdSubAppPurchaseYoy={tdSubAppPurchaseYoy}
              tdSubAppSalesYoy={tdSubAppSalesYoy}
              tdSubAppSalesYoyPos={tdSubAppSalesYoyPos}
              tdSubAppSellThrough={tdSubAppSellThrough}
              tdSubAcc={tdSubAcc}
              tdSubAccBase={tdSubAccBase}
              tdSubAccPurchaseYoy={tdSubAccPurchaseYoy}
              tdSubAccSalesYoy={tdSubAccSalesYoy}
              tdSubAccSalesYoyPos={tdSubAccSalesYoyPos}
              tdSubAccLast={tdSubAccLast}
              tdLSub={tdLSub}
              tdLSubWithRight={tdLSubWithRight}
            />
          )}
          {metrics.map((m, index) => (
            <DealerRow
              key={m.account_id}
              m={m}
              year={year}
              accountNameMap={accountNameMap}
              expanded={expandedIds.has(m.account_id)}
              onToggle={() => toggleExpand(m.account_id)}
              yearGroupOpen={yearGroupOpen[m.account_id] ?? new Set()}
              onToggleYearGroup={(label) => toggleYearGroup(m.account_id, label)}
              rowIndex={index}
              td={td}
              tdApp={tdApp}
              tdAppNoRight={tdAppNoRight}
              tdAppBase={tdAppBase}
              tdAppPurchaseYoy={tdAppPurchaseYoy}
              tdAppSalesYoy={tdAppSalesYoy}
              tdAppSalesYoyPos={tdAppSalesYoyPos}
              tdAppSellThrough={tdAppSellThrough}
              tdAcc={tdAcc}
              tdAccNoRight={tdAccNoRight}
              tdAccBase={tdAccBase}
              tdAccPurchaseYoy={tdAccPurchaseYoy}
              tdAccSalesYoy={tdAccSalesYoy}
              tdAccSalesYoyPos={tdAccSalesYoyPos}
              tdAccFirst={tdAccFirst}
              tdAccLast={tdAccLast}
              tdLBase={tdLBase}
              tdSubApp={tdSubApp}
              tdSubAppBase={tdSubAppBase}
              tdSubAppPurchaseYoy={tdSubAppPurchaseYoy}
              tdSubAppSalesYoy={tdSubAppSalesYoy}
              tdSubAppSalesYoyPos={tdSubAppSalesYoyPos}
              tdSubAppSellThrough={tdSubAppSellThrough}
              tdSubAcc={tdSubAcc}
              tdSubAccBase={tdSubAccBase}
              tdSubAccPurchaseYoy={tdSubAccPurchaseYoy}
              tdSubAccSalesYoy={tdSubAccSalesYoy}
              tdSubAccSalesYoyPos={tdSubAccSalesYoyPos}
              tdSubAccLast={tdSubAccLast}
              tdLSub={tdLSub}
              tdLSubWithRight={tdLSubWithRight}
            />
          ))}
        </tbody>
      </table>
      </div>
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
  year,
  tdSubApp,
  tdSubAppBase,
  tdSubAppPurchaseYoy,
  tdSubAppSalesYoy,
  tdSubAppSalesYoyPos,
  tdSubAppSellThrough,
  tdSubAcc,
  tdSubAccBase,
  tdSubAccPurchaseYoy,
  tdSubAccSalesYoy,
  tdSubAccSalesYoyPos,
  tdSubAccLast,
  tdLSub,
  tdLSubWithRight,
}: {
  apparelCurrent: (ApparelSeasonDetail & { purchaseYoy?: number | null; salesYoy?: number | null; endingYoy?: number | null; salesYoyPos?: number | null })[];
  apparelYearGroups: (ApparelYearGroupDetail & {
    data: ApparelYearGroupDetail["data"] & { purchaseYoy?: number | null; salesYoy?: number | null; endingYoy?: number | null; salesYoyPos?: number | null };
  })[];
  apparelOld: (ApparelSeasonDetail & { purchaseYoy?: number | null; salesYoy?: number | null; endingYoy?: number | null; salesYoyPos?: number | null }) | null;
  accItemsDetail: {
    item: string;
    base: number;
    purchase: number;
    sales: number;
    ending: number;
    weeks: number | null;
    purchaseYoy?: number | null;
    salesYoy?: number | null;
    endingYoy?: number | null;
    salesYoyPos?: number | null;
  }[];
  yearGroupOpen: Set<string>;
  onToggleYearGroup: (label: string) => void;
  year: string;
  tdSubApp: string;
  tdSubAppBase: string;
  tdSubAppPurchaseYoy: string;
  tdSubAppSalesYoy: string;
  tdSubAppSalesYoyPos: string;
  tdSubAppSellThrough: string;
  tdSubAcc: string;
  tdSubAccBase: string;
  tdSubAccPurchaseYoy: string;
  tdSubAccSalesYoy: string;
  tdSubAccSalesYoyPos: string;
  tdSubAccLast: string;
  tdLSub: string;
  tdLSubWithRight: string;
}) {
  const showYoy = year === "2026";
  const showPosYoyCol = year === "2026";
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
  const borderBLast = "border-b-slate-200";

  return (
    <>
      {Array.from({ length: maxLen }, (_, i) => {
        const ap = apparelSlots[i];
        const ac = accSlots[i];
        if (!ap && !ac) return null;
        const isLastRow = i === maxLen - 1;
        const cellBorder = isLastRow ? borderBLast : "";
        if (ap?.type === "group") {
          const grp = ap.data;
          return (
            <tr
              key={`grp-${grp.label}`}
              onClick={(e) => { e.stopPropagation(); onToggleYearGroup(grp.label); }}
              className="cursor-pointer hover:bg-slate-50/50"
            >
              <td className={`${tdLSubWithRight} ${cellBorder}`} style={{ paddingLeft: 12 }} />
              <td className={`${tdSubApp} font-medium ${cellBorder}`}>
                <div className="inline-flex items-center gap-1">
                  {ap.isOpen ? <ChevronDownIcon className="h-3 w-3" /> : <ChevronRightIcon className="h-3 w-3" />}
                  {grp.label}
                </div>
              </td>
              <td className={`${tdSubAppBase} ${cellBorder}`}><Num v={grp.data.base} /></td>
              <td className={`${tdSubApp} ${cellBorder}`}><Num v={grp.data.purchase} /></td>
              <td className={`${tdSubAppPurchaseYoy} ${cellBorder}`}>{showYoy ? <Yoy v={grp.data.purchaseYoy ?? null} /> : ""}</td>
              <td className={`${tdSubApp} ${cellBorder}`}><Num v={grp.data.sales} /></td>
              {year !== "2026" && (
                <td className={`${tdSubAppSalesYoy} ${cellBorder}`}>{showYoy ? <Yoy v={grp.data.salesYoy ?? null} /> : ""}</td>
              )}
              {showPosYoyCol && (
                <td className={`${tdSubAppSalesYoyPos} ${cellBorder}`}>
                  <Yoy v={grp.data.salesYoyPos ?? null} />
                </td>
              )}
              <td className={`${tdSubApp} ${cellBorder}`}><Num v={grp.data.ending} /></td>
              <td className={`${tdSubApp} ${cellBorder}`}>{showYoy ? <Yoy v={grp.data.endingYoy ?? null} /> : ""}</td>
              <td className={`${tdSubAppSellThrough} ${cellBorder}`}>{grp.data.sellThrough != null ? `${grp.data.sellThrough.toFixed(1)}%` : ""}</td>
              <td className={`${tdSubAcc} ${ac ? "font-medium" : ""} ${cellBorder}`}>{ac?.item ?? ""}</td>
              {ac ? (
                <>
                  <td className={`${tdSubAccBase} ${cellBorder}`}><Num v={ac.base} /></td>
                  <td className={`${tdSubAcc} ${cellBorder}`}><Num v={ac.purchase} /></td>
                  <td className={`${tdSubAccPurchaseYoy} ${cellBorder}`}>{showYoy ? <Yoy v={ac.purchaseYoy ?? null} /> : ""}</td>
                  <td className={`${tdSubAcc} ${cellBorder}`}><Num v={ac.sales} /></td>
                  {year !== "2026" && (
                    <td className={`${tdSubAccSalesYoy} ${cellBorder}`}>{showYoy ? <Yoy v={ac.salesYoy ?? null} /> : ""}</td>
                  )}
                  {showPosYoyCol && (
                    <td className={`${tdSubAccSalesYoyPos} ${cellBorder}`}>
                      <Yoy v={ac.salesYoyPos ?? null} />
                    </td>
                  )}
                  <td className={`${tdSubAcc} ${cellBorder}`}><Num v={ac.ending} /></td>
                  <td className={`${tdSubAcc} ${cellBorder}`}>{showYoy ? <Yoy v={ac.endingYoy ?? null} /> : ""}</td>
                  <td className={`${tdSubAcc} ${cellBorder} ${ac.weeks != null ? (ac.weeks >= 30 ? "text-red-500 font-semibold" : "text-violet-600") : ""}`}>
                    {ac.weeks != null ? `${ac.weeks.toFixed(1)}주` : ""}
                  </td>
                </>
              ) : (
                <>
                  <td className={`${tdSubAccBase} ${cellBorder}`} />
                  <td className={`${tdSubAcc} ${cellBorder}`} />
                  <td className={`${tdSubAccPurchaseYoy} ${cellBorder}`} />
                  <td className={`${tdSubAcc} ${cellBorder}`} />
                  {year !== "2026" && <td className={`${tdSubAccSalesYoy} ${cellBorder}`} />}
                  {showPosYoyCol && <td className={`${tdSubAccSalesYoyPos} ${cellBorder}`} />}
                  <td className={`${tdSubAcc} ${cellBorder}`} />
                  <td className={`${tdSubAcc} ${cellBorder}`} />
                  <td className={`${tdSubAccLast} ${cellBorder}`} />
                </>
              )}
            </tr>
          );
        }
        return (
          <tr key={i} className="hover:bg-slate-50/50">
            <td className={`${tdLSubWithRight} ${cellBorder}`} style={{ paddingLeft: 12 }} />
            <td className={`${tdSubApp} font-medium ${cellBorder}`}>{ap?.type === "season" ? ap.data.label : ""}</td>
            {ap?.type === "season" ? (
              <>
                <td className={`${tdSubAppBase} ${cellBorder}`}><Num v={ap.data.base} /></td>
                <td className={`${tdSubApp} ${cellBorder}`}><Num v={ap.data.purchase} /></td>
                <td className={`${tdSubAppPurchaseYoy} ${cellBorder}`}>{showYoy ? <Yoy v={ap.data.purchaseYoy ?? null} /> : ""}</td>
                <td className={`${tdSubApp} ${cellBorder}`}><Num v={ap.data.sales} /></td>
                {year !== "2026" && (
                  <td className={`${tdSubAppSalesYoy} ${cellBorder}`}>{showYoy ? <Yoy v={ap.data.salesYoy ?? null} /> : ""}</td>
                )}
                {showPosYoyCol && (
                  <td className={`${tdSubAppSalesYoyPos} ${cellBorder}`}>
                    <Yoy v={ap.data.salesYoyPos ?? null} />
                  </td>
                )}
                <td className={`${tdSubApp} ${cellBorder}`}><Num v={ap.data.ending} /></td>
                <td className={`${tdSubApp} ${cellBorder}`}>{showYoy ? <Yoy v={ap.data.endingYoy ?? null} /> : ""}</td>
                <td className={`${tdSubAppSellThrough} ${cellBorder}`}>{ap.data.sellThrough != null ? `${ap.data.sellThrough.toFixed(1)}%` : ""}</td>
              </>
            ) : (
              <>
                <td className={`${tdSubAppBase} ${cellBorder}`} />
                <td className={`${tdSubApp} ${cellBorder}`} />
                <td className={`${tdSubAppPurchaseYoy} ${cellBorder}`} />
                <td className={`${tdSubApp} ${cellBorder}`} />
                {year !== "2026" && <td className={`${tdSubAppSalesYoy} ${cellBorder}`} />}
                {showPosYoyCol && <td className={`${tdSubAppSalesYoyPos} ${cellBorder}`} />}
                <td className={`${tdSubApp} ${cellBorder}`} />
                <td className={`${tdSubApp} ${cellBorder}`} />
                <td className={`${tdSubAppSellThrough} ${cellBorder}`} />
              </>
            )}
            <td className={`${tdSubAcc} font-medium ${cellBorder}`}>{ac?.item ?? ""}</td>
            {ac ? (
              <>
                <td className={`${tdSubAccBase} ${cellBorder}`}><Num v={ac.base} /></td>
                <td className={`${tdSubAcc} ${cellBorder}`}><Num v={ac.purchase} /></td>
                <td className={`${tdSubAccPurchaseYoy} ${cellBorder}`}>{showYoy ? <Yoy v={ac.purchaseYoy ?? null} /> : ""}</td>
                <td className={`${tdSubAcc} ${cellBorder}`}><Num v={ac.sales} /></td>
                {year !== "2026" && (
                  <td className={`${tdSubAccSalesYoy} ${cellBorder}`}>{showYoy ? <Yoy v={ac.salesYoy ?? null} /> : ""}</td>
                )}
                {showPosYoyCol && (
                  <td className={`${tdSubAccSalesYoyPos} ${cellBorder}`}>
                    <Yoy v={ac.salesYoyPos ?? null} />
                  </td>
                )}
                <td className={`${tdSubAcc} ${cellBorder}`}><Num v={ac.ending} /></td>
                <td className={`${tdSubAcc} ${cellBorder}`}>{showYoy ? <Yoy v={ac.endingYoy ?? null} /> : ""}</td>
                <td className={`${tdSubAcc} ${cellBorder} ${ac.weeks != null ? (ac.weeks >= 30 ? "text-red-500 font-semibold" : "text-violet-600") : ""}`}>
                  {ac.weeks != null ? `${ac.weeks.toFixed(1)}주` : ""}
                </td>
              </>
            ) : (
              <>
                <td className={`${tdSubAccBase} ${cellBorder}`} />
                <td className={`${tdSubAcc} ${cellBorder}`} />
                <td className={`${tdSubAccPurchaseYoy} ${cellBorder}`} />
                <td className={`${tdSubAcc} ${cellBorder}`} />
                {year !== "2026" && <td className={`${tdSubAccSalesYoy} ${cellBorder}`} />}
                {showPosYoyCol && <td className={`${tdSubAccSalesYoyPos} ${cellBorder}`} />}
                <td className={`${tdSubAcc} ${cellBorder}`} />
                <td className={`${tdSubAcc} ${cellBorder}`} />
                <td className={`${tdSubAccLast} ${cellBorder}`} />
              </>
            )}
          </tr>
        );
      })}
    </>
  );
}

function DealerRow({
  m,
  year,
  accountNameMap,
  expanded,
  onToggle,
  yearGroupOpen,
  onToggleYearGroup,
  rowIndex,
  td,
  tdApp,
  tdAppNoRight,
  tdAppBase,
  tdAppPurchaseYoy,
  tdAppSalesYoy,
  tdAppSalesYoyPos,
  tdAppSellThrough,
  tdAcc,
  tdAccNoRight,
  tdAccBase,
  tdAccPurchaseYoy,
  tdAccSalesYoy,
  tdAccSalesYoyPos,
  tdAccFirst,
  tdAccLast,
  tdLBase,
  tdSubApp,
  tdSubAppBase,
  tdSubAppPurchaseYoy,
  tdSubAppSalesYoy,
  tdSubAppSalesYoyPos,
  tdSubAppSellThrough,
  tdSubAcc,
  tdSubAccBase,
  tdSubAccPurchaseYoy,
  tdSubAccSalesYoy,
  tdSubAccSalesYoyPos,
  tdSubAccLast,
  tdLSub,
  tdLSubWithRight,
}: {
  m: DealerAccountMetrics;
  year: string;
  accountNameMap?: Record<string, { account_nm_en: string; account_nm_kr: string }>;
  expanded: boolean;
  onToggle: () => void;
  yearGroupOpen: Set<string>;
  onToggleYearGroup: (label: string) => void;
  rowIndex: number;
  td: string;
  tdApp: string;
  tdAppNoRight: string;
  tdAppBase: string;
  tdAppPurchaseYoy: string;
  tdAppSalesYoy: string;
  tdAppSalesYoyPos: string;
  tdAppSellThrough: string;
  tdAcc: string;
  tdAccNoRight: string;
  tdAccBase: string;
  tdAccPurchaseYoy: string;
  tdAccSalesYoy: string;
  tdAccSalesYoyPos: string;
  tdAccFirst: string;
  tdAccLast: string;
  tdLBase: string;
  tdSubApp: string;
  tdSubAppBase: string;
  tdSubAppPurchaseYoy: string;
  tdSubAppSalesYoy: string;
  tdSubAppSalesYoyPos: string;
  tdSubAppSellThrough: string;
  tdSubAcc: string;
  tdSubAccBase: string;
  tdSubAccPurchaseYoy: string;
  tdSubAccSalesYoy: string;
  tdSubAccSalesYoyPos: string;
  tdSubAccLast: string;
  tdLSub: string;
  tdLSubWithRight: string;
}) {
  const names = accountNameMap?.[m.account_id];
  const displayEn = names?.account_nm_en || m.account_nm_en;
  const displayKr = names?.account_nm_kr;
  const rowBg = rowIndex % 2 === 1 ? "bg-slate-50/40" : "";
  const borderB = expanded ? "border-b-slate-100/30" : "";
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer hover:bg-slate-50/50 border-t border-t-slate-200 ${rowBg}`}
      >
        <td className={`${tdLBase} ${rowBg || "bg-white"} ${borderB}`}>
          <div className="inline-flex items-center gap-1">
            {expanded ? (
              <ChevronDownIcon className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            ) : (
              <ChevronRightIcon className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            )}
            <span
              className="cursor-default"
              title={displayEn || undefined}
            >
              ({m.account_id}) {displayKr || displayEn}
            </span>
          </div>
        </td>
        <td className={`${tdApp} ${borderB}`} />
        <td className={`${tdAppBase} ${borderB}`}><Num v={m.apparel.base} /></td>
        <td className={`${tdAppNoRight} ${borderB}`}><Num v={m.apparel.purchase} /></td>
        <td className={`${tdAppPurchaseYoy} ${borderB}`}><Yoy v={m.apparel.purchaseYoy} /></td>
        <td className={`${tdAppNoRight} ${borderB}`}><Num v={m.apparel.sales} /></td>
        {year !== "2026" && (
          <td className={`${tdAppSalesYoy} ${borderB}`}><Yoy v={m.apparel.salesYoy} /></td>
        )}
        {year === "2026" && (
          <td className={`${tdAppSalesYoyPos} ${borderB}`}><Yoy v={m.apparel.salesYoyPos ?? null} /></td>
        )}
        <td className={`${tdAppNoRight} ${borderB}`}><Num v={m.apparel.ending} /></td>
        <td className={`${tdApp} ${borderB}`}><Yoy v={m.apparel.endingYoy} /></td>
        <td className={`${tdAppSellThrough} ${borderB}`}>
          {m.apparel.sellThrough !== null ? `${m.apparel.sellThrough.toFixed(1)}%` : ""}
        </td>
        <td className={`${tdAccFirst} ${borderB}`} />
        <td className={`${tdAccBase} ${borderB}`}><Num v={m.acc.base} /></td>
        <td className={`${tdAccNoRight} ${borderB}`}><Num v={m.acc.purchase} /></td>
        <td className={`${tdAccPurchaseYoy} ${borderB}`}><Yoy v={m.acc.purchaseYoy} /></td>
        <td className={`${tdAccNoRight} ${borderB}`}><Num v={m.acc.sales} /></td>
        {year !== "2026" && (
          <td className={`${tdAccSalesYoy} ${borderB}`}><Yoy v={m.acc.salesYoy} /></td>
        )}
        {year === "2026" && (
          <td className={`${tdAccSalesYoyPos} ${borderB}`}><Yoy v={m.acc.salesYoyPos ?? null} /></td>
        )}
        <td className={`${tdAccNoRight} ${borderB}`}><Num v={m.acc.ending} /></td>
        <td className={`${tdAcc} ${borderB}`}><Yoy v={m.acc.endingYoy} /></td>
        <td className={`${tdAccLast} ${borderB} ${m.acc.weeks !== null ? (m.acc.weeks >= 30 ? "text-red-500 font-semibold" : "text-violet-600") : ""}`}>
          {m.acc.weeks !== null ? `${m.acc.weeks.toFixed(1)}주` : ""}
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
          year={year}
          tdSubApp={tdSubApp}
          tdSubAppBase={tdSubAppBase}
          tdSubAppPurchaseYoy={tdSubAppPurchaseYoy}
          tdSubAppSalesYoy={tdSubAppSalesYoy}
          tdSubAppSalesYoyPos={tdSubAppSalesYoyPos}
          tdSubAppSellThrough={tdSubAppSellThrough}
          tdSubAcc={tdSubAcc}
          tdSubAccBase={tdSubAccBase}
          tdSubAccPurchaseYoy={tdSubAccPurchaseYoy}
          tdSubAccSalesYoy={tdSubAccSalesYoy}
          tdSubAccSalesYoyPos={tdSubAccSalesYoyPos}
          tdSubAccLast={tdSubAccLast}
          tdLSub={tdLSub}
          tdLSubWithRight={tdLSubWithRight}
        />
      )}
    </>
  );
}
