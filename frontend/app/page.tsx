import { Suspense } from "react";
import DashboardClient from "./DashboardClient";
import { StockData, InboundData, RetailData, AppOtbData, BRAND_ORDER, StoreRetailMap, StoreDirectCostMap } from "../lib/types";
import path from "path";
import fs from "fs";

function loadJson<T>(filename: string): T | null {
  try {
    const filePath = path.join(process.cwd(), "public", "data", filename);
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function loadAccountNameMap(): Record<string, { account_nm_en: string; account_nm_kr: string }> {
  const candidates = [
    path.join(process.cwd(), "fr_master.csv"),
    path.join(process.cwd(), "..", "fr_master.csv"),
    path.join(process.cwd(), "..", "..", "fr_master.csv"),
  ];
  let raw: string | null = null;
  for (const p of candidates) {
    try {
      raw = fs.readFileSync(p, "utf-8");
      break;
    } catch {
      continue;
    }
  }
  if (!raw) return {};
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return {};
  const headers = lines[0].split(",").map((h) => h.trim());
  const idIdx = headers.indexOf("account_id");
  const enIdx = headers.indexOf("account_nm_en");
  const krIdx = headers.indexOf("account_nm_kr");
  if (idIdx < 0 || enIdx < 0 || krIdx < 0) return {};
  const result: Record<string, { account_nm_en: string; account_nm_kr: string }> = {};
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvRow(lines[i]);
    const id = row[idIdx]?.trim();
    const en = row[enIdx]?.trim() ?? "";
    const kr = row[krIdx]?.trim() ?? "";
    if (id && (en || kr)) result[id] = { account_nm_en: en, account_nm_kr: kr };
  }
  return result;
}

function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuote = !inQuote;
    } else if ((c === "," && !inQuote) || c === "\n" || c === "\r") {
      out.push(cur);
      cur = "";
      if (c !== ",") break;
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/** brd_cd × account_id → 출고율 맵 로딩 (2025_FR_출고율.csv) */
function loadCogsRateMap(): Record<string, Record<string, number>> {
  const candidates = [
    path.join(process.cwd(), "2025_FR_출고율.csv"),
    path.join(process.cwd(), "..", "2025_FR_출고율.csv"),
    path.join(process.cwd(), "..", "..", "2025_FR_출고율.csv"),
  ];
  let raw: string | null = null;
  for (const p of candidates) {
    try { raw = fs.readFileSync(p, "utf-8"); break; } catch { continue; }
  }
  if (!raw) return {};
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return {};
  const headers = lines[0].split(",").map((h) => h.trim());
  const brdIdx = headers.indexOf("brd_cd");
  const rateIdx = headers.indexOf("출고율");
  const accIdx = headers.indexOf("account_id");
  if (rateIdx < 0) return {};

  const result: Record<string, Record<string, number>> = {};
  let globalAvg = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const brd = brdIdx >= 0 ? (cols[brdIdx] ?? "") : "";
    const acc = accIdx >= 0 ? (cols[accIdx] ?? "") : "";
    const rate = parseFloat(cols[rateIdx] ?? "");
    if (isNaN(rate)) continue;
    if (!brd && !acc) { globalAvg = rate; continue; }
    if (!brd) continue;
    if (!result[brd]) result[brd] = {};
    const key = acc || `_no_id_${i}`;
    result[brd][key] = rate;
    if (!result[brd]["평균"]) result[brd]["평균"] = rate;
  }
  // 브랜드에 평균이 없으면 전체 평균 사용
  for (const brd of Object.keys(result)) {
    if (!result[brd]["평균"]) result[brd]["평균"] = globalAvg;
  }
  if (globalAvg && !result["평균"]) result["평균"] = { "평균": globalAvg };
  return result;
}

/** 숫자 문자열 파싱: " 20,000.00 " → 20000 */
function parseNum(s: string): number {
  const v = parseFloat(s.replace(/,/g, "").trim());
  return isNaN(v) ? 0 : v;
}

/** FR수익구조.csv → store_cd → StoreDirectCost
 *
 * 컬럼 레이아웃 (0-based):
 *  0 account_id | 3 store_cd | 5 매장인원수 | 6 임차료
 *  8 인테리어   | 9 평균급여  | 10 보험율   | 11 bonus(매출기준%)
 * 15 Open Month | 16 Amortization end Month | 17 Closed Month
 * Store Area (㎡)
 */
