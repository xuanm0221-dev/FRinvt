"use client";

import { BrandKey, BRAND_ORDER } from "../../lib/types";

const BRAND_DOT: Record<BrandKey, string> = {
  MLB: "bg-blue-500",
  "MLB KIDS": "bg-amber-400",
  DISCOVERY: "bg-emerald-500",
};

interface Props {
  rates: Record<BrandKey, number>;
  onChange: (rates: Record<BrandKey, number>) => void;
  brand?: BrandKey;
}

export default function GrowthRateTable({ rates, onChange, brand }: Props) {
  const brandList = brand ? [brand] : BRAND_ORDER;
  const handleChange = (brand: BrandKey, value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return;
    onChange({ ...rates, [brand]: num });
  };

  return (
    <div className="mb-6 inline-block overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_4px_20px_rgba(15,23,42,0.08)]">
      <div className="flex items-center justify-between bg-[#1e3a5f] px-5 py-3">
        <h3 className="text-sm font-bold tracking-tight text-white">
          리테일 성장률
        </h3>
        <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[10px] font-medium text-white">
          FY 2026
        </span>
      </div>
      <table className="w-full border-separate border-spacing-0">
        <thead>
          <tr className="bg-slate-100/80">
            <th className="px-5 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500">
              브랜드
            </th>
            <th className="px-5 py-2.5 text-center text-[11px] font-medium uppercase tracking-wider text-slate-500">
              성장률
            </th>
          </tr>
        </thead>
        <tbody>
          {brandList.map((brand, idx) => {
            const value = rates[brand];
            const isHigh = value >= 200;
            return (
              <tr
                key={brand}
                className={`transition-colors ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"} hover:bg-slate-50/80`}
              >
                <td className="whitespace-nowrap rounded-l px-5 py-2.5 text-sm font-medium text-slate-700">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${BRAND_DOT[brand]}`}
                      aria-hidden
                    />
                    {brand}
                  </div>
                </td>
                <td className="px-5 py-2.5">
                  <div className="flex items-center justify-center gap-1.5">
                    <input
                      type="number"
                      min={0}
                      max={999}
                      step={1}
                      value={rates[brand]}
                      onChange={(e) => handleChange(brand, e.target.value)}
                      className={`h-7 w-16 rounded-full border-0 py-0.5 pr-2 text-center text-sm font-semibold tabular-nums outline-none focus:ring-2 focus:ring-slate-300 ${
                        isHigh
                          ? "bg-emerald-500/90 text-white placeholder:text-emerald-200"
                          : "bg-[#1e3a5f] text-white placeholder:text-white/60"
                      }`}
                    />
                    <span className="text-sm text-slate-400">%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
