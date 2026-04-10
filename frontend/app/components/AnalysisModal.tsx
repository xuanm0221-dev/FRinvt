"use client";

import { useCallback, useEffect, type ReactNode } from "react";
import type { OverviewAnalysisData } from "../../lib/overviewAnalysisJson";
import { formatK, formatPct1 } from "../../lib/overviewAnalysisJson";

const BOX_THEME: Record<
  1 | 2 | 3 | 4 | 5,
  { barBg: string; title: string; sub: string }
> = {
  1: {
    barBg: "bg-[#FCEBEB]",
    title: "기말재고",
    sub: "재고 리스크",
  },
  2: {
    barBg: "bg-[#FAEEDA]",
    title: "판매/매출",
    sub: "성장·갭",
  },
  3: {
    barBg: "bg-[#FCEBEB]",
    title: "영업이익",
    sub: "손익·위험",
  },
  4: {
    barBg: "bg-[#E1F5EE]",
    title: "핵심 요약",
    sub: "실행 과제",
  },
  5: {
    barBg: "bg-[#eef2ff]",
    title: "매입",
    sub: "합계·의류·ACC",
  },
};

function CodeBadge({ children }: { children: string }) {
  return (
    <span className="inline-block rounded bg-[#e5e7eb] px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-800">
      {children}
    </span>
  );
}

function RiskBadge({ risk }: { risk: string }) {
  const r = risk.trim();
  let cls = "bg-slate-200 text-slate-700";
  if (r === "최위험") cls = "bg-[#fee2e2] text-[#b91c1c]";
  else if (r === "위험") cls = "bg-red-100 text-red-700";
  else if (r === "주의") cls = "bg-amber-100 text-[#b45309]";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>
      {risk}
    </span>
  );
}

function TagBadge({ tag }: { tag: string }) {
  const t = tag.trim();
  let cls = "bg-slate-200 text-slate-700";
  if (t === "재고축소") cls = "bg-[#fee2e2] text-[#b91c1c]";
  else if (t === "판매확대") cls = "bg-green-100 text-green-800";
  else if (t === "이익점검") cls = "bg-amber-100 text-[#b45309]";
  else if (t === "유지") cls = "bg-sky-100 text-sky-800";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>
      {tag}
    </span>
  );
}

/** 소제목 — 통일 타이포 + 얇은 구분선, 위험 톤만 텍스트·선색으로 약하게 구분 */
type PillTone =
  | "neutral"
  | "insight"
  | "urgent"
  | "risk"
  | "caution"
  | "positive"
  | "negative"
  | "muted";

const PILL_TONE_CLASS: Record<PillTone, string> = {
  neutral: "text-slate-800 border-slate-200",
  insight: "text-slate-800 border-sky-200/90",
  urgent: "text-red-800 border-red-200/80",
  risk: "text-red-800 border-red-200/70",
  caution: "text-amber-900 border-amber-200/80",
  positive: "text-emerald-900 border-emerald-200/70",
  negative: "text-orange-900 border-orange-200/80",
  muted: "text-slate-600 border-slate-200/90",
};

function PillTitle({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: PillTone;
}) {
  return (
    <div
      className={`mb-2.5 border-b pb-1.5 text-xs font-semibold tracking-tight ${PILL_TONE_CLASS[tone]}`}
    >
      {children}
    </div>
  );
}