function loadStoreDirectCostMap(): StoreDirectCostMap {
  const candidates = [
    path.join(process.cwd(), "FR수익구조.csv"),
    path.join(process.cwd(), "..", "FR수익구조.csv"),
    path.join(process.cwd(), "..", "..", "FR수익구조.csv"),
  ];
  let raw: string | null = null;
  for (const p of candidates) {
    try { raw = fs.readFileSync(p, "utf-8"); break; } catch { continue; }
  }
  if (!raw) return {};

  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return {};
  const headers = lines[0].replace(/^\uFEFF/, "").split(",").map((h) => h.trim());

  // 영문 컬럼은 이름으로 찾고, 한글 컬럼은 고정 인덱스 fallback
  const idxOf = (name: string) => headers.indexOf(name);
  const fi = (name: string, fallback: number) => {
    const i = headers.findIndex((h) => h.toLowerCase().includes(name.toLowerCase()));
    return i >= 0 ? i : fallback;
  };

  const accIdx   = idxOf("account_id");
  const storeIdx = idxOf("store_cd");
  const openIdx  = idxOf("Open Month");
  const amortIdx = idxOf("Amortization end Month");
  const closedIdx = idxOf("Closed Month");
  const storeAreaHeaderIdx = idxOf("Store Area");
  const areaIdx =
    storeAreaHeaderIdx >= 0
      ? storeAreaHeaderIdx
      : headers.findIndex((h) => h.toLowerCase().includes("store area"));

  // 한글 컬럼: findIndex로 시도, 실패 시 고정 인덱스
  const hcIdx    = fi("인원", 5);       // 매장인원수
  const rentIdx  = fi("차료", 6);       // 임차료 (" 임차료 " 등 공백 포함 가능)
  const interIdx = fi("테리어", 8);     // 인테리어
  const salIdx   = fi("급여", 9);       // 평균급여
  const insIdx   = fi("보험", 10);      // 보험율
  const bonusIdx = fi("bonus", 11);    // bonus(매출기준%)
  const commissionIdx = idxOf("수수료율");
  const storeTypeIdx = idxOf("Store Type");
  const tradeZoneIdx = headers.findIndex(
    (h) => h.trim().toLowerCase() === "trade zone" || h.includes("Trade Zone")
  );

  if (storeIdx < 0 || accIdx < 0) return {};

  const result: StoreDirectCostMap = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    const storeCode = cols[storeIdx]?.trim() ?? "";
    const accountId = cols[accIdx]?.trim() ?? "";
    if (!storeCode || !accountId) continue;

    const openRaw   = parseInt(cols[openIdx]?.trim()   ?? "0", 10);
    const amortRaw  = parseInt(cols[amortIdx]?.trim()  ?? "0", 10);
    const closedRaw = parseInt(cols[closedIdx]?.trim() ?? "0", 10);

    const areaVal =
      areaIdx >= 0 ? parseNum(cols[areaIdx] ?? "0") : 0;

    result[storeCode] = {
      storeCode,
      accountId,
      headcount:     parseNum(cols[hcIdx]    ?? "0"),
      avgSalary:     parseNum(cols[salIdx]   ?? "0"),
      rent:          parseNum(cols[rentIdx]  ?? "0"),
      interiorCost:  parseNum(cols[interIdx] ?? "0"),
      bonusRate:     parseNum(cols[bonusIdx] ?? "0"),
      insuranceRate: parseNum(cols[insIdx]   ?? "0"),
      commissionRate: commissionIdx >= 0 ? parseNum(cols[commissionIdx] ?? "0") : 0,
      openMonth:     isNaN(openRaw)   ? 0 : openRaw,
      amortEndMonth: isNaN(amortRaw)  ? 0 : amortRaw,
      closedMonth:   closedRaw > 0   ? closedRaw : null,
      storeAreaM2:   areaVal,
      storeType:     storeTypeIdx >= 0 ? (cols[storeTypeIdx]?.trim() ?? "") : "",
      tradeZone:     tradeZoneIdx >= 0 ? (cols[tradeZoneIdx]?.trim() ?? "") : "",
    };
  }
  return result;
}

