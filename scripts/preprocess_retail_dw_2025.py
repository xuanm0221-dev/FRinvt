"""
2025년 리테일매출(POS) — preprocess_retail.py와 동일 dw_sale·tag·카테고리 로직, 전기간 1~12월.

실행 (저장소 루트):
  python scripts/preprocess_retail_dw_2025.py

결과: frontend/public/data/retail_dw_2025.json

주의: retail_pos_2025.json / preprocess_retail_pos_2025.py 는 별도(실판·할인용)이며 이 스크립트와 무관.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# 동일 디렉터리 모듈 (python scripts/preprocess_retail_dw_2025.py)
_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

import preprocess_retail as pr  # noqa: E402


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    out_path = root / "frontend" / "public" / "data" / "retail_dw_2025.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    conn = pr.get_connection()
    try:
        df = pr.fetch(conn, "202501", "202512")
        if df.empty:
            data = {"year": "2025", "brands": {b: [] for b in pr.BRAND_ORDER}}
            print("조회 결과 없음 → 빈 brands 저장")
        else:
            print(f"조회: {len(df)}건")
            data = pr.build_json(df, "2025")
    finally:
        conn.close()

    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    n = sum(len(data.get("brands", {}).get(b, [])) for b in pr.BRAND_ORDER)
    print(f"Wrote {out_path} ({n} accounts)")


if __name__ == "__main__":
    main()
