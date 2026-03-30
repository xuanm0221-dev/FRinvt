"""
FR수익구조.csv 城市(중문) → MST_SHOP_ALL.city_tier_nm 매핑용 JSON 생성

실행:
  python scripts/preprocess_city_tier_map.py

결과: frontend/public/data/city_tier_map.json
형식: { "哈尔滨市": "Tier1", ... }  (키=city_nm, 값=city_tier_nm)

PL 목표 모드 매장 모달 City tier KPI에 사용.
"""

import os
import json
from pathlib import Path

import pandas as pd
import snowflake.connector
from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(dotenv_path=env_path)

QUERY = """
SELECT DISTINCT
    TRIM(COALESCE(city_nm, ''))         AS city_nm,
    TRIM(COALESCE(city_tier_nm, ''))    AS city_tier_nm
FROM FNF.CHN.MST_SHOP_ALL
WHERE fr_or_cls = 'FR'
  AND TRIM(COALESCE(city_nm, '')) <> ''
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


def main():
    out_dir = Path(__file__).parent.parent / "frontend" / "public" / "data"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "city_tier_map.json"

    conn = get_connection()
    try:
        df = pd.read_sql(QUERY, conn)
        df.columns = [c.lower() for c in df.columns]
        m: dict[str, str] = {}
        for _, row in df.iterrows():
            cn = str(row.get("city_nm", "") or "").strip()
            tier = str(row.get("city_tier_nm", "") or "").strip()
            if not cn:
                continue
            if cn not in m and tier:
                m[cn] = tier
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(m, f, ensure_ascii=False, indent=2)
        print(f"저장: {out_path} ({len(m)}개 city_nm)")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
