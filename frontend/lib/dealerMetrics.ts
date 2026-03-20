/**
 * 대리상별 재고·판매·매입 지표 계산 (DealerDetailTable 공용)
 */
import {
  AccountRow,
  BrandKey,
  StockData,
  RetailData,
  InboundData,
  AppOtbData,
  MONTHS,
} from "./types";

const OTB_SEASONS = new Set(["26S", "26F", "27S", "27F"]);
export const ACC_ORDER = ["신발", "모자", "가방", "기타"] as const;
export const DEFAULT_TARGET_WEEKS: Record<string, number> = {
  신발: 30,
  모자: 20,
  가방: 25,
  기타: 39,
};

export interface RowData {
  base: number;
  sales: number;
}

export interface YearGroup {
  label: string;
  data: RowData;
  seasons: { season: string; data: RowData }[];
}

export interface InventoryRows {
  total: RowData;
  apparel: RowData;
  apparelCurrent: { season: string; data: RowData }[];
  apparelYearGroups: YearGroup[];
  apparelOld: RowData | null;
  acc: RowData;
  accItems: { item: string; data: RowData }[];
}

export interface ApparelSeasonDetail {
  label: string;
  base: number;
  purchase: number;
  sales: number;
  ending: number;
  sellThrough: number | null;
  purchaseYoy?: number | null;
  salesYoy?: number | null;
  endingYoy?: number | null;
}

export interface AccItemDetail {
  item: string;
  base: number;
  purchase: number;
  sales: number;
  ending: number;
  weeks: number | null;
  purchaseYoy?: number | null;
  salesYoy?: number | null;
  endingYoy?: number | null;
}

export interface ApparelYearGroupDetail {
  label: string;
  data: {
    base: number;
    purchase: number;
    sales: number;
    ending: number;
    sellThrough: number | null;
    purchaseYoy?: number | null;
    salesYoy?: number | null;
    endingYoy?: number | null;
  };
  seasons: ApparelSeasonDetail[];
}

