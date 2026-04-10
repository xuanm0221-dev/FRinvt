/**
 * Claude 종합분석 JSON 응답 (K = 천위안 스케일 number)
 */
export type OverviewAnalysisData = {
  box1: Box1Json;
  box2: Box2Json;
  box3: Box3Json;
  box4: Box4Json;
  box5: Box5Json;
};

export type Box1Json = {
  stats: { bo_inventory: number; tgt_inventory: number; gap: number };
  summary: string;
  over_inventory: Array<{
    code: string;
    name: string;
    risk?: string;
    bo: number;
    tgt: number;
    gap: number;
    /** Sell-through·재고주수·매출 등 표에서 인용한 실판·소진 근거 */
    basis?: string;
    comment: string;
  }>;
  under_inventory: Array<{
    code: string;
    name: string;
    bo: number;
    tgt: number;
    gap: number;
    basis?: string;
    comment: string;
  }>;
  good: Array<{ code: string; name: string; comment: string }>;
  actions: string[];
};

export type Box2Json = {
  stats: { bo_sales: number; tgt_sales: number; gap: number };
  summary: string;
  growth_leaders: Array<{
    code: string;
    name: string;
    tgt_growth?: string;
    bo_growth?: string;
    comment: string;
  }>;
  underperformers: Array<{
    code: string;
    name: string;
    tgt_growth?: string;
    comment: string;
  }>;
  unrealistic: Array<{ code: string; name: string; comment: string }>;
  actions: string[];
};

export type Box3Json = {
  stats: { bo_profit: number; tgt_profit: number; gap: number };
  summary: string;
  improvers: Array<{
    code: string;
    name: string;
    tgt_yoy?: string;
    comment: string;
  }>;
  decliners: Array<{
    code: string;
    name: string;
    tgt_yoy?: string;
    bo_yoy?: string;
    comment: string;
  }>;
  most_dangerous: Array<{
    code: string;
    name: string;
    reason?: string;
    comment: string;
  }>;
  actions: string[];
};

export type Box4Json = {
  insights: string[];
  urgent: Array<{ code: string; name: string; action: string }>;
  reduce_inventory: Array<{ code: string; name: string; action: string }>;
  expand_sales: Array<{ code: string; name: string; action: string }>;
  maintain: Array<{ code: string; name: string; action: string }>;
  per_distributor: Array<{
    code: string;
    name: string;
    tag?: string;
    action: string;
  }>;
};

/** 매입(TGT 시뮬): 금액 K, YOY는 전년 대비 % */
export type Box5Json = {
  stats: {
    sum: number;
    /** 전년 대비 %, 없으면 null */
    sum_yoy_pct: number | null;
    apparel: number;
    apparel_yoy_pct: number | null;
    acc: number;
    acc_yoy_pct: number | null;
  };
  summary: string;
  high_yoy: Array<{ code: string; name: string; note: string; comment: string }>;
  low_yoy: Array<{ code: string; name: string; note: string; comment: string }>;
  actions: string[];
};

function isOverviewShape(x: unknown): x is OverviewAnalysisData {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.box1 === "object" &&
    o.box1 !== null &&
    typeof o.box2 === "object" &&
    o.box2 !== null &&
    typeof o.box3 === "object" &&
    o.box3 !== null &&
    typeof o.box4 === "object" &&
    o.box4 !== null &&
    typeof o.box5 === "object" &&
    o.box5 !== null
  );
}

function extractJsonObject(s: string): string {
  const t = s.trim();
  const i = t.indexOf("{");
  const j = t.lastIndexOf("}");
  if (i >= 0 && j > i) return t.slice(i, j + 1);
  return t;
}

/**
 * Anthropic 텍스트 응답 → JSON. 실패 시 ``` 제거 후 재시도, `{...}` 추출 후 재시도.
 */
export function parseOverviewAnalysisJson(text: string): OverviewAnalysisData {
  const tryParse = (raw: string): OverviewAnalysisData => {
    const parsed: unknown = JSON.parse(raw);
    if (!isOverviewShape(parsed)) {
      throw new Error("Invalid JSON shape");
    }
    return parsed;
  };

  const attempts = [text.trim(), text.replace(/```json|```/gi, "").trim(), extractJsonObject(text.replace(/```json|```/gi, "").trim())];

  for (const a of attempts) {
    try {
      return tryParse(a);
    } catch {
      try {
        return tryParse(extractJsonObject(a));
      } catch {
        /* next */
      }
    }
  }

  throw new Error("Failed to parse overview analysis JSON");
}

export function formatK(n: number): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return `${Math.round(n).toLocaleString("ko-KR")}K`;
}

export function formatPct1(v: number | null | undefined): string {
  if (v == null || typeof v !== "number" || Number.isNaN(v)) return "—";
  return `${Math.round(v * 10) / 10}%`;
}
