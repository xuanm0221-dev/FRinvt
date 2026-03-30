"use client";

import { useState, useEffect } from "react";
import { BrandKey, StockData, InboundData, RetailData, AppOtbData, StoreRetailMap, StoreDirectCostMap, RetailStoreData } from "../lib/types";
import StockView, { type AccountNameMap, DEFAULT_GROWTH } from "./components/StockView";
import StockSimuView from "./components/StockSimuView";
import PLView from "./components/PLView";
import { TableIcon, ChartBarIcon, LayoutDashboardIcon, Square2StackIcon } from "./components/Icons";
import { DEFAULT_TARGET_WEEKS } from "../lib/dealerMetrics";

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
  { id: "stock", label: "재고자산(목표)", Icon: TableIcon },
  { id: "stockSimu", label: "재고자산(PL기준)", Icon: Square2StackIcon },
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

  // 목표 탭·simu 탭 공유 state
  const [growthRates, setGrowthRates] = useState<Record<BrandKey, number>>(DEFAULT_GROWTH);
  const [targetWeeks, setTargetWeeks] = useState<Record<string, number>>(DEFAULT_TARGET_WEEKS);
  const [sellThrough, setSellThrough] = useState(70);

  useEffect(() => {
    fetch("/data/growth_rates_default.json")
      .then((r) => r.json())
      .then(setGrowthRates)
      .catch(() => {});
  }, []);

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
        </div>
      </header>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {activeTab === "overview" && (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-20 text-center">
            <p className="text-sm font-medium text-slate-600">종합분석</p>
            <p className="mt-2 text-xs text-slate-500">
              재고자산(목표)·재고자산(PL기준)·PL 연계 분석은 이후 이 탭에 추가 예정입니다.
            </p>
          </div>
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
            sellThrough={sellThrough}
            retailDw2025={retailDw2025}
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
            growthRates={growthRates}
            onGrowthRatesChange={setGrowthRates}
            targetWeeks={targetWeeks}
            onTargetWeeksChange={setTargetWeeks}
            sellThrough={sellThrough}
            onSellThroughChange={setSellThrough}
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
          />
        )}
      </div>
    </div>
  );
}
