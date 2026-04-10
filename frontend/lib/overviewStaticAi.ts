import type { BrandKey } from "./types";
import type { OverviewAnalysisData } from "./overviewAnalysisJson";

/** public/data/overview-ai/{slug}.json */
export function brandToOverviewAiSlug(brand: BrandKey): string {
  const m: Record<BrandKey, string> = {
    MLB: "mlb",
    "MLB KIDS": "mlb-kids",
    DISCOVERY: "discovery",
  };
  return m[brand];
}

export type StaticOverviewAiPayload = {
  /** 생성 시점의 aiFingerprint — 현재 표와 다르면 UI에서 stale */
  fingerprint: string;
  analysis: OverviewAnalysisData;
};

/**
 * public 배포 스냅샷 JSON 파싱.
 * - 권장: { fingerprint, analysis }
 * - 호환: analysis 루트가 box1~box5인 순수 객체
 */
export function parseStaticOverviewAiJson(
  raw: unknown,
): StaticOverviewAiPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (
    o.analysis &&
    typeof o.analysis === "object" &&
    o.analysis !== null &&
    typeof (o.analysis as Record<string, unknown>).box1 === "object"
  ) {
    return {
      fingerprint: typeof o.fingerprint === "string" ? o.fingerprint : "",
      analysis: o.analysis as OverviewAnalysisData,
    };
  }
  if (typeof o.box1 === "object" && o.box1 !== null) {
    return {
      fingerprint: typeof o.fingerprint === "string" ? o.fingerprint : "",
      analysis: raw as OverviewAnalysisData,
    };
  }
  return null;
}
