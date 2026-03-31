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
  rent: number;            // 임차료 (월), CSV — 고정임차 산출 시 /1.05
  interiorCost: number;    // 인테리어 (메인: 총액÷개월 / 모달: 월 감가액)
  bonusRate: number;       // bonus(매출기준%) decimal
  insuranceRate: number;   // 보험율 decimal
  commissionRate: number;  // 수수료율 decimal (변동임차)
  openMonth: number;       // e.g. 202601
  /** 감가 종료 yyyyMM — CSV Remodeling end Month 우선, 비어 있으면 Amortization end Month */
  amortEndMonth: number;
  closedMonth: number | null;
  storeAreaM2: number;     // Store Area (㎡), FR수익구조.csv
  storeType: string;
  tradeZone: string;
  /** FR수익구조.csv region_nm (한글 지역명 등) */
  regionNm: string;
  /** FR수익구조.csv city_nm (한글 도시명 등) */
  cityNm: string;
  /** city_tier_map.json — CSV 城市 → MST_SHOP_ALL.city_nm 매칭 */
  cityTierNm?: string;
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

// ─── PL 실적 매장 단위 (retail_store_2026.json) ──────────────────
export interface RetailStoreRow {
  storeCode: string;      // MST_SHOP_ALL.shop_id (= FR수익구조 store_cd)
  /** MST_SHOP_ALL.shop_nm_en — 전처리 후 JSON에 포함 */
  shopNmEn?: string;
  /** MST_SHOP_ALL.shop_nm_cn */
  shopNmCn?: string;
  /** MST_SHOP_ALL.city_tier_nm */
  cityTierNm?: string;
  storeType: string;      // anlys_shop_type_nm (FO/FP/Pop-up 등)
  tradeZone: string;      // trade_zone_nm (H/F1 등)
  regionCd: string;       // sale_region_cd (중국어)
  regionKr: string;       // region_nm (한국어, FR수익구조.csv 매핑)
  months: Record<string, number>;           // 월별 tag_amt
  months_sale: Record<string, number>;      // 월별 sale_amt (리테일V+)
  months_apparel?: Record<string, number>;  // 월별 의류 tag_amt
  months_acc?: Record<string, number>;      // 월별 ACC tag_amt
  months_etc?: Record<string, number>;      // 월별 미정 tag_amt
}

export interface RetailStoreAccount {
  account_id: string;
  stores: RetailStoreRow[];
}

export interface RetailStoreData {
  year: string;
  brands: Record<string, RetailStoreAccount[]>;
}

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

