"use client";

import { useState } from "react";
import { AccountRow, CategoryGroup, MONTHS } from "../../lib/types";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";
import { fmtAmt } from "../../lib/utils";

function isOldSeason(중분류: string, cutoff: number): boolean {
  if (중분류 === "과시즌") return false;
  const yr = parseInt(중분류.slice(0, 2));
  return !isNaN(yr) && yr < cutoff;
}

// ─────────────────────────────────────────────
// 중분류 행 (leaf)
// ─────────────────────────────────────────────
function SubCategoryTr({
  sub,
  depth,
  estimatedSet,
}: {
  sub: { 중분류: string; base_stock?: number; months: Record<number, number> };
  depth: number;
  estimatedSet: Set<number>;
}) {
  const indent = depth * 20;
  return (
    <tr className="bg-slate-50/40">
      <td className="sticky left-0 z-10 min-w-[240px] border-b border-stone-100 bg-slate-50/40 px-6 py-2 text-sm">
        <div
          className="flex items-center gap-1 text-slate-500"
          style={{ paddingLeft: `${indent}px` }}
        >
          <span className="mr-1 text-slate-300 select-none">└</span>
          <span className="text-[12px]">{sub.중분류}</span>
        </div>
      </td>
      {/* 중분류 기초재고 */}
      <td className="whitespace-nowrap border-b border-stone-100 bg-slate-50/40 px-3 py-2 text-right text-[12px] text-slate-400 tabular-nums">
        {fmtAmt(sub.base_stock)}
      </td>
      {MONTHS.map((m) => (
        <td
          key={m}
          className={`whitespace-nowrap border-b border-stone-100 bg-slate-50/40 px-3 py-2 text-right text-[12px] tabular-nums${estimatedSet.has(m) ? " italic text-slate-400" : " text-slate-500"}`}
        >
          {fmtAmt(sub.months[m])}
        </td>
      ))}
    </tr>
  );
}

// ─────────────────────────────────────────────
// 과시즌 그룹 행 (접기/펴기)
// ─────────────────────────────────────────────
function PastSeasonGroup({
  subs,
  depth,
  estimatedSet,
}: {
  subs: { 중분류: string; base_stock?: number; months: Record<number, number> }[];
  depth: number;
  estimatedSet: Set<number>;
}) {
  const [pastOpen, setPastOpen] = useState(false);
  const indent = depth * 20;
  const sumBase = subs.reduce((s, sub) => s + (sub.base_stock ?? 0), 0);
  const sumMonths: Record<number, number> = {};
  MONTHS.forEach((m) => {
    sumMonths[m] = subs.reduce((s, sub) => s + (sub.months[m] ?? 0), 0);
  });

  return (
    <>
      <tr
        className="cursor-pointer bg-slate-50/40 hover:brightness-[0.97]"
        onClick={() => setPastOpen((v) => !v)}
      >
        <td className="sticky left-0 z-10 min-w-[240px] border-b border-stone-100 bg-slate-50/40 px-6 py-2 text-sm">
          <div className="flex items-center gap-1 text-slate-500" style={{ paddingLeft: `${indent}px` }}>
            <span className="mr-1 text-slate-300 select-none">└</span>
            {pastOpen ? (
              <ChevronDownIcon className="h-3 w-3 text-slate-400" />
            ) : (
              <ChevronRightIcon className="h-3 w-3 text-slate-400" />
            )}
            <span className="text-[12px] text-slate-500">과시즌</span>
            <span className="ml-1 text-[10px] text-slate-400">({subs.length})</span>
          </div>
        </td>
        <td className="whitespace-nowrap border-b border-stone-100 bg-slate-50/40 px-3 py-2 text-right text-[12px] text-slate-400 tabular-nums">
          {fmtAmt(sumBase)}
        </td>
        {MONTHS.map((m) => (
          <td
            key={m}
            className={`whitespace-nowrap border-b border-stone-100 bg-slate-50/40 px-3 py-2 text-right text-[12px] tabular-nums${estimatedSet.has(m) ? " italic text-slate-400" : " text-slate-500"}`}
          >
            {fmtAmt(sumMonths[m])}
          </td>
        ))}
      </tr>
      {pastOpen &&
        subs.map((sub) => (
          <SubCategoryTr key={sub.중분류} sub={sub} depth={depth + 1} estimatedSet={estimatedSet} />
        ))}
    </>
  );
}

