export interface SubCategoryRow {
  중분류: string;
  base_stock?: number;
  months: Record<number, number>;
  estimatedMonths?: number[];            // 리테일·재고 계획월 (F 표시)
}

export interface CategoryGroup {
  대분류: string;
  base_stock?: number;
  months: Record<number, number>;
  subcategories: SubCategoryRow[];
}

export interface AccountRow {
  account_id: string;
  account_nm_en: string;
  base_stock?: number;
  months: Record<number, number>;
  categories?: CategoryGroup[];
}

export interface StockData {
  year: string;
  brands: Record<string, AccountRow[]>;
}

export type BrandKey = "MLB" | "MLB KIDS" | "DISCOVERY";

export const BRAND_ORDER: BrandKey[] = ["MLB", "MLB KIDS", "DISCOVERY"];

export const BRAND_COLOR: Record<BrandKey, string> = {
  MLB: "bg-[linear-gradient(135deg,#e7eef7_0%,#d7e3f2_100%)]",
  "MLB KIDS": "bg-[linear-gradient(135deg,#f8efc9_0%,#f2e2a6_100%)]",
  DISCOVERY: "bg-[linear-gradient(135deg,#e2f1eb_0%,#cfe6dd_100%)]",
};

export const INVENTORY_BRAND_ROW_COLOR = BRAND_COLOR.MLB;
export const INVENTORY_HEADER_ROW_COLOR = "bg-[linear-gradient(135deg,#d3d9e1_0%,#bcc6d1_100%)]";
export const INVENTORY_TOTAL_ROW_COLOR = "bg-[linear-gradient(135deg,#c9d0d9_0%,#b2bcc8_100%)]";

export const BRAND_TEXT_COLOR: Record<BrandKey, string> = {
  MLB: "text-slate-700",
  "MLB KIDS": "text-stone-700",
  DISCOVERY: "text-teal-700",
};

export const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export interface InboundRow {
  account_id: string;
  account_nm_en: string;
  sap_shop_cd: string;
  months: Record<number, number>;
  categories?: CategoryGroup[];
}

export interface InboundData {
  year: string;
  brands: Record<string, InboundRow[]>;
}

export interface RetailRow {
  account_id: string;
  account_nm_en: string;
  sap_shop_cd: string;
  base_stock?: number;
  months: Record<number, number>;
  months_sale?: Record<number, number>; // POS 실판금액 (retail_pos_2025.json)
  categories?: CategoryGroup[];  // retail amounts (기초+입고-기말), base_stock for display
}

export interface RetailData {
  year: string;
  brands: Record<string, RetailRow[]>;
}

// ─── 매장별 직접비 구조 (FR수익구조.csv) ──────────────────────────
export interface StoreDirectCost {
  storeCode: string;       // store_cd
  accountId: string;       // account_id
  headcount: number;       // 매장인원수
  avgSalary: number;       // 평균급여 (월)
  rent: number;            // 임차료 (월)
  interiorCost: number;    // 인테리어
  bonusRate: number;       // bonus(매출기준%) decimal
  insuranceRate: number;   // 보험율 decimal
  openMonth: number;       // e.g. 202601
  amortEndMonth: number;   // e.g. 202801
  closedMonth: number | null;
}
/** store_cd → StoreDirectCost */
export type StoreDirectCostMap = Record<string, StoreDirectCost>;

// ─── 매장별 리테일 (2026_monthlyretail.csv) ──────────────────────
export interface StoreRetailRow {
  storeCode: string;  // New code
  storeName: string;  // Store Name
  months: Record<number, number>; // 1월~12월
  discountRate: number; // 전년할인율 (decimal, e.g. 0.04843)
}
/** brand → account_id → StoreRetailRow[] */
export type StoreRetailMap = Record<string, Record<string, StoreRetailRow[]>>;

// ─── 의류 OTB (app_otb_2026.json) ────────────────────────────────
export interface AppOtbSeasonData {
  otb: number;
  cum2025: number;
  cum2026: number;
  planned: number;
}

export interface AppOtbAccountRow {
  account_id: string;
  account_nm_en: string;
  seasons: Record<string, AppOtbSeasonData>;
}

export interface AppOtbData {
  year: string;
  cumLabel: string;  // 예: "26.02" → 누적입고 기준월
  brands: Record<string, AppOtbAccountRow[]>;
}

