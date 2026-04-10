"use client";

import { useState, useEffect, useMemo } from "react";
import { BrandKey, BRAND_ORDER, StockData, InboundData, RetailData, AppOtbData, StoreRetailMap, StoreDirectCostMap, RetailStoreData } from "../lib/types";
import StockView, { type AccountNameMap, DEFAULT_GROWTH, blendRetail } from "./components/StockView";
import OverviewScenario1Table from "./components/OverviewScenario1Table";
import StockSimuView from "./components/StockSimuView";
import PLView from "./components/PLView";
import { TableIcon, ChartBarIcon, LayoutDashboardIcon, Square2StackIcon } from "./components/Icons";
import { DEFAULT_TARGET_WEEKS, DEFAULT_SELL_THROUGH_RATES, type SellThroughRates, mergeAccounts, computeAccountMetrics } from "../lib/dealerMetrics";

interface Props {
  data2025: StockData | null;
  data2026: StockData | null;
  inbound2025: InboundData | null;
  inbound2026: InboundData | null;
  retail2026: RetailData | null;
  retailPlan2026: RetailData | null;
  retailPos2025: RetailData | null;
  retailDw2025: RetailData | null;
  appOtb2026: AppOtbData | null;
  accountNameMap?: AccountNameMap;
  cogsRateMap?: Record<string, Record<string, number>>;
  storeRetailMap?: StoreRetailMap;
  storeDirectCostMap?: StoreDirectCostMap;
  retailYoy2025Map?: Record<string, Record<number, number>> | null;
  retailStore2026?: RetailStoreData | null;
  actualCogsRateMap?: Record<string, Record<string, Record<number, number>>> | null;
}