// ─────────────────────────────────────────────
// 대분류 행 (접기/펴기)
// ─────────────────────────────────────────────
function CategorySection({
  cat,
  depth,
  estimatedSet,
  seasonCutoffYear,
}: {
  cat: CategoryGroup;
  depth: number;
  estimatedSet: Set<number>;
  seasonCutoffYear?: number;
}) {
  const [open, setOpen] = useState(false);
  const indent = depth * 20;

  return (
    <>
      <tr
        className="cursor-pointer bg-slate-100/60 hover:brightness-[0.97]"
        onClick={() => setOpen((v) => !v)}
      >
        <td className="sticky left-0 z-10 min-w-[240px] border-b border-stone-200 bg-slate-100/60 px-6 py-2.5 text-sm font-medium text-slate-600">
          <div
            className="inline-flex items-center gap-1"
            style={{ paddingLeft: `${indent}px` }}
          >
            {open ? (
              <ChevronDownIcon className="h-3.5 w-3.5 text-slate-500" />
            ) : (
              <ChevronRightIcon className="h-3.5 w-3.5 text-slate-500" />
            )}
            <span>{cat.대분류}</span>
            <span className="ml-1 text-[11px] font-normal text-slate-400">
              ({cat.subcategories.length})
            </span>
          </div>
        </td>
        {/* 대분류 기초재고 */}
        <td className="whitespace-nowrap border-b border-stone-200 bg-slate-100/60 px-3 py-2.5 text-right text-[12px] font-medium text-slate-500 tabular-nums">
          {fmtAmt(cat.base_stock)}
        </td>
        {MONTHS.map((m) => (
          <td
            key={m}
            className={`whitespace-nowrap border-b border-stone-200 bg-slate-100/60 px-3 py-2.5 text-right text-[12px] font-medium tabular-nums${estimatedSet.has(m) ? " italic text-slate-400" : " text-slate-600"}`}
          >
            {fmtAmt(cat.months[m])}
          </td>
        ))}
      </tr>

      {open && (() => {
        if (cat.대분류 !== "의류" || !seasonCutoffYear) {
          return cat.subcategories.map((sub) => (
            <SubCategoryTr key={sub.중분류} sub={sub} depth={depth + 1} estimatedSet={estimatedSet} />
          ));
        }
        const recent = cat.subcategories.filter((s) => !isOldSeason(s.중분류, seasonCutoffYear));
        const old = cat.subcategories.filter((s) => isOldSeason(s.중분류, seasonCutoffYear));
        return (
          <>
            {recent.map((sub) => (
              <SubCategoryTr key={sub.중분류} sub={sub} depth={depth + 1} estimatedSet={estimatedSet} />
            ))}
            {old.length > 0 && (
              <PastSeasonGroup subs={old} depth={depth + 1} estimatedSet={estimatedSet} />
            )}
          </>
        );
      })()}
    </>
  );
}

// ─────────────────────────────────────────────
// 대리상 행 (접기/펴기 → 대분류/중분류)
// ─────────────────────────────────────────────
interface Props {
  acc: AccountRow;
  idx: number;
  estimatedMonths?: number[];
  seasonCutoffYear?: number;
}

export default function StockAccountDrillSection({ acc, idx, estimatedMonths = [], seasonCutoffYear }: Props) {
  const [open, setOpen] = useState(false);
  const hasCategories = acc.categories && acc.categories.length > 0;
  const estimatedSet = new Set(estimatedMonths);

  const rowBg = idx % 2 === 0 ? "bg-white" : "bg-stone-50/80";
  const hoverBg = "group-hover:bg-sky-50/60";

  return (
    <>
      <tr
        className={`group transition-colors ${rowBg} ${hasCategories ? "cursor-pointer" : ""}`}
        onClick={hasCategories ? () => setOpen((v) => !v) : undefined}
      >
        <td
          className={`sticky left-0 z-10 min-w-[240px] border-b border-stone-200 px-6 py-3.5 text-sm transition-colors ${rowBg} ${hoverBg}`}
        >
          <div className="inline-flex items-center gap-1.5 font-medium text-slate-800 leading-tight">
            {hasCategories && (
              open ? (
                <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
              ) : (
                <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
              )
            )}
            <span className="truncate">{acc.account_nm_en}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400 pl-5">{acc.account_id}</div>
        </td>

        {/* 기초재고 */}
        <td className={`whitespace-nowrap border-b border-stone-200 px-3 py-3.5 text-right text-sm text-slate-400 tabular-nums ${hoverBg}`}>
          {fmtAmt(acc.base_stock)}
        </td>

        {MONTHS.map((m) => (
          <td
            key={m}
            className={`whitespace-nowrap border-b border-stone-200 px-3 py-3.5 text-right text-sm tabular-nums ${hoverBg}${estimatedSet.has(m) ? " italic text-slate-400" : " text-slate-700"}`}
          >
            {fmtAmt(acc.months[m])}
          </td>
        ))}
      </tr>

      {open &&
        acc.categories?.map((cat) => (
          <CategorySection key={cat.대분류} cat={cat} depth={1} estimatedSet={estimatedSet} seasonCutoffYear={seasonCutoffYear} />
        ))}
    </>
  );
}