export interface DealerAccountMetrics {
  account_id: string;
  account_nm_en: string;
  apparel: {
    base: number;
    purchase: number;
    purchaseYoy: number | null;
    sales: number;
    salesYoy: number | null;
    ending: number;
    endingYoy: number | null;
    sellThrough: number | null;
  };
  acc: {
    base: number;
    purchase: number;
    purchaseYoy: number | null;
    sales: number;
    salesYoy: number | null;
    ending: number;
    endingYoy: number | null;
    weeks: number | null;
  };
  apparelCurrent: ApparelSeasonDetail[];
  apparelYearGroups: ApparelYearGroupDetail[];
  apparelOld: ApparelSeasonDetail | null;
  accItemsDetail: AccItemDetail[];
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

export function mergeAccounts(
  brand: BrandKey,
  stock: StockData | null,
  retail: RetailData | null,
  inbound: InboundData | null
): AccountRow[] {
  const accIds = new Set<string>();
  (stock?.brands[brand] ?? []).forEach((a) => accIds.add(a.account_id));
  (retail?.brands[brand] ?? []).forEach((a) => accIds.add(a.account_id));
  (inbound?.brands[brand] ?? []).forEach((a) => accIds.add(a.account_id));

  const stockMap = new Map((stock?.brands[brand] ?? []).map((a) => [a.account_id, a]));
  const retailMap = new Map((retail?.brands[brand] ?? []).map((a) => [a.account_id, a]));
  const inboundMap = new Map((inbound?.brands[brand] ?? []).map((a) => [a.account_id, a]));

  return Array.from(accIds)
    .sort()
    .map((id) => {
      const s = stockMap.get(id);
      if (s) return s;
      const r = retailMap.get(id) ?? inboundMap.get(id);
      if (!r) return null;
      return {
        account_id: r.account_id,
        account_nm_en: r.account_nm_en ?? "",
        base_stock: 0,
        months: {} as Record<number, number>,
        categories: r.categories ?? [],
      } as AccountRow;
    })
    .filter((a): a is AccountRow => a !== null);
}

export function buildRows(
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
  function seasonYear(s: string): number {
    return parseInt(s.slice(0, 2));
  }

  const currentSeasons = Array.from(seasonSet)
    .filter((s) => {
      const y = seasonYear(s);
      return !isNaN(y) && y >= yy;
    })
    .sort(cmpSesn);
  const group1Seasons = Array.from(seasonSet)
    .filter((s) => seasonYear(s) === yy - 1)
    .sort(cmpSesn);
  const group2Seasons = Array.from(seasonSet)
    .filter((s) => seasonYear(s) === yy - 2)
    .sort(cmpSesn);
  const oldSeasons = Array.from(seasonSet)
    .filter((s) => {
      const y = seasonYear(s);
      return !isNaN(y) && y < yy - 2;
    });

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

  const oldBase =
    oldSeasons.reduce((s, sn) => s + sumBase(filteredAccs, "의류", sn), 0) +
    sumBase(filteredAccs, "의류", "과시즌");
  const oldSales =
    oldSeasons.reduce((s, sn) => s + sumSales("의류", sn), 0) + sumSales("의류", "과시즌");
  const hasOld = oldBase !== 0 || oldSales !== 0;

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

/** 의류 시즌 YOY 매칭: 27S→26S, 25F→24F (동일 시즌코드, 연도 -1) */
export function prevSeason(season: string): string {
  if (season === "과시즌") return "과시즌";
  const yy = parseInt(season.slice(0, 2));
  if (isNaN(yy)) return season;
  return `${(yy - 1).toString().padStart(2, "0")}${season.slice(2)}`;
}

function sumInboundForAccount(
  inbound: InboundData,
  brand: BrandKey,
  accountId: string,
  catKey: string,
  subKey: string | null
): number {
  const acc = (inbound.brands[brand] ?? []).find((a) => a.account_id === accountId);
  if (!acc) return 0;
  let s = 0;
  for (const cat of acc.categories ?? []) {
    if (cat.대분류 !== catKey) continue;
    if (subKey === null) {
      s += MONTHS.reduce((sum, m) => sum + (cat.months[m] ?? 0), 0);
    } else {
      const sub = cat.subcategories?.find((x) => x.중분류 === subKey);
      if (sub) s += MONTHS.reduce((sum, m) => sum + (sub.months[m] ?? 0), 0);
    }
  }
  return s;
}

/**
 * 단일 계정의 의류·ACC 지표 계산 (대리상별 상세표용)
 * retailPrev, inboundPrev: 전년(2025) 데이터. year=2026일 때 YOY 계산에 사용.
 * 의류: 판매 = (기초+매입) × sellThrough%, 기말재고 = 기초+매입−판매
 */
export function computeAccountMetrics(
  acc: AccountRow,
  brand: BrandKey,
  stock: StockData | null,
  stockPrev: StockData | null,
  retail: RetailData | null,
  retailPrev: RetailData | null,
  inbound: InboundData | null,
  inboundPrev: InboundData | null,
  appOtb: AppOtbData | null,
  year: string,
  targetWeeks: Record<string, number> = DEFAULT_TARGET_WEEKS,
  sellThroughPct: number = 70
): DealerAccountMetrics {
  const merged = mergeAccounts(brand, stock, retail, inbound);
  const rows = buildRows(brand, stock, stockPrev, retail, acc.account_id, merged);
  const is2026 = year === "2026";
  const canCalcOtb = appOtb && is2026;
  const useInbound = inbound && !is2026;

  const otbAcc = appOtb?.brands[brand]?.find((o) => o.account_id === acc.account_id);

  function getOtb(sesn: string): number {
    if (!canCalcOtb || !OTB_SEASONS.has(sesn) || !otbAcc) return 0;
    return (otbAcc.seasons[sesn]?.otb ?? 0) * 1000;
  }
  function sesPurchase(season: string, base: number): number {
    if (!OTB_SEASONS.has(season)) return 0;
    return getOtb(season) - base;
  }

  let apparelPurchase = 0;
  if (useInbound) {
    apparelPurchase = sumInboundForAccount(inbound!, brand, acc.account_id, "의류", null);
  } else if (canCalcOtb) {
    for (const { season, data } of rows.apparelCurrent) {
      apparelPurchase += sesPurchase(season, data.base);
    }
    for (const grp of rows.apparelYearGroups) {
      for (const { season, data } of grp.seasons) {
        apparelPurchase += sesPurchase(season, data.base);
      }
    }
  }

  const useApparelFormula = is2026;
  const apparelSales = useApparelFormula
    ? Math.round((rows.apparel.base + apparelPurchase) * (sellThroughPct / 100))
    : rows.apparel.sales;
  const apparelEnding = rows.apparel.base + apparelPurchase - apparelSales;

  const hasPrev = is2026 && stockPrev && retailPrev;
  const prevMerged = hasPrev ? mergeAccounts(brand, stockPrev, retailPrev, inboundPrev) : [];
  const prevRows =
    hasPrev && retailPrev
      ? buildRows(brand, stockPrev, null, retailPrev, acc.account_id, prevMerged)
      : null;

  let prevApparelBase = 0;
  let prevApparelSales = 0;
  let prevApparelPurchase = 0;
  let prevApparelEnding = 0;
  let prevAccSales = 0;
  let prevAccEnding = 0;
  let prevAccPurchase = 0;

  if (prevRows && inboundPrev) {
    prevApparelBase = prevRows.apparel.base;
    prevApparelPurchase = sumInboundForAccount(inboundPrev, brand, acc.account_id, "의류", null);
    prevApparelSales = Math.round((prevApparelBase + prevApparelPurchase) * (sellThroughPct / 100));
    prevApparelEnding = prevApparelBase + prevApparelPurchase - prevApparelSales;
    prevAccSales = prevRows.acc.sales;
    for (const { item, data } of prevRows.accItems) {
      const purch = sumInboundForAccount(inboundPrev, brand, acc.account_id, "ACC", item);
      prevAccPurchase += purch;
      prevAccEnding += data.base + purch - data.sales;
    }
  } else if (prevRows) {
    prevApparelBase = prevRows.apparel.base;
    prevApparelSales = prevRows.apparel.sales;
    prevApparelEnding = prevApparelBase - prevApparelSales;
    prevAccSales = prevRows.acc.sales;
    for (const { item, data } of prevRows.accItems) {
      const weeklySales = (data.sales / 365) * 7;
      const ending = weeklySales > 0 ? Math.round(weeklySales * (targetWeeks[item] ?? 30)) : 0;
      prevAccEnding += ending;
      prevAccPurchase += ending - data.base + data.sales;
    }
  }

  const prevBySeason = new Map<string, { purchase: number; sales: number; ending: number }>();
  const prevByAccItem = new Map<string, { purchase: number; sales: number; ending: number }>();
  if (prevRows && inboundPrev && hasPrev) {
    const addPrevSeason = (label: string, base: number, purch: number) => {
      const sales = Math.round((base + purch) * (sellThroughPct / 100));
      prevBySeason.set(label, { purchase: purch, sales, ending: base + purch - sales });
    };
    for (const { season, data } of prevRows.apparelCurrent) {
      const purch = sumInboundForAccount(inboundPrev, brand, acc.account_id, "의류", season);
      addPrevSeason(season, data.base, purch);
    }
    for (const grp of prevRows.apparelYearGroups) {
      for (const { season, data } of grp.seasons) {
        const purch = sumInboundForAccount(inboundPrev, brand, acc.account_id, "의류", season);
        addPrevSeason(season, data.base, purch);
      }
    }
    if (prevRows.apparelOld) {
      const purch = sumInboundForAccount(inboundPrev, brand, acc.account_id, "의류", "과시즌");
      addPrevSeason("과시즌", prevRows.apparelOld.base, purch);
    }
    for (const { item, data } of prevRows.accItems) {
      const purch = sumInboundForAccount(inboundPrev, brand, acc.account_id, "ACC", item);
      const ending = data.base + purch - data.sales;
      prevByAccItem.set(item, { purchase: purch, sales: data.sales, ending });
    }
  } else if (prevRows && hasPrev) {
    for (const { season, data } of prevRows.apparelCurrent) {
      const sales = data.sales;
      prevBySeason.set(season, { purchase: 0, sales, ending: data.base - sales });
    }
    for (const grp of prevRows.apparelYearGroups) {
      for (const { season, data } of grp.seasons) {
        prevBySeason.set(season, { purchase: 0, sales: data.sales, ending: data.base - data.sales });
      }
    }
    if (prevRows.apparelOld) {
      prevBySeason.set("과시즌", {
        purchase: 0,
        sales: prevRows.apparelOld.sales,
        ending: prevRows.apparelOld.base - prevRows.apparelOld.sales,
      });
    }
    for (const { item, data } of prevRows.accItems) {
      const weeklySales = (data.sales / 365) * 7;
      const ending = weeklySales > 0 ? Math.round(weeklySales * (targetWeeks[item] ?? 30)) : 0;
      const purch = ending - data.base + data.sales;
      prevByAccItem.set(item, { purchase: purch, sales: data.sales, ending });
    }
  }

  function yoy(curr: number, prev: number): number | null {
    if (prev === 0) return null;
    return (curr / prev) * 100;
  }

  const apparelCurrent: ApparelSeasonDetail[] = [];
  const calcSellThrough = (base: number, purch: number, sales: number) =>
    base + purch > 0 ? (sales / (base + purch)) * 100 : null;

  for (const { season, data } of rows.apparelCurrent) {
    const p = canCalcOtb ? sesPurchase(season, data.base) : 0;
    const purch = useInbound ? sumInboundForAccount(inbound!, brand, acc.account_id, "의류", season) : p;
    const sales = useApparelFormula ? Math.round((data.base + purch) * (sellThroughPct / 100)) : data.sales;
    const ending = data.base + purch - sales;
    const prev = prevBySeason.get(prevSeason(season));
    apparelCurrent.push({
      label: season,
      base: data.base,
      purchase: purch,
      sales,
      ending,
      sellThrough: calcSellThrough(data.base, purch, sales),
      purchaseYoy: prev ? yoy(purch, prev.purchase) : null,
      salesYoy: prev ? yoy(sales, prev.sales) : null,
      endingYoy: prev ? yoy(ending, prev.ending) : null,
    });
  }
  const apparelYearGroups: ApparelYearGroupDetail[] = [];
  for (const grp of rows.apparelYearGroups) {
    let grpPurchase = 0;
    const seasons: ApparelSeasonDetail[] = [];
    for (const { season, data } of grp.seasons) {
      const p = canCalcOtb ? sesPurchase(season, data.base) : 0;
      const purch = useInbound ? sumInboundForAccount(inbound!, brand, acc.account_id, "의류", season) : p;
      grpPurchase += purch;
      const sales = useApparelFormula ? Math.round((data.base + purch) * (sellThroughPct / 100)) : data.sales;
      const ending = data.base + purch - sales;
      const prev = prevBySeason.get(prevSeason(season));
      seasons.push({
        label: season,
        base: data.base,
        purchase: purch,
        sales,
        ending,
        sellThrough: calcSellThrough(data.base, purch, sales),
        purchaseYoy: prev ? yoy(purch, prev.purchase) : null,
        salesYoy: prev ? yoy(sales, prev.sales) : null,
        endingYoy: prev ? yoy(ending, prev.ending) : null,
      });
    }
    const grpSales = useApparelFormula ? Math.round((grp.data.base + grpPurchase) * (sellThroughPct / 100)) : grp.data.sales;
    const grpEnding = grp.data.base + grpPurchase - grpSales;
    const grpPrev = grp.seasons.reduce(
      (a, s) => {
        const p = prevBySeason.get(prevSeason(s.season));
        if (p) {
          a.purchase += p.purchase;
          a.sales += p.sales;
          a.ending += p.ending;
        }
        return a;
      },
      { purchase: 0, sales: 0, ending: 0 }
    );
    const hasGrpPrev = grpPrev.purchase || grpPrev.sales || grpPrev.ending;
    apparelYearGroups.push({
      label: grp.label,
      data: {
        base: grp.data.base,
        purchase: grpPurchase,
        sales: grpSales,
        ending: grpEnding,
        sellThrough: calcSellThrough(grp.data.base, grpPurchase, grpSales),
        purchaseYoy: hasGrpPrev ? yoy(grpPurchase, grpPrev.purchase) : null,
        salesYoy: hasGrpPrev ? yoy(grpSales, grpPrev.sales) : null,
        endingYoy: hasGrpPrev ? yoy(grpEnding, grpPrev.ending) : null,
      },
      seasons,
    });
  }
  let apparelOld: ApparelSeasonDetail | null = null;
  if (rows.apparelOld) {
    const oldPurch = useInbound ? sumInboundForAccount(inbound!, brand, acc.account_id, "의류", "과시즌") : 0;
    const oldSales = useApparelFormula ? Math.round((rows.apparelOld.base + oldPurch) * (sellThroughPct / 100)) : rows.apparelOld.sales;
    const ending = rows.apparelOld.base + oldPurch - oldSales;
    const oldPrev = prevBySeason.get("과시즌");
    apparelOld = {
      label: "과시즌",
      base: rows.apparelOld.base,
      purchase: oldPurch,
      sales: oldSales,
      ending,
      sellThrough: calcSellThrough(rows.apparelOld.base, oldPurch, oldSales),
      purchaseYoy: oldPrev ? yoy(oldPurch, oldPrev.purchase) : null,
      salesYoy: oldPrev ? yoy(oldSales, oldPrev.sales) : null,
      endingYoy: oldPrev ? yoy(ending, oldPrev.ending) : null,
    };
  }

  const accItemsDetail: AccItemDetail[] = [];
  let accEnding = 0;
  let accPurchase = 0;
  for (const { item, data } of rows.accItems) {
    const weeklySales = (data.sales / 365) * 7;
    const targetW = targetWeeks[item] ?? DEFAULT_TARGET_WEEKS[item];
    let ending: number;
    let purch: number;
    if (useInbound) {
      purch = sumInboundForAccount(inbound!, brand, acc.account_id, "ACC", item);
      ending = data.base + purch - data.sales;
    } else {
      ending = weeklySales > 0 ? Math.round(weeklySales * targetW) : 0;
      purch = ending - data.base + data.sales;
    }
    accEnding += ending;
    accPurchase += purch;
    const accPrev = prevByAccItem.get(item);
    accItemsDetail.push({
      item,
      base: data.base,
      purchase: purch,
      sales: data.sales,
      ending,
      weeks: data.sales > 0 ? ending / ((data.sales / 365) * 7) : null,
      purchaseYoy: accPrev ? yoy(purch, accPrev.purchase) : null,
      salesYoy: accPrev ? yoy(data.sales, accPrev.sales) : null,
      endingYoy: accPrev ? yoy(ending, accPrev.ending) : null,
    });
  }

  const accWeeks = rows.acc.sales > 0 ? accEnding / ((rows.acc.sales / 365) * 7) : null;
  const sellThrough =
    rows.apparel.base + apparelPurchase > 0
      ? (useApparelFormula ? sellThroughPct : (apparelSales / (rows.apparel.base + apparelPurchase)) * 100)
      : null;

  return {
    account_id: acc.account_id,
    account_nm_en: acc.account_nm_en ?? "",
    apparel: {
      base: rows.apparel.base,
      purchase: apparelPurchase,
      purchaseYoy: yoy(apparelPurchase, prevApparelPurchase),
      sales: apparelSales,
      salesYoy: yoy(apparelSales, prevApparelSales),
      ending: apparelEnding,
      endingYoy: yoy(apparelEnding, prevApparelEnding),
      sellThrough,
    },
    acc: {
      base: rows.acc.base,
      purchase: accPurchase,
      purchaseYoy: yoy(accPurchase, prevAccPurchase),
      sales: rows.acc.sales,
      salesYoy: yoy(rows.acc.sales, prevAccSales),
      ending: accEnding,
      endingYoy: yoy(accEnding, prevAccEnding),
      weeks: accWeeks,
    },
    apparelCurrent,
    apparelYearGroups,
    apparelOld,
    accItemsDetail,
  };
}