const TABS = [
  { id: "overview", label: "종합분석", Icon: LayoutDashboardIcon },
  { id: "stock", label: "재고자산(TGT)", Icon: TableIcon },
  { id: "stockSimu", label: "재고자산(BO.목표)", Icon: Square2StackIcon },
  { id: "pl", label: "PL", Icon: ChartBarIcon },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function DashboardClient({
  data2025,
  data2026,
  inbound2025,
  inbound2026,
  retail2026,
  retailPlan2026,
  retailPos2025,
  retailDw2025,
  appOtb2026,
  accountNameMap = {},
  cogsRateMap = {},
  storeRetailMap = {},
  storeDirectCostMap = {},
  retailYoy2025Map = null,
  retailStore2026 = null,
  actualCogsRateMap = null,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("stock");
  const [selectedBrand, setSelectedBrand] = useState<BrandKey>("MLB");

  // 목표 탭·simu 탭 공유 state
  const [growthRates, setGrowthRates] = useState<Record<BrandKey, number>>(DEFAULT_GROWTH);
  const [targetWeeks, setTargetWeeks] = useState<Record<string, number>>(DEFAULT_TARGET_WEEKS);
  const [sellThroughRates, setSellThroughRates] = useState<SellThroughRates>(() => ({
    ...DEFAULT_SELL_THROUGH_RATES,
    bySeason: { ...DEFAULT_SELL_THROUGH_RATES.bySeason },
    yearGroup: { ...DEFAULT_SELL_THROUGH_RATES.yearGroup },
  }));

  useEffect(() => {
    fetch("/data/growth_rates_default.json")
      .then((r) => r.json())
      .then(setGrowthRates)
      .catch(() => {});
  }, []);

  /** 재고자산(TGT) 시뮬레이션 기준 대리상별 Tag = apparel.sales + acc.sales(Tag) */
  const tgtRetailMap = useMemo((): Record<string, Record<string, number>> => {
    if (!data2026) return {};
    const blended = retail2026 ? blendRetail(retail2026, growthRates, retailDw2025) : null;
    const retailForCalc = blended?.data ?? retail2026;
    const result: Record<string, Record<string, number>> = {};
    for (const brand of BRAND_ORDER) {
      const merged = mergeAccounts(brand, data2026, retailForCalc, inbound2026, appOtb2026);
      const map: Record<string, number> = {};
      for (const acc of merged) {
        const m = computeAccountMetrics(
          acc, brand, data2026, data2025, retailForCalc, retailDw2025,
          inbound2026, inbound2025, appOtb2026, "2026",
          targetWeeks, sellThroughRates, retailDw2025,
        );
        map[acc.account_id] = m.apparel.sales + m.acc.sales;
      }
      result[brand] = map;
    }
    return result;
  }, [data2025, data2026, retail2026, retailDw2025, inbound2025, inbound2026, appOtb2026, growthRates, targetWeeks, sellThroughRates]);

  return (
    <div>
      <header className="sticky top-0 z-40 -mx-6 -mt-6 mb-6 border-b border-stone-200 bg-[linear-gradient(180deg,#fffdfa_0%,#ffffff_100%)] px-6 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-4 py-3.5">
          <div className="h-6 w-1.5 shrink-0 rounded-full bg-[linear-gradient(180deg,#3f6ea1_0%,#245089_100%)] shadow-sm" />
          <h1 className="whitespace-nowrap text-xl font-bold tracking-[-0.02em] text-slate-800">
            FR물동량
          </h1>

          <div className="ml-4 flex gap-2 rounded-2xl bg-stone-100/80 p-1.5 ring-1 ring-stone-200/80">
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-200 ${
                  activeTab === id
                    ? "bg-[linear-gradient(135deg,#3c6aa1_0%,#245089_100%)] text-white shadow-[0_10px_24px_rgba(36,80,137,0.22)]"
                    : "bg-transparent text-slate-600 hover:bg-white/80 hover:text-slate-800"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          {/* 글로벌 브랜드 선택 */}
          <div className="ml-4 flex gap-1 rounded-xl bg-slate-100/90 p-1">
            {BRAND_ORDER.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setSelectedBrand(b)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  selectedBrand === b
                    ? "bg-white text-[#2f5f93] shadow-sm"
                    : "text-slate-600 hover:bg-white/70"
                }`}
              >
                {b}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div
        className={`rounded-2xl border border-slate-200 bg-white p-6 shadow-sm ${
          activeTab === "overview" ? "w-fit max-w-full" : "w-full"
        }`}
      >
        {activeTab === "overview" && (
          <OverviewScenario1Table
            data2025={data2025}
            data2026={data2026}
            inbound2025={inbound2025}
            inbound2026={inbound2026}
            retail2026={retail2026}
            retailDw2025={retailDw2025}
            appOtb2026={appOtb2026}
            accountNameMap={accountNameMap}
            brand={selectedBrand}
            growthRates={growthRates}
            targetWeeks={targetWeeks}
            sellThroughRates={sellThroughRates}
            storeRetailMap={storeRetailMap}
            storeDirectCostMap={storeDirectCostMap}
            cogsRateMap={cogsRateMap}
            retailYoy2025Map={retailYoy2025Map}
          />
        )}
        {activeTab === "stockSimu" && (
          <StockSimuView
            data2025={data2025}
            data2026={data2026}
            inbound2025={inbound2025}
            inbound2026={inbound2026}
            retail2026={retail2026}
            appOtb2026={appOtb2026}
            storeRetailMap={storeRetailMap}
            accountNameMap={accountNameMap}
            growthRates={growthRates}
            targetWeeks={targetWeeks}
            sellThroughRates={sellThroughRates}
            retailDw2025={retailDw2025}
            selectedBrand={selectedBrand}
          />
        )}
        {activeTab === "stock" && (
          <StockView
            data2025={data2025}
            data2026={data2026}
            inbound2025={inbound2025}
            inbound2026={inbound2026}
            retail2026={retail2026}
            retailPlan2026={retailPlan2026}
            retailPos2025={retailPos2025}
            retailDw2025={retailDw2025}
            appOtb2026={appOtb2026}
            accountNameMap={accountNameMap}
            selectedBrand={selectedBrand}
            onSelectedBrandChange={setSelectedBrand}
            growthRates={growthRates}
            onGrowthRatesChange={setGrowthRates}
            targetWeeks={targetWeeks}
            onTargetWeeksChange={setTargetWeeks}
            sellThroughRates={sellThroughRates}
            onSellThroughRatesChange={setSellThroughRates}
          />
        )}
        {activeTab === "pl" && (
          <PLView
            cogsRateMap={cogsRateMap}
            accountNameMap={accountNameMap}
            storeRetailMap={storeRetailMap}
            storeDirectCostMap={storeDirectCostMap}
            retailYoy2025Map={retailYoy2025Map}
            retailStore2026={retailStore2026}
            actualCogsRateMap={actualCogsRateMap}
            tgtRetailMap={tgtRetailMap}
            selectedBrand={selectedBrand}
            onSelectedBrandChange={setSelectedBrand}
          />
        )}
      </div>
    </div>
  );
}