/** 2026_monthlyretail.csv → brand × account_id × StoreRetailRow[] */
function loadStoreRetailMap(): StoreRetailMap {
  const candidates = [
    path.join(process.cwd(), "2026_monthlyretail.csv"),
    path.join(process.cwd(), "..", "2026_monthlyretail.csv"),
    path.join(process.cwd(), "..", "..", "2026_monthlyretail.csv"),
  ];
  let raw: string | null = null;
  for (const p of candidates) {
    try { raw = fs.readFileSync(p, "utf-8"); break; } catch { continue; }
  }
  if (!raw) return {};

  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return {};
  const headers = lines[0].split(",").map((h) => h.trim());

  const brandIdx = headers.indexOf("brand");
  const accIdx = headers.indexOf("account_id");
  const codeIdx = headers.indexOf("New code");
  const nameIdx = headers.indexOf("Store Name");
  const frClsIdx = headers.indexOf("fr_or_cls");
  // 전년할인율: 헤더 이름 매칭 (인덱스 2, "전년할인율")
  const discountIdx = headers.findIndex((h) => h.includes("할인율"));
  const monthIdxs: Record<number, number> = {};
  for (let m = 1; m <= 12; m++) {
    const i = headers.findIndex((h) => h.trim() === `${m}월`);
    if (i >= 0) monthIdxs[m] = i;
  }

  if (brandIdx < 0 || accIdx < 0 || codeIdx < 0 || nameIdx < 0) return {};

  const result: StoreRetailMap = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    const brand = cols[brandIdx]?.trim() ?? "";
    const accId = cols[accIdx]?.trim() ?? "";
    const storeCode = cols[codeIdx]?.trim() ?? "";
    const storeName = cols[nameIdx]?.trim() ?? "";
    const frCls = frClsIdx >= 0 ? (cols[frClsIdx]?.trim() ?? "") : "";
    if (!brand || !accId || !storeCode) continue;
    if (frCls && frCls !== "FR") continue; // FR 대리상만 포함

    const months: Record<number, number> = {};
    for (const [m, idx] of Object.entries(monthIdxs)) {
      const v = parseFloat(cols[idx] ?? "");
      months[Number(m)] = isNaN(v) ? 0 : v;
    }

    // "4.8430%" → 0.04843
    let discountRate = 0;
    if (discountIdx >= 0) {
      const raw = (cols[discountIdx] ?? "").trim().replace("%", "");
      const parsed = parseFloat(raw);
      if (!isNaN(parsed)) discountRate = parsed / 100;
    }

    if (!result[brand]) result[brand] = {};
    if (!result[brand][accId]) result[brand][accId] = [];
    result[brand][accId].push({ storeCode, storeName, months, discountRate });
  }
  return result;
}

/** 2026 기초재고 = 2025년 12월 재고잔액 (stock_2025.json에서 파생) */
function inject2026BaseStock(data2026: StockData, data2025: StockData): StockData {
  for (const brand of BRAND_ORDER) {
    const map2025 = Object.fromEntries(
      (data2025.brands[brand] ?? []).map((a) => [a.account_id, a.months[12] ?? 0])
    );
    for (const acc of data2026.brands[brand] ?? []) {
      acc.base_stock = map2025[acc.account_id] ?? 0;
    }
  }
  return data2026;
}

export default async function Home() {
  const data2025 = loadJson<StockData>("stock_2025.json");
  const data2026Raw = loadJson<StockData>("stock_2026.json");
  const data2026 = data2026Raw && data2025 ? inject2026BaseStock(data2026Raw, data2025) : data2026Raw;
  const inbound2025 = loadJson<InboundData>("inbound_2025.json");
  const inbound2026 = loadJson<InboundData>("inbound_2026.json");
  const retail2026 = loadJson<RetailData>("retail_2026.json");
  const retailPlan2026 = loadJson<RetailData>("retail_plan_2026.json");
  const retailPos2025 = loadJson<RetailData>("retail_pos_2025.json");
  const appOtb2026 = loadJson<AppOtbData>("app_otb_2026.json");
  const accountNameMap = loadAccountNameMap();
  const cogsRateMap = loadCogsRateMap();
  const storeRetailMap = loadStoreRetailMap();
  const storeDirectCostMap = loadStoreDirectCostMap();
  const retailYoy2024Raw = loadJson<{ year: number; stores: Record<string, Record<string, number>> }>("retail_yoy_2024.json");
  const retailYoy2024Map: Record<string, Record<number, number>> | null = retailYoy2024Raw
    ? Object.fromEntries(
        Object.entries(retailYoy2024Raw.stores).map(([code, months]) => [
          code,
          Object.fromEntries(Object.entries(months).map(([m, v]) => [Number(m), v])),
        ])
      )
    : null;

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--bg)" }}>
      <main className="px-6 py-6">
        <Suspense fallback={<div className="text-slate-400 text-sm">로딩 중...</div>}>
          <DashboardClient
            data2025={data2025}
            data2026={data2026}
            inbound2025={inbound2025}
            inbound2026={inbound2026}
            retail2026={retail2026}
            retailPlan2026={retailPlan2026}
            retailPos2025={retailPos2025}
            appOtb2026={appOtb2026}
            accountNameMap={accountNameMap}
            cogsRateMap={cogsRateMap}
            storeRetailMap={storeRetailMap}
            storeDirectCostMap={storeDirectCostMap}
            retailYoy2024Map={retailYoy2024Map}
          />
        </Suspense>
      </main>
    </div>
  );
}
