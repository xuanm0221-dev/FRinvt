"""
FR 전년(2024) 리테일 매출 전처리 스크립트

chn.dw_sale에서 2024년 브랜드별 매장별 월별 SALE_AMT를 집계하여
frontend/public/data/retail_yoy_2024.json 으로 저장합니다.

실행:
  python scripts/preprocess_retail_yoy.py

출력 구조:
  {
    "year": 2024,
    "stores": {
      "CN003": { "1": 44723737, "2": 20854420, ..., "12": 30000000 },
      ...
    }
  }
"""

import os
import json
import snowflake.connector
from dotenv import load_dotenv
from pathlib import Path

env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(dotenv_path=env_path)

OUT_PATH = Path(__file__).parent.parent / "frontend" / "public" / "data" / "retail_yoy_2024.json"

QUERY = """
SELECT
    OA_SHOP_ID,
    MONTH(SALE_DT) AS mo,
    SUM(SALE_AMT)  AS retail
FROM chn.dw_sale
WHERE YEAR(SALE_DT) = 2024
  AND BRD_CD IN ('M', 'I', 'X')
  AND COALESCE(RET_YN, FALSE) = FALSE
GROUP BY 1, 2
ORDER BY 1, 2
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
    print("Snowflake 연결 중...")
    conn = get_connection()
    cur = conn.cursor()

    print("2024년 리테일 매출 조회 중...")
    cur.execute(QUERY)
    rows = cur.fetchall()
    cur.close()
    conn.close()

    stores: dict[str, dict[str, float]] = {}
    for shop_id, mo, retail in rows:
        if not shop_id:
            continue
        key = str(shop_id).strip()
        if key not in stores:
            stores[key] = {}
        stores[key][str(int(mo))] = round(float(retail), 2)

    result = {"year": 2024, "stores": stores}

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"완료: {OUT_PATH}  (매장 수: {len(stores)})")


if __name__ == "__main__":
    main()
