import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { parseOverviewAnalysisJson } from "../../../lib/overviewAnalysisJson";
import { OVERVIEW_ANALYSIS_SYSTEM_PROMPT } from "./system-prompt";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function isOverviewAiApiEnabled(): boolean {
  const v = process.env.OVERVIEW_AI_API_ENABLED?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  return true;
}

export async function POST(req: NextRequest) {
  if (!isOverviewAiApiEnabled()) {
    return NextResponse.json(
      { error: "Overview AI API is disabled (OVERVIEW_AI_API_ENABLED)." },
      { status: 403 },
    );
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }

  let body: {
    brand: string;
    /** 종합분석 표 DOM 스냅샷(HTML 조각). 대리상별 근거 */
    tableHtml?: string;
    tgtParams: {
      growthRate: number;
      targetWeeks?: Record<string, number>;
      sellThroughRates?: {
        currentDefault?: number;
        bySeason?: Record<string, number>;
        yearGroup?: Record<string, number>;
        oldSeason?: number;
      };
    };
    summary: {
      tgtSales: number;
      boSales: number;
      salesYoyTgt: number | null;
      salesYoyBo: number | null;
      tgtEnding: number;
      boEnding: number;
      tgtOpProfit: number;
      boOpProfit: number;
      sellThrough: number | null;
      weeks: number | null;
      /** TGT 시뮬 매입 합계·세그먼트 (금액 동일 스케일), YOY는 % */
      purchase?: {
        sum: number;
        sumYoy: number | null;
        apparel: number;
        apparelYoy: number | null;
        acc: number;
        accYoy: number | null;
      };
      /** 2025 전체기준 대비 (종합분석 표 전체기준 행과 동일) */
      yoy?: {
        prevEnding: number;
        tgtEndingYoyPct: number | null;
        endingVsPrevAmt: number;
        tgtOpProfitYoyVs2025Pct: number | null;
        boOpProfitYoyVs2025Pct: number | null;
        apparelSellThroughPrev: number | null;
        sellThroughDiffPp: number | null;
        accWeeksPrev: number | null;
        weeksDiff: number | null;
      } | null;
    };
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { brand, tgtParams, summary, tableHtml } = body;
  const pur = summary.purchase ?? {
    sum: 0,
    sumYoy: null as number | null,
    apparel: 0,
    apparelYoy: null as number | null,
    acc: 0,
    accYoy: null as number | null,
  };
  const yoy = summary.yoy;
  const tableHtmlTrimmed = typeof tableHtml === "string" ? tableHtml.trim() : "";
  /** 대시보드 fmtAmt와 동일: 저장값을 1000으로 나눈 천(K) 스케일 */
  const fmtK = (v: number) =>
    `${Math.round(v / 1000).toLocaleString("ko-KR")}K`;
  const toP = (v: number | null) => v != null ? `${v.toFixed(1)}%` : "N/A";
  const fmtSignedK = (v: number) =>
    `${v >= 0 ? "+" : ""}${fmtK(v)}`;

  const salesYOY = summary.boSales > 0
    ? ((summary.tgtSales / summary.boSales) * 100).toFixed(1)
    : "N/A";
  const endingDiff = summary.tgtEnding - summary.boEnding;
  const opDiff = summary.tgtOpProfit - summary.boOpProfit;

  const weeksList = tgtParams.targetWeeks
    ? Object.entries(tgtParams.targetWeeks).map(([k, v]) => `${k} ${v}주`).join(", ")
    : "N/A";
  const bySeason = tgtParams.sellThroughRates?.bySeason
    ? Object.entries(tgtParams.sellThroughRates.bySeason)
        .filter(([, v]) => v > 0)
        .map(([s, v]) => `${s} ${v}%`)
        .join(", ")
    : "";

  const userMessage = `
브랜드: ${brand}

아래 금액·재고·손익 수치는 모두 천(K) 단위이며 대시보드 종합분석 표와 동일한 스케일입니다.

[TGT 시뮬레이션 파라미터]
- 매출성장률: ${tgtParams.growthRate}%
- 목표 재고주수: ${weeksList}
- Sell-through 기본: ${tgtParams.sellThroughRates?.currentDefault ?? "N/A"}%${bySeason ? `, 시즌별: ${bySeason}` : ""}

[전체 합계 지표]
- TGT 매출: ${fmtK(summary.tgtSales)} (전년 대비 ${toP(summary.salesYoyTgt)})
- BO목표 매출: ${fmtK(summary.boSales)} (전년 대비 ${toP(summary.salesYoyBo)})
- TGT/BO 매출 비율: ${salesYOY}%

- TGT 기말재고: ${fmtK(summary.tgtEnding)}
- BO목표 기말재고: ${fmtK(summary.boEnding)}
- 재고 Gap (TGT-BO): ${endingDiff >= 0 ? "+" : ""}${fmtK(endingDiff)}

- TGT 영업이익: ${fmtK(summary.tgtOpProfit)}
- BO목표 영업이익: ${fmtK(summary.boOpProfit)}
- 영업이익 Gap (TGT-BO): ${opDiff >= 0 ? "+" : ""}${fmtK(opDiff)}

- 의류 Sell-through: ${toP(summary.sellThrough)}
- ACC 재고주수: ${summary.weeks != null ? `${summary.weeks.toFixed(1)}주` : "N/A"}

[매입 전체 합계 — TGT 시뮬]
- 매입 합계: ${fmtK(pur.sum)} (전년 대비 YOY ${pur.sumYoy != null ? `${pur.sumYoy.toFixed(1)}%` : "N/A"})
- 의류 매입: ${fmtK(pur.apparel)} (YOY ${pur.apparelYoy != null ? `${pur.apparelYoy.toFixed(1)}%` : "N/A"})
- ACC 매입: ${fmtK(pur.acc)} (YOY ${pur.accYoy != null ? `${pur.accYoy.toFixed(1)}%` : "N/A"})

${yoy
    ? `[전년(2025) 대비 — 전체기준 합계]
- TGT 기말재고(의류+ACC): 전년 ${fmtK(yoy.prevEnding)} → 당년 ${fmtK(summary.tgtEnding)}, 증감 ${fmtSignedK(yoy.endingVsPrevAmt)}, YOY ${toP(yoy.tgtEndingYoyPct)}
- TGT 영업이익: 전년 대비 ${toP(yoy.tgtOpProfitYoyVs2025Pct)} (2025 대비 당년 TGT 영업이익 비율)
- BO목표 영업이익: 전년 대비 ${toP(yoy.boOpProfitYoyVs2025Pct)} (2025 대비 당년 BO 영업이익 비율)
- 의류 Sell-through: 전년 ${yoy.apparelSellThroughPrev != null ? `${yoy.apparelSellThroughPrev.toFixed(1)}%` : "N/A"}, 전년비(차이) ${yoy.sellThroughDiffPp != null ? `${yoy.sellThroughDiffPp >= 0 ? "+" : ""}${yoy.sellThroughDiffPp.toFixed(1)}%p` : "N/A"}
- ACC 재고주수: 전년 ${yoy.accWeeksPrev != null ? `${yoy.accWeeksPrev.toFixed(1)}주` : "N/A"}, 전년비(차이) ${yoy.weeksDiff != null ? `${yoy.weeksDiff >= 0 ? "+" : ""}${yoy.weeksDiff.toFixed(1)}주` : "N/A"}`
    : `[전년(2025) 대비]
(2025 전체기준 합계가 전달되지 않았습니다. 전년비는 표 HTML·매출 YOY 등으로만 참고하세요.)`}

${tableHtmlTrimmed
    ? `[종합분석 표 HTML]
아래는 화면과 동일한 종합분석 표입니다. 금액 열은 모두 천(K) 단위입니다. 대리상·수치 인용은 이 표와 위 합계에 나타난 것만 사용하세요.

${tableHtmlTrimmed}`
    : `[종합분석 표 HTML]
(표 HTML이 전달되지 않았습니다. 위 합계 지표만으로 분석하되, 대리상 단위 서술은 하지 말고 「표 데이터 없음」으로 표시하세요.)`}

[box1 재고 과다·과소]
- over_inventory·under_inventory 대리상 선정은 종합분석 표의 대리상별 Sell-through, ACC 재고주수, 매출 및 YOY, 기말재고 등 실적·소진 지표를 근거로 하세요. TGT−BO 기말재고 갭만으로 과다·과소를 판단하지 마세요. 각 항목 basis에는 인용 수치를 포함하세요.

위 합계·표(있는 경우)를 바탕으로 시스템 프롬프트의 JSON 스키마에 맞춰 순수 JSON만 출력하세요.`.trim();

  const model =
    process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-20250514";
  const maxTokensRaw = parseInt(process.env.ANTHROPIC_MAX_TOKENS ?? "8192", 10);
  const max_tokens = Number.isFinite(maxTokensRaw)
    ? Math.min(8192, Math.max(256, maxTokensRaw))
    : 8192;

  try {
    const message = await client.messages.create({
      model,
      max_tokens,
      system: OVERVIEW_ANALYSIS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";
    if (!text) {
      return NextResponse.json({ error: "Empty AI response" }, { status: 500 });
    }
    try {
      const analysis = parseOverviewAnalysisJson(text);
      return NextResponse.json({ analysis });
    } catch (e) {
      console.error("Overview analysis JSON parse error:", e);
      return NextResponse.json(
        { error: "Invalid AI response format" },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error("Anthropic API error:", err);
    return NextResponse.json({ error: "AI analysis failed" }, { status: 500 });
  }
}
