"use client";

import { useState } from "react";
import { InboundRow, CategoryGroup, SubCategoryRow, MONTHS } from "../../lib/types";
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
function SubCategoryTr({ sub, depth }: { sub: SubCategoryRow; depth: number }) {
  const indent = depth * 20;
  const rowTotal = MONTHS.reduce((s, m) => s + (sub.months[m] ?? 0), 0);
  const subLabels: Record<number, string> = {};

  return (
    <tr className="bg-slate-50/40">
      <td className="sticky left-0 z-10 min-w-[240px] border-b border-stone-100 bg-slate-50/40 px-6 py-2 text-sm">
        <div className="flex items-center gap-1 text-slate-500" style={{ paddingLeft: `${indent}px` }}>
          <span className="mr-1 text-slate-300 select-none">└</span>
          <span className="text-[12px]">{sub.중분류}</span>
        </div>
      </td>
      {MONTHS.map((m) => (
        <td key={m} className={`whitespace-nowrap border-b border-stone-100 bg-slate-50/40 px-3 py-2 text-right text-[12px] tabular-nums ${subLabels[m] ? "italic text-slate-400" : "text-slate-500"}`}>
          {fmtAmt(sub.months[m])}
        </td>
      ))}
      <td className="whitespace-nowrap border-b border-stone-100 bg-slate-100/40 px-3 py-2 text-right text-[12px] text-slate-500 tabular-nums">
        {fmtAmt(rowTotal)}
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────
// 과시즌 그룹 행 (접기/펴기)
// ─────────────────────────────────────────────
function PastSeasonGroup({
  subs,
  depth,
}: {
  subs: SubCategoryRow[];
  depth: number;
}) {
  const [pastOpen, setPastOpen] = useState(false);
  const indent = depth * 20;
  const sumMonths: Record<number, number> = {};
  MONTHS.forEach((m) => {
    sumMonths[m] = subs.reduce((s, sub) => s + (sub.months[m] ?? 0), 0);
  });
  const sumTotal = MONTHS.reduce((s, m) => s + (sumMonths[m] ?? 0), 0);

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
        {MONTHS.map((m) => (
          <td key={m} className="whitespace-nowrap border-b border-stone-100 bg-slate-50/40 px-3 py-2 text-right text-[12px] text-slate-500 tabular-nums">
            {fmtAmt(sumMonths[m])}
          </td>
        ))}
        <td className="whitespace-nowrap border-b border-stone-100 bg-slate-100/40 px-3 py-2 text-right text-[12px] text-slate-500 tabular-nums">
          {fmtAmt(sumTotal)}
        </td>
      </tr>
      {pastOpen &&
        subs.map((sub) => (
          <SubCategoryTr key={sub.중분류} sub={sub} depth={depth + 1} />
        ))}
    </>
  );
}

// ─────────────────────────────────────────────
// 대분류 행 (접기/펴기)
// ─────────────────────────────────────────────
function CategorySection({ cat, depth, seasonCutoffYear }: { cat: CategoryGroup; depth: number; seasonCutoffYear?: number }) {
  const [open, setOpen] = useState(false);
  const indent = depth * 20;
  const catTotal = MONTHS.reduce((s, m) => s + (cat.months[m] ?? 0), 0);
  const catLabeledMonths = new Set<number>(
    [] as number[]
  );

  return (
    <>
      <tr className="cursor-pointer bg-slate-100/60 hover:brightness-[0.97]" onClick={() => setOpen((v) => !v)}>
        <td className="sticky left-0 z-10 min-w-[240px] border-b border-stone-200 bg-slate-100/60 px-6 py-2.5 text-sm font-medium text-slate-600">
          <div className="inline-flex items-center gap-1" style={{ paddingLeft: `${indent}px` }}>
            {open ? <ChevronDownIcon className="h-3.5 w-3.5 text-slate-500" /> : <ChevronRightIcon className="h-3.5 w-3.5 text-slate-500" />}
            <span>{cat.대분류}</span>
            <span className="ml-1 text-[11px] font-normal text-slate-400">({cat.subcategories.length})</span>
          </div>
        </td>
        {MONTHS.map((m) => (
          <td key={m} className={`whitespace-nowrap border-b border-stone-200 bg-slate-100/60 px-3 py-2.5 text-right text-[12px] tabular-nums ${catLabeledMonths.has(m) ? "italic font-medium text-slate-400" : "font-medium text-slate-600"}`}>
            {fmtAmt(cat.months[m])}
          </td>
        ))}
        <td className="whitespace-nowrap border-b border-stone-200 bg-slate-200/40 px-3 py-2.5 text-right text-[12px] font-semibold text-slate-700 tabular-nums">
          {fmtAmt(catTotal)}
        </td>
      </tr>

      {open && (() => {
        if (cat.대분류 !== "의류" || !seasonCutoffYear) {
          return cat.subcategories.map((sub) => (
            <SubCategoryTr key={sub.중분류} sub={sub} depth={depth + 1} />
          ));
        }
        const recent = cat.subcategories.filter((s) => !isOldSeason(s.중분류, seasonCutoffYear));
        const old = cat.subcategories.filter((s) => isOldSeason(s.중분류, seasonCutoffYear));
        return (
          <>
            {recent.map((sub) => (
              <SubCategoryTr key={sub.중분류} sub={sub} depth={depth + 1} />
            ))}
            {old.length > 0 && (
              <PastSeasonGroup subs={old} depth={depth + 1} />
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
  acc: InboundRow;
  idx: number;
  monthLabels?: Record<number, string>;
  seasonCutoffYear?: number;
}

export default function InboundAccountDrillSection({ acc, idx, monthLabels = {}, seasonCutoffYear }: Props) {
  const [open, setOpen] = useState(false);
  const hasCategories = acc.categories && acc.categories.length > 0;
  const rowTotal = MONTHS.reduce((s, m) => s + (acc.months[m] ?? 0), 0);
  const estimatedSet = new Set(Object.keys(monthLabels).map(Number));

  const rowBg = idx % 2 === 0 ? "bg-white" : "bg-stone-50/80";
  const hoverBg = "group-hover:bg-sky-50/60";

  return (
    <>
      <tr
        className={`group transition-colors ${rowBg} ${hasCategories ? "cursor-pointer" : ""}`}
        onClick={hasCategories ? () => setOpen((v) => !v) : undefined}
      >
        <td className={`sticky left-0 z-10 min-w-[240px] border-b border-stone-200 px-6 py-3 text-sm transition-colors ${rowBg} ${hoverBg}`}>
          <div className="inline-flex items-center gap-1.5 font-medium text-slate-800 leading-tight">
            {hasCategories && (open ? <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-slate-500" /> : <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-slate-500" />)}
            <span className="truncate">{acc.account_nm_en}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400 pl-5">
            {acc.sap_shop_cd && <span className="mr-1">{acc.sap_shop_cd}</span>}
            {acc.sap_shop_cd && acc.account_id && <span className="mr-1">·</span>}
            <span>{acc.account_id}</span>
          </div>
        </td>

        {MONTHS.map((m) => (
          <td key={m} className={`whitespace-nowrap border-b border-stone-200 px-3 py-3 text-right text-sm tabular-nums ${hoverBg}${estimatedSet.has(m) ? " italic text-slate-400" : " text-slate-700"}`}>
            {fmtAmt(acc.months[m])}
          </td>
        ))}

        <td className={`whitespace-nowrap border-b border-stone-200 bg-slate-50/60 px-3 py-3 text-right text-sm font-semibold text-slate-700 tabular-nums ${hoverBg}`}>
          {fmtAmt(rowTotal)}
        </td>
      </tr>

      {open &&
        acc.categories?.map((cat) => (
          <CategorySection key={cat.대분류} cat={cat} depth={1} seasonCutoffYear={seasonCutoffYear} />
        ))}
    </>
  );
}