function StatCard({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-lg bg-[#f8fafc] p-3 text-center">
      <div className={`text-lg font-semibold tabular-nums ${valueClass}`}>
        {value}
      </div>
      <div className="mt-1 text-[11px] text-[#6b7280]">{label}</div>
    </div>
  );
}

function ActionList({ items }: { items: string[] }) {
  if (!items?.length) return null;
  return (
    <ul className="mt-3 space-y-0">
      {items.map((a, i) => (
        <li
          key={i}
          className="flex gap-2 border-b border-[#f1f5f9] py-1.5 text-xs text-slate-700 last:border-0"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-[11px] font-semibold text-sky-700">
            {i + 1}
          </span>
          <span className="min-w-0 flex-1 pt-0.5">{a}</span>
        </li>
      ))}
    </ul>
  );
}

function DistributorCard({
  code,
  name,
  children,
}: {
  code: string;
  name: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg bg-[#f8fafc] px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <CodeBadge>{code}</CodeBadge>
        <span className="text-sm font-medium text-slate-800">{name}</span>
        {children}
      </div>
    </div>
  );
}

export interface AnalysisModalProps {
  data: OverviewAnalysisData;
  onClose: () => void;
}

export default function AnalysisModal({ data, onClose }: AnalysisModalProps) {
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  const b1 = data.box1;
  const b2 = data.box2;
  const b3 = data.box3;
  const b4 = data.box4;
  const b5 = data.box5;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="analysis-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default border-0 bg-transparent p-0"
        aria-label="배경 클릭 시 닫기"
        onClick={onClose}
      />
      <div
        className="relative z-[1] flex h-[90vh] w-[90vw] flex-col overflow-hidden rounded-[12px] border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="relative shrink-0 border-b border-slate-200 px-5 py-4 pr-12">
          <h2
            id="analysis-modal-title"
            className="text-base font-semibold leading-snug text-slate-900"
          >
            MLB 중국법인 대리상 종합분석
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="닫기"
          >
            <span className="text-xl leading-none">✕</span>
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-3 sm:px-4 sm:py-4 md:px-5">
          <div className="flex min-h-0 min-w-0 flex-1 flex-row divide-x divide-slate-200 overflow-x-auto">
          {/* BOX 4 */}
          <section className="flex min-h-0 min-w-[200px] flex-1 basis-0 flex-col overflow-y-auto px-1.5 sm:px-2.5">
            <BoxHeader id={4} />
            <div className="mt-4 space-y-3">
              <PillTitle tone="insight">핵심 인사이트</PillTitle>
              <div className="space-y-2">
                {b4.insights?.map((line, i) => {
                  const border =
                    i === 0 || i === 1
                      ? "border-l-red-500"
                      : "border-l-green-600";
                  const mark = ["①", "②", "③"][i] ?? `${i + 1}`;
                  return (
                    <div
                      key={i}
                      className={`rounded-r-lg border-l-[3px] ${border} bg-[#f8fafc] py-2 pl-3 pr-3 text-[13px] leading-relaxed text-slate-800`}
                    >
                      <span className="mr-1 font-semibold text-slate-600">
                        {mark}
                      </span>
                      {line}
                    </div>
                  );
                })}
              </div>
              <div>
                <PillTitle tone="urgent">즉시 조정 필요</PillTitle>
                <div className="space-y-2">
                  {b4.urgent?.map((r, i) => (
                    <div key={`${r.code}-ug-${i}`} className="rounded-lg bg-[#f8fafc] px-3 py-2.5">
                      <DistributorCard code={r.code} name={r.name} />
                      <p className="mt-1 text-xs text-[#4b5563]">{r.action}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <PillTitle tone="risk">재고 축소</PillTitle>
                <div className="space-y-2">
                  {b4.reduce_inventory?.map((r, i) => (
                    <div key={`${r.code}-ri-${i}`} className="rounded-lg bg-[#f8fafc] px-3 py-2.5">
                      <DistributorCard code={r.code} name={r.name} />
                      <p className="mt-1 text-xs text-[#4b5563]">{r.action}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <PillTitle tone="positive">판매 확대</PillTitle>
                <div className="space-y-2">
                  {b4.expand_sales?.map((r, i) => (
                    <div key={`${r.code}-ex-${i}`} className="rounded-lg bg-[#f8fafc] px-3 py-2.5">
                      <DistributorCard code={r.code} name={r.name} />
                      <p className="mt-1 text-xs text-[#4b5563]">{r.action}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <PillTitle tone="muted">계획 유지</PillTitle>
                <div className="space-y-2">
                  {b4.maintain?.map((r, i) => (
                    <div key={`${r.code}-ma-${i}`} className="rounded-lg bg-[#f8fafc] px-3 py-2.5">
                      <DistributorCard code={r.code} name={r.name} />
                      <p className="mt-1 text-xs text-[#4b5563]">{r.action}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <PillTitle tone="neutral">대리상별 실행 제안</PillTitle>
                <div className="space-y-2">
                  {b4.per_distributor?.map((r, i) => (
                    <div key={`${r.code}-pd-${i}`} className="rounded-lg bg-[#f8fafc] px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <CodeBadge>{r.code}</CodeBadge>
                        <span className="text-sm font-medium">{r.name}</span>
                        {r.tag && <TagBadge tag={r.tag} />}
                      </div>
                      <p className="mt-1 text-xs text-[#4b5563]">{r.action}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* BOX 1 */}
          <section className="flex min-h-0 min-w-[200px] flex-1 basis-0 flex-col overflow-y-auto px-1.5 sm:px-2.5">
            <BoxHeader id={1} />
            <div className="mt-3 flex flex-row flex-wrap gap-2">
              <StatCard
                label="BO 기말재고"
                value={formatK(b1.stats.bo_inventory)}
                valueClass="text-red-600"
              />
              <StatCard
                label="TGT 기말재고"
                value={formatK(b1.stats.tgt_inventory)}
                valueClass="text-orange-500"
              />
              <StatCard
                label="Gap (TGT−BO)"
                value={formatK(b1.stats.gap)}
                valueClass="text-red-600"
              />
            </div>
            <SummaryBox text={b1.summary} />
            <div className="mt-4 space-y-3">
              <div>
                <PillTitle tone="risk">실판·소진 기준 재고 과다</PillTitle>
                <div className="space-y-2">
                  {b1.over_inventory?.map((r, i) => (
                    <div key={`${r.code}-${i}`} className="rounded-lg bg-[#f8fafc] px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <CodeBadge>{r.code}</CodeBadge>
                        <span className="text-sm font-medium">{r.name}</span>
                        {r.risk && <RiskBadge risk={r.risk} />}
                      </div>
                      {r.basis ? (
                        <p className="mt-1 text-xs font-medium text-slate-700">
                          {r.basis}
                        </p>
                      ) : null}
                      <div className="mt-1 text-[11px] text-slate-500">
                        기말재고(참고) BO {formatK(r.bo)} · TGT {formatK(r.tgt)} ·
                        Gap {formatK(r.gap)}
                      </div>
                      <p className="mt-1 text-xs text-[#4b5563]">{r.comment}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <PillTitle tone="caution">실판·소진 기준 재고 과소</PillTitle>
                <div className="space-y-2">
                  {b1.under_inventory?.map((r, i) => (
                    <div key={`${r.code}-u-${i}`} className="rounded-lg bg-[#f8fafc] px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <CodeBadge>{r.code}</CodeBadge>
                        <span className="text-sm font-medium">{r.name}</span>
                      </div>
                      {r.basis ? (
                        <p className="mt-1 text-xs font-medium text-slate-700">
                          {r.basis}
                        </p>
                      ) : null}
                      <div className="mt-1 text-[11px] text-slate-500">
                        기말재고(참고) BO {formatK(r.bo)} · TGT {formatK(r.tgt)} ·
                        Gap {formatK(r.gap)}
                      </div>
                      <p className="mt-1 text-xs text-[#4b5563]">{r.comment}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <PillTitle tone="positive">우수 대리상</PillTitle>
                <div className="space-y-2">
                  {b1.good?.map((r, i) => (
                    <div key={`${r.code}-g-${i}`}>
                      <DistributorCard code={r.code} name={r.name} />
                      <p className="mt-1 text-xs text-[#4b5563]">{r.comment}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <ActionList items={b1.actions ?? []} />
          </section>

          <section className="flex min-h-0 min-w-[200px] flex-1 basis-0 flex-col overflow-y-auto px-1.5 sm:px-2.5">
            <BoxHeader id={2} />
            <div className="mt-3 flex flex-row flex-wrap gap-2">
              <StatCard
                label="BO 매출"
                value={formatK(b2.stats.bo_sales)}
                valueClass="text-orange-500"
              />
              <StatCard
                label="TGT 매출"
                value={formatK(b2.stats.tgt_sales)}
                valueClass="text-green-600"
              />
              <StatCard
                label="Gap"
                value={formatK(b2.stats.gap)}
                valueClass="text-red-600"
              />
            </div>
            <SummaryBox text={b2.summary} />
            <div className="mt-4 space-y-3">
              <div>
                <PillTitle tone="positive">매출 성장 기여</PillTitle>
                <div className="space-y-2">
                  {b2.growth_leaders?.map((r, i) => (
                    <div key={`${r.code}-gl-${i}`} className="rounded-lg bg-[#f8fafc] px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <CodeBadge>{r.code}</CodeBadge>
                        <span className="text-sm font-medium">{r.name}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        TGT {r.tgt_growth ?? "—"} · BO {r.bo_growth ?? "—"}
                      </div>
                      <p className="mt-1 text-xs text-[#4b5563]">{r.comment}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <PillTitle tone="negative">매출 부진</PillTitle>
                <div className="space-y-2">
                  {b2.underperformers?.map((r, i) => (
                    <div key={`${r.code}-up-${i}`} className="rounded-lg bg-[#f8fafc] px-3 py-2.5">
                      <CodeBadge>{r.code}</CodeBadge>
                      <span className="ml-2 text-sm font-medium">{r.name}</span>
                      <p className="mt-1 text-[11px] text-slate-500">
                        TGT {r.tgt_growth ?? "—"}
                      </p>
                      <p className="mt-1 text-xs text-[#4b5563]">{r.comment}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <PillTitle tone="caution">계획 과다/비현실 가능</PillTitle>
                <div className="space-y-2">
                  {b2.unrealistic?.map((r, i) => (
                    <div key={`${r.code}-ur-${i}`}>
                      <DistributorCard code={r.code} name={r.name} />
                      <p className="mt-1 text-xs text-[#4b5563]">{r.comment}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <ActionList items={b2.actions ?? []} />
          </section>

          <section className="flex min-h-0 min-w-[200px] flex-1 basis-0 flex-col overflow-y-auto px-1.5 sm:px-2.5">
            <BoxHeader id={3} />
            <div className="mt-3 flex flex-row flex-wrap gap-2">
              <StatCard
                label="BO 영업이익"
                value={formatK(b3.stats.bo_profit)}
                valueClass="text-orange-500"
              />
              <StatCard
                label="TGT 영업이익"
                value={formatK(b3.stats.tgt_profit)}
                valueClass="text-green-600"
              />
              <StatCard
                label="Gap"
                value={formatK(b3.stats.gap)}
                valueClass="text-red-600"
              />
            </div>
            <SummaryBox text={b3.summary} />
            <div className="mt-4 space-y-3">
              <div>
                <PillTitle tone="positive">이익 개선</PillTitle>
                <div className="space-y-2">
                  {b3.improvers?.map((r, i) => (
                    <div key={`${r.code}-im-${i}`} className="rounded-lg bg-[#f8fafc] px-3 py-2.5">
                      <CodeBadge>{r.code}</CodeBadge>
                      <span className="ml-2 text-sm font-medium">{r.name}</span>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {r.tgt_yoy ?? "—"}
                      </p>
                      <p className="mt-1 text-xs text-[#4b5563]">{r.comment}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <PillTitle tone="negative">이익 악화</PillTitle>
                <div className="space-y-2">
                  {b3.decliners?.map((r, i) => (
                    <div key={`${r.code}-de-${i}`} className="rounded-lg bg-[#f8fafc] px-3 py-2.5">
                      <CodeBadge>{r.code}</CodeBadge>
                      <span className="ml-2 text-sm font-medium">{r.name}</span>
                      <p className="mt-1 text-[11px] text-slate-500">
                        TGT {r.tgt_yoy ?? "—"} · BO {r.bo_yoy ?? "—"}
                      </p>
                      <p className="mt-1 text-xs text-[#4b5563]">{r.comment}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <PillTitle tone="urgent">가장 위험</PillTitle>
                <div className="space-y-2">
                  {b3.most_dangerous?.map((r, i) => (
                    <div key={`${r.code}-md-${i}`} className="rounded-lg bg-[#f8fafc] px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <CodeBadge>{r.code}</CodeBadge>
                        <span className="text-sm font-medium">{r.name}</span>
                        {r.reason && (
                          <span className="text-[11px] text-slate-600">
                            ({r.reason})
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-[#4b5563]">{r.comment}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <ActionList items={b3.actions ?? []} />
          </section>

          {/* BOX 5 매입 — 영업이익 우측 */}
          <section className="flex min-h-0 min-w-[200px] flex-1 basis-0 flex-col overflow-y-auto px-1.5 sm:px-2.5">
            <BoxHeader id={5} />
            <div className="mt-3 flex flex-row flex-wrap gap-2">
              <StatCard
                label="매입 합계"
                value={formatK(b5.stats.sum)}
                valueClass="text-slate-800"
              />
              <StatCard
                label="합계 YOY"
                value={formatPct1(b5.stats.sum_yoy_pct)}
                valueClass="text-slate-700"
              />
              <StatCard
                label="의류 매입"
                value={formatK(b5.stats.apparel)}
                valueClass="text-slate-800"
              />
              <StatCard
                label="의류 YOY"
                value={formatPct1(b5.stats.apparel_yoy_pct)}
                valueClass="text-slate-700"
              />
              <StatCard
                label="ACC 매입"
                value={formatK(b5.stats.acc)}
                valueClass="text-slate-800"
              />
              <StatCard
                label="ACC YOY"
                value={formatPct1(b5.stats.acc_yoy_pct)}
                valueClass="text-slate-700"
              />
            </div>
            <SummaryBox text={b5.summary} />
            <div className="mt-4 space-y-3">
              <div>
                <PillTitle>매입 YOY 상대 양호</PillTitle>
                <div className="space-y-2">
                  {b5.high_yoy?.map((r, i) => (
                    <div key={`${r.code}-h5-${i}`} className="rounded-lg bg-[#f8fafc] px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <CodeBadge>{r.code}</CodeBadge>
                        <span className="text-sm font-medium">{r.name}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">{r.note}</p>
                      <p className="mt-1 text-xs text-[#4b5563]">{r.comment}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <PillTitle tone="caution">매입 YOY 점검</PillTitle>
                <div className="space-y-2">
                  {b5.low_yoy?.map((r, i) => (
                    <div key={`${r.code}-l5-${i}`} className="rounded-lg bg-[#f8fafc] px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <CodeBadge>{r.code}</CodeBadge>
                        <span className="text-sm font-medium">{r.name}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">{r.note}</p>
                      <p className="mt-1 text-xs text-[#4b5563]">{r.comment}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <ActionList items={b5.actions ?? []} />
          </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function BoxHeader({ id }: { id: 1 | 2 | 3 | 4 | 5 }) {
  const th = BOX_THEME[id];
  return (
    <div className={`rounded-lg px-4 py-3 ${th.barBg}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-base font-semibold text-slate-900">{th.title}</span>
        <span className="rounded-full bg-white/60 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
          {th.sub}
        </span>
      </div>
    </div>
  );
}

function SummaryBox({ text }: { text: string }) {
  if (!text?.trim()) return null;
  return (
    <div className="mt-4 border-l-4 border-sky-500 bg-slate-50 px-3 py-2.5 text-[13px] leading-relaxed text-slate-800">
      {text}
    </div>
  );
}
