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
  const appOtb2026 = loadJson<AppOtbData>("app_otb_2026.json");

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
            appOtb2026={appOtb2026}
          />
        </Suspense>
      </main>
    </div>
  );
}
