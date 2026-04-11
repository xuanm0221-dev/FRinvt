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
  CategoryGroup,
} from "./types";

const OTB_SEASONS = new Set(["26S", "26F", "27S", "27F"]);
const OTB_SEASONS_ARR = ["26S", "26F", "27S", "27F"] as const;

/** 2026 의류 판매 = (기초+매입)×% — 시즌·연차·과시즌별 (27F는 항상 0%) */
export interface SellThroughRates {
  bySeason: Record<string, number>;
  yearGroup: Record<string, number>;
  oldSeason: number;
}

export const DEFAULT_SELL_THROUGH_RATES: SellThroughRates = {
  bySeason: { "27S": 10, "26F": 50, "26S": 70, "27F": 0 },
  yearGroup: { "1년차": 60, "2년차": 70 },
  oldSeason: 80,
};

function sellThroughPctForSeason(season: string, rates: SellThroughRates): number {
  if (season === "27F") return 0;
  return rates.bySeason[season] ?? 0;
}

function sellThroughPctForYearGroup(label: string, rates: SellThroughRates): number {
  return rates.yearGroup[label] ?? 0;
}
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
  /** 2026: dw_sale 기준 당년 시즌 POS 매출(rows) */
  retailSalesPos?: number;
  /** 2026: 전년 동시즌 POS 매출(retail_dw_2025) */
  prevRetailPosSales?: number;
  salesYoyPos?: number | null;
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
  salesYoyPos?: number | null;
  prevRetailPosSales?: number;
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
    retailSalesPos?: number;
    prevRetailPosSales?: number;
    salesYoyPos?: number | null;
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
    /** 2026: 의류 POS 연매출 합(buildRows) — YOY(25년POS) 분자 합산용 */
    retailSalesPos?: number;
    prevRetailSalesPos?: number;
    salesYoyPos?: number | null;
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
    retailSalesPos?: number;
    prevRetailSalesPos?: number;
    salesYoyPos?: number | null;
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
  inbound: InboundData | null,
  appOtb: AppOtbData | null = null
): AccountRow[] {
  const accIds = new Set<string>();
  (stock?.brands[brand] ?? []).forEach((a) => accIds.add(a.account_id));
  (retail?.brands[brand] ?? []).forEach((a) => accIds.add(a.account_id));
  (inbound?.brands[brand] ?? []).forEach((a) => accIds.add(a.account_id));
  (appOtb?.brands[brand] ?? []).forEach((a) => accIds.add(a.account_id));

  const stockMap = new Map((stock?.brands[brand] ?? []).map((a) => [a.account_id, a]));
  const retailMap = new Map((retail?.brands[brand] ?? []).map((a) => [a.account_id, a]));
  const inboundMap = new Map((inbound?.brands[brand] ?? []).map((a) => [a.account_id, a]));

  return Array.from(accIds)
    .sort()
    .map((id) => {
      const s = stockMap.get(id);
      if (s) return s;
      const r = retailMap.get(id) ?? inboundMap.get(id);
      if (r)
        return {
          account_id: r.account_id,
          account_nm_en: r.account_nm_en ?? "",
          base_stock: 0,
          months: {} as Record<number, number>,
          categories: r.categories ?? [],
        } as AccountRow;
      const o = appOtb?.brands[brand]?.find((a) => a.account_id === id);
      if (o)
        return {
          account_id: o.account_id,
          account_nm_en: o.account_nm_en ?? "",
          base_stock: 0,
          months: {} as Record<number, number>,
          categories: [],
        } as AccountRow;
      return null;
    })
    .filter((a): a is AccountRow => a !== null);
}

function addSeasonsFromAccounts(seasonSet: Set<string>, accs: readonly { categories?: CategoryGroup[] }[]) {
  for (const acc of accs) {
    for (const cat of acc.categories ?? []) {
      if (cat.대분류 !== "의류") continue;
      for (const sub of cat.subcategories ?? []) {
        if (sub.중분류 && sub.중분류 !== "과시즌") seasonSet.add(sub.중분류);
      }
    }
  }
}

