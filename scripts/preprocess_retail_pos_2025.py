"""
2025년 실제 POS 리테일 (Snowflake dw_sale) 전처리

실행:
  python scripts/preprocess_retail_pos_2025.py

입력: Snowflake FNF.CHN.dw_sale (2025-01-01 ~ 2025-12-31)
결과: frontend/public/data/retail_pos_2025.json (RetailData 형식, categories 없음)
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pandas as pd
import snowflake.connector
from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(dotenv_path=env_path)

BRAND_MAP = {"M": "MLB", "I": "MLB KIDS", "X": "DISCOVERY"}
BRAND_ORDER = ["MLB", "MLB KIDS", "DISCOVERY"]

QUERY = """
SELECT
    TO_CHAR(a.sale_dt, 'YYYYMM')              AS yymm,
    a.brd_cd,
    sm.account_id,
    am.account_nm_en,
    SUM(COALESCE(a.tag_amt, 0))               AS retail_tag_amt,
    SUM(COALESCE(a.sale_amt, 0))              AS retail_sale_amt
FROM FNF.CHN.dw_sale a
JOIN FNF.CHN.MST_SHOP_ALL sm
  ON a.shop_id = sm.shop_id
 AND sm.fr_or_cls = 'FR'
LEFT JOIN FNF.CHN.mst_account am
  ON sm.account_id = am.account_id
WHERE a.brd_cd IN ('M', 'I', 'X')
  AND a.sale_dt >= DATE '2025-01-01'
  AND a.sale_dt <= DATE '2025-12-31'
GROUP BY 1, 2, 3, 4
ORDER BY 1, 3
"""


def get_connection():
    return snowflake.connector.connect(
        account=os.environ["SNOWFLAKE_ACCOUNT"],
        user=os.environ["SNOWFLAKE_USER"],
        password=os.environ["SNOWFLAKE_PASSWORD"],
        warehouse=os.environ["SNOWFLAKE_WAREHOUSE"],
        database=os.environ["SNOWFLAKE_DATABASE"],
        schema=os.environ["SNOWFLAKE_SCHEMA"],
        role=os.environ["SNOWFLAKE_ROLE"],
    )


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    out_path = root / "frontend" / "public" / "data" / "retail_pos_2025.json"

    conn = get_connection()
    try:
        df = pd.read_sql(QUERY, conn)
    finally:
        conn.close()

    df.columns = [c.lower() for c in df.columns]
    df["brand_nm"] = df["brd_cd"].map(BRAND_MAP)
    df["month"] = df["yymm"].astype(str).str[-2:].astype(int)

    result: dict = {"year": "2025", "brands": {b: [] for b in BRAND_ORDER}}

    for brand_nm in BRAND_ORDER:
        brand_df = df[df["brand_nm"] == brand_nm]
        accounts = []
        for (account_id, account_nm_en), grp in brand_df.groupby(
            ["account_id", "account_nm_en"], sort=False
        ):
            tag_by_m = grp.groupby("month")["retail_tag_amt"].sum()
            sale_by_m = grp.groupby("month")["retail_sale_amt"].sum()
            months = {str(int(m)): int(round(v)) for m, v in tag_by_m.items()}
            months_sale = {str(int(m)): int(round(v)) for m, v in sale_by_m.items()}
            aid = str(account_id) if pd.notna(account_id) else ""
            nm = str(account_nm_en) if pd.notna(account_nm_en) else aid
            accounts.append({
                "account_id": aid,
                "account_nm_en": nm,
                "sap_shop_cd": "",
                "months": months,
                "months_sale": months_sale,
            })
        accounts.sort(key=lambda x: x["account_id"])
        result["brands"][brand_nm] = accounts

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    total = sum(len(result["brands"][b]) for b in BRAND_ORDER)
    print(f"Wrote {out_path} ({total} accounts)")


if __name__ == "__main__":
    main()
