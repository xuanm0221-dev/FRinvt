"""
2026 대리상 리테일 Plan CSV → JSON

실행:
  python scripts/preprocess_retail_plan_2026.py

입력: 리포 루트 2026_monthlyretail.csv (brand, fr_or_cls, account_id, account_nm_cn, 1월~12월 …)
  - fr_or_cls == FR 만 집계 (매장 행을 brand + account_id 기준 월별 합산)

결과: frontend/public/data/retail_plan_2026.json (RetailData 형식, categories 없음)
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

BRAND_ORDER = ["MLB", "MLB KIDS", "DISCOVERY"]
MONTH_COLS = [f"{i}월" for i in range(1, 13)]


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    csv_path = root / "2026_monthlyretail.csv"
    out_path = root / "frontend" / "public" / "data" / "retail_plan_2026.json"

    df = pd.read_csv(csv_path)
    missing = [c for c in ["brand", "fr_or_cls", "account_id"] + MONTH_COLS if c not in df.columns]
    if missing:
        raise SystemExit(f"CSV에 필요한 컬럼이 없습니다: {missing}")

    df = df[df["fr_or_cls"].astype(str).str.upper().str.strip() == "FR"].copy()
    df = df[df["brand"].isin(BRAND_ORDER)].copy()

    agg_map = {c: "sum" for c in MONTH_COLS}
    agg_map["account_nm_cn"] = "first"
    g = df.groupby(["brand", "account_id"], as_index=False).agg(agg_map)

    brands_data: dict[str, list[dict]] = {b: [] for b in BRAND_ORDER}

    for _, row in g.iterrows():
        brand = row["brand"]
        if brand not in BRAND_ORDER:
            continue
        aid = str(row["account_id"]).strip()
        nm = row.get("account_nm_cn")
        nm_str = "" if pd.isna(nm) else str(nm).strip()
        months = {str(m): int(round(float(row[f"{m}월"]))) for m in range(1, 13)}
        brands_data[brand].append(
            {
                "account_id": aid,
                "account_nm_en": nm_str,
                "sap_shop_cd": "",
                "months": months,
            }
        )

    for b in BRAND_ORDER:
        brands_data[b].sort(key=lambda x: x["account_id"])

    payload = {"year": "2026", "brands": brands_data}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {out_path} ({sum(len(brands_data[b]) for b in BRAND_ORDER)} accounts)")


if __name__ == "__main__":
    main()