export function buildRows(
  brand: BrandKey,
  stock: StockData | null,
  stockPrev: StockData | null,
  retail: RetailData | null,
  selectedAccId: string,
  allAccsOverride?: AccountRow[],
  inbound?: InboundData | null,
  appOtb?: AppOtbData | null
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
  const stockAccs = stock?.brands[brand] ?? [];
  const inboundAccs = inbound?.brands[brand] ?? [];

  const seasonSet = new Set<string>();
  addSeasonsFromAccounts(seasonSet, filteredAccs);
  addSeasonsFromAccounts(seasonSet, retailAccs);
  addSeasonsFromAccounts(seasonSet, stockAccs);
  addSeasonsFromAccounts(seasonSet, inboundAccs);
  if (is2026 && appOtb) {
    for (const s of OTB_SEASONS_ARR) seasonSet.add(s);
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

/**
 * stock JSON에서 특정 계정·대분류·중분류의 12월 잔액 스냅샷을 반환한다.
 * 2025년 기말재고 = 월별재고잔액 12월과 동일하게 맞추기 위해 사용.
 * subKey=null 이면 해당 대분류 전체 중분류 합산.
 */
function stockSnapshot12(
  stock: StockData | null,
  brand: BrandKey,
  accountId: string,
  catKey: string,
  subKey: string | null
): number {
  if (!stock) return 0;
  const acc = (stock.brands[brand] ?? []).find((a) => a.account_id === accountId);
  if (!acc) return 0;
  let s = 0;
  for (const cat of acc.categories ?? []) {
    if (cat.대분류 !== catKey) continue;
    if (subKey === null) {
      for (const sub of cat.subcategories ?? []) {
        s += sub.months[12] ?? 0;
      }
    } else {
      const sub = cat.subcategories?.find((x) => x.중분류 === subKey);
      s += sub?.months[12] ?? 0;
    }
  }
  return s;
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
 * 의류: 판매 = (기초+매입) × sellThrough%, 기말재고 = 기초+매입−판매 (2026만 공식 적용)
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
  sellThroughRates: SellThroughRates = DEFAULT_SELL_THROUGH_RATES,
  retailDw2025: RetailData | null = null
): DealerAccountMetrics {
  const merged = mergeAccounts(brand, stock, retail, inbound, appOtb);
  const rows = buildRows(brand, stock, stockPrev, retail, acc.account_id, merged, inbound, appOtb);
  const is2026 = year === "2026";
  const canCalcOtb = appOtb && is2026;
  const useInbound = inbound && !is2026;

  const otbAcc = appOtb?.brands[brand]?.find((o) => o.account_id === acc.account_id);

  function getOtb(sesn: string): number {
    if (!canCalcOtb || !OTB_SEASONS.has(sesn) || !otbAcc) return 0;
    return (otbAcc.seasons[sesn]?.otb ?? 0) * 1000;
  }
  function getCum2025(sesn: string): number {
    if (!canCalcOtb || !OTB_SEASONS.has(sesn) || !otbAcc) return 0;
    return (otbAcc.seasons[sesn]?.cum2025 ?? 0) * 1000;
  }
  /** 의류 매입 = OTB - 25년 누적입고 */
  function sesPurchase(season: string): number {
    if (!OTB_SEASONS.has(season)) return 0;
    return getOtb(season) - getCum2025(season);
  }

  let apparelPurchase = 0;
  if (useInbound) {
    apparelPurchase = sumInboundForAccount(inbound!, brand, acc.account_id, "의류", null);
  } else if (canCalcOtb) {
    for (const sesn of OTB_SEASONS_ARR) {
      apparelPurchase += sesPurchase(sesn);
    }
  }

  const useApparelFormula = is2026;
  // apparelSales / apparelEnding 는 시즌별 계산 후 bottom-up 합산으로 결정됨
  // (선언만 해두고 아래 루프 완료 후 할당)
  let apparelSales = 0;
  let apparelEnding = 0;

  const hasPrev = is2026 && stockPrev && retailPrev;
  const prevMerged = hasPrev ? mergeAccounts(brand, stockPrev, retailPrev, inboundPrev) : [];
  const prevRows =
    hasPrev && retailPrev
      ? buildRows(brand, stockPrev, null, retailPrev, acc.account_id, prevMerged, inboundPrev, null)
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
    prevApparelSales = prevRows.apparel.sales;
    // 2025 기말 = 월별재고잔액 12월 스냅샷
    prevApparelEnding = stockSnapshot12(stockPrev, brand, acc.account_id, "의류", null);
    prevAccSales = prevRows.acc.sales;
    for (const { item, data } of prevRows.accItems) {
      const purch = sumInboundForAccount(inboundPrev, brand, acc.account_id, "ACC", item);
      prevAccPurchase += purch;
      prevAccEnding += stockSnapshot12(stockPrev, brand, acc.account_id, "ACC", item);
    }
  } else if (prevRows) {
    prevApparelBase = prevRows.apparel.base;
    prevApparelSales = prevRows.apparel.sales;
    // 2025 기말 = 월별재고잔액 12월 스냅샷
    prevApparelEnding = stockSnapshot12(stockPrev, brand, acc.account_id, "의류", null);
    prevAccSales = prevRows.acc.sales;
    for (const { item, data } of prevRows.accItems) {
      const ending = stockSnapshot12(stockPrev, brand, acc.account_id, "ACC", item);
      prevAccEnding += ending;
      prevAccPurchase += ending - data.base + data.sales;
    }
  }

  const prevBySeason = new Map<string, { purchase: number; sales: number; ending: number }>();
  const prevByAccItem = new Map<string, { purchase: number; sales: number; ending: number }>();
  if (prevRows && inboundPrev && hasPrev) {
    for (const { season, data } of prevRows.apparelCurrent) {
      const purch = sumInboundForAccount(inboundPrev, brand, acc.account_id, "의류", season);
      // 2025 기말 = 월별재고잔액 12월 스냅샷
      const ending = stockSnapshot12(stockPrev, brand, acc.account_id, "의류", season);
      prevBySeason.set(season, { purchase: purch, sales: data.sales, ending });
    }
    for (const grp of prevRows.apparelYearGroups) {
      for (const { season, data } of grp.seasons) {
        const purch = sumInboundForAccount(inboundPrev, brand, acc.account_id, "의류", season);
        const ending = stockSnapshot12(stockPrev, brand, acc.account_id, "의류", season);
        prevBySeason.set(season, { purchase: purch, sales: data.sales, ending });
      }
    }
    if (prevRows.apparelOld) {
      const purch = sumInboundForAccount(inboundPrev, brand, acc.account_id, "의류", "과시즌");
      const oldEnding = prevRows.apparelOld.base + purch - prevRows.apparelOld.sales;
      prevBySeason.set("과시즌", { purchase: purch, sales: prevRows.apparelOld.sales, ending: oldEnding });
    }
    for (const { item, data } of prevRows.accItems) {
      const purch = sumInboundForAccount(inboundPrev, brand, acc.account_id, "ACC", item);
      // 2025 기말 = 월별재고잔액 12월 스냅샷
      const ending = stockSnapshot12(stockPrev, brand, acc.account_id, "ACC", item);
      prevByAccItem.set(item, { purchase: purch, sales: data.sales, ending });
    }
  } else if (prevRows && hasPrev) {
    for (const { season, data } of prevRows.apparelCurrent) {
      const sales = data.sales;
      // 의류 시즌별 기말: 해당 시즌 중분류 months[12]
      const ending = stockSnapshot12(stockPrev, brand, acc.account_id, "의류", season);
      prevBySeason.set(season, { purchase: 0, sales, ending });
    }
    for (const grp of prevRows.apparelYearGroups) {
      for (const { season, data } of grp.seasons) {
        const ending = stockSnapshot12(stockPrev, brand, acc.account_id, "의류", season);
        prevBySeason.set(season, { purchase: 0, sales: data.sales, ending });
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
      // 2025 기말 = 월별재고잔액 12월 스냅샷
      const ending = stockSnapshot12(stockPrev, brand, acc.account_id, "ACC", item);
      const purch = ending - data.base + data.sales;
      prevByAccItem.set(item, { purchase: purch, sales: data.sales, ending });
    }
  }

  const posPrevRows =
    is2026 && retailDw2025 && stockPrev
      ? buildRows(
          brand,
          stockPrev,
          null,
          retailDw2025,
          acc.account_id,
          mergeAccounts(brand, stockPrev, retailDw2025, inboundPrev),
          inboundPrev,
          null
        )
      : null;

  const posPrevSalesBySeason = new Map<string, number>();
  const posPrevAccSales = new Map<string, number>();
  if (posPrevRows) {
    for (const { season, data } of posPrevRows.apparelCurrent) {
      posPrevSalesBySeason.set(season, data.sales);
    }
    for (const grp of posPrevRows.apparelYearGroups) {
      for (const { season, data } of grp.seasons) {
        posPrevSalesBySeason.set(season, data.sales);
      }
    }
    if (posPrevRows.apparelOld) {
      posPrevSalesBySeason.set("과시즌", posPrevRows.apparelOld.sales);
    }
    for (const { item, data } of posPrevRows.accItems) {
      posPrevAccSales.set(item, data.sales);
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
    const p = canCalcOtb ? sesPurchase(season) : 0;
    const purch = useInbound ? sumInboundForAccount(inbound!, brand, acc.account_id, "의류", season) : p;
    const stPct = sellThroughPctForSeason(season, sellThroughRates);
    const sales = useApparelFormula ? Math.round((data.base + purch) * (stPct / 100)) : data.sales;
    const ending = data.base + purch - sales;
    const prev = prevBySeason.get(prevSeason(season));
    const prevPs = posPrevSalesBySeason.get(prevSeason(season)) ?? 0;
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
      retailSalesPos: sales,
      prevRetailPosSales: prevPs,
      salesYoyPos: posPrevRows ? yoy(sales, prevPs) : null,
    });
  }
  const apparelYearGroups: ApparelYearGroupDetail[] = [];
  for (const grp of rows.apparelYearGroups) {
    const grpSt = sellThroughPctForYearGroup(grp.label, sellThroughRates);
    let grpPurchase = 0;
    const seasons: ApparelSeasonDetail[] = [];
    let grpPosPrev = 0;
    for (const { season, data } of grp.seasons) {
      const p = canCalcOtb ? sesPurchase(season) : 0;
      const purch = useInbound ? sumInboundForAccount(inbound!, brand, acc.account_id, "의류", season) : p;
      grpPurchase += purch;
      const sales = useApparelFormula ? Math.round((data.base + purch) * (grpSt / 100)) : data.sales;
      const ending = data.base + purch - sales;
      const prev = prevBySeason.get(prevSeason(season));
      grpPosPrev += posPrevSalesBySeason.get(prevSeason(season)) ?? 0;
      const prevPs = posPrevSalesBySeason.get(prevSeason(season)) ?? 0;
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
        retailSalesPos: sales,
        prevRetailPosSales: prevPs,
        salesYoyPos: posPrevRows ? yoy(sales, prevPs) : null,
      });
    }
    const grpSales = useApparelFormula ? Math.round((grp.data.base + grpPurchase) * (grpSt / 100)) : grp.data.sales;
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
        retailSalesPos: grpSales,
        prevRetailPosSales: grpPosPrev,
        salesYoyPos: posPrevRows ? yoy(grpSales, grpPosPrev) : null,
      },
      seasons,
    });
  }
  let apparelOld: ApparelSeasonDetail | null = null;
  if (rows.apparelOld) {
    const oldPurch = useInbound ? sumInboundForAccount(inbound!, brand, acc.account_id, "의류", "과시즌") : 0;
    const oldSales = useApparelFormula
      ? Math.round((rows.apparelOld.base + oldPurch) * (sellThroughRates.oldSeason / 100))
      : rows.apparelOld.sales;
    const ending = rows.apparelOld.base + oldPurch - oldSales;
    const oldPrev = prevBySeason.get("과시즌");
    const oldPrevPs = posPrevSalesBySeason.get("과시즌") ?? 0;
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
      retailSalesPos: oldSales,
      prevRetailPosSales: oldPrevPs,
      salesYoyPos: posPrevRows ? yoy(oldSales, oldPrevPs) : null,
    };
  }

  // bottom-up: 시즌별 계산값의 합산으로 전체 의류 판매/기말재고 산출
  if (useApparelFormula) {
    apparelSales =
      apparelCurrent.reduce((s, x) => s + x.sales, 0) +
      apparelYearGroups.reduce((s, grp) => s + grp.data.sales, 0) +
      (apparelOld?.sales ?? 0);
    apparelEnding = rows.apparel.base + apparelPurchase - apparelSales;
  } else {
    apparelSales = rows.apparel.sales;
    // 2025년: 기말 = 월별재고잔액 12월 스냅샷 (역산 아님)
    apparelEnding = stockSnapshot12(stock, brand, acc.account_id, "의류", null);
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
      // 2025년: 기말 = 월별재고잔액 12월 스냅샷 (역산 아님)
      ending = stockSnapshot12(stock, brand, acc.account_id, "ACC", item);
    } else {
      ending = weeklySales > 0 ? Math.round(weeklySales * targetW) : 0;
      purch = ending - data.base + data.sales;
    }
    accEnding += ending;
    accPurchase += purch;
    const accPrev = prevByAccItem.get(item);
    const prevAccPos = posPrevAccSales.get(item) ?? 0;
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
      salesYoyPos: posPrevRows ? yoy(data.sales, prevAccPos) : null,
      prevRetailPosSales: prevAccPos,
    });
  }

  const accWeeks = rows.acc.sales > 0 ? accEnding / ((rows.acc.sales / 365) * 7) : null;
  const sellThrough =
    rows.apparel.base + apparelPurchase > 0
      ? (apparelSales / (rows.apparel.base + apparelPurchase)) * 100
      : null;

  const posApparelPrev = posPrevRows?.apparel.sales ?? 0;
  const posAccCurr = rows.acc.sales;
  const posAccPrev = posPrevRows?.acc.sales ?? 0;

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
      ...(posPrevRows
        ? {
            retailSalesPos: apparelSales,
            prevRetailSalesPos: posApparelPrev,
            salesYoyPos: yoy(apparelSales, posApparelPrev),
          }
        : {}),
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
      ...(posPrevRows
        ? {
            retailSalesPos: posAccCurr,
            prevRetailSalesPos: posAccPrev,
            salesYoyPos: yoy(posAccCurr, posAccPrev),
          }
        : {}),
    },
    apparelCurrent,
    apparelYearGroups,
    apparelOld,
    accItemsDetail,
  };
}
