import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { parseStaticOverviewAiJson } from "../../../../lib/overviewStaticAi";

const ALLOWED_SLUGS = new Set(["mlb", "mlb-kids", "discovery"]);

/**
 * 로컬 `npm run dev` 전용: 종합분석 배포용 JSON을 public/data/overview-ai/{slug}.json 에 덮어씀.
 * 프로덕션(Vercel)에서는 파일 시스템이 읽기 전용이므로 비활성화.
 */
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { error: "개발 서버에서만 사용할 수 있습니다." },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { slug, data } = body as { slug?: unknown; data?: unknown };
  if (typeof slug !== "string" || !ALLOWED_SLUGS.has(slug)) {
    return NextResponse.json(
      { error: "slug은 mlb | mlb-kids | discovery 중 하나여야 합니다." },
      { status: 400 },
    );
  }

  const parsed = parseStaticOverviewAiJson(data);
  if (!parsed) {
    return NextResponse.json(
      { error: "분석 JSON 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const outDir = path.join(process.cwd(), "public", "data", "overview-ai");
  const outPath = path.join(outDir, `${slug}.json`);
  const text = JSON.stringify(
    { fingerprint: parsed.fingerprint, analysis: parsed.analysis },
    null,
    2,
  );

  try {
    await mkdir(outDir, { recursive: true });
    await writeFile(outPath, text, "utf-8");
  } catch (e) {
    console.error("save-overview-ai write error:", e);
    return NextResponse.json(
      { error: "파일 저장에 실패했습니다." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    path: `public/data/overview-ai/${slug}.json`,
  });
}
