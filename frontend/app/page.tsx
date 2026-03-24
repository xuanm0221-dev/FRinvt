import { Suspense } from "react";
import DashboardClient from "./DashboardClient";
import { StockData, InboundData, RetailData, AppOtbData, BRAND_ORDER } from "../lib/types";
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
          />
        </Suspense>
      </main>
    </div>
  );
}
