"use client";

import { useState } from "react";
import { StockData, InboundData, RetailData, AppOtbData } from "../lib/types";
import StockView from "./components/StockView";
import PLView from "./components/PLView";
import { TableIcon, ChartBarIcon } from "./components/Icons";

interface Props {
  data2025: StockData | null;
  data2026: StockData | null;
  inbound2025: InboundData | null;
  inbound2026: InboundData | null;
  retail2026: RetailData | null;
  appOtb2026: AppOtbData | null;
}

const TABS = [
  { id: "stock", label: "재고자산", Icon: TableIcon },
  { id: "pl", label: "PL", Icon: ChartBarIcon },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function DashboardClient({ data2025, data2026, inbound2025, inbound2026, retail2026, appOtb2026 }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("stock");

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
        {activeTab === "stock" && (
          <StockView
            data2025={data2025}
            data2026={data2026}
            inbound2025={inbound2025}
            inbound2026={inbound2026}
            retail2026={retail2026}
            appOtb2026={appOtb2026}
          />
        )}
        {activeTab === "pl" && <PLView />}
      </div>
    </div>
  );
}
