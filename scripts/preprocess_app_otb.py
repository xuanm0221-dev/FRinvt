"""
FR 재고자산 - 의류 OTB 전처리 스크립트

실행:
  python scripts/preprocess_app_otb.py

데이터 소스:
  - OTB (계획금액): D:/dashboard/FRINVT/OTB_K.csv (천위안, account별·시즌별)
  - 누적입고 (실적): Snowflake dw_cn_copa_d, 2025-10 ~ 기준월, 의류·대상시즌 필터
  - 대리상 영문명: Snowflake mst_account (account_id 기준)

결과: frontend/public/data/app_otb_2026.json

JSON 구조:
  {
    "year": "2026",
    "cumLabel": "26.02",   ← 누적입고 기준월 (YYYY.MM 형식)
    "brands": {
      "MLB": [
        {
          "account_id": "D001",
          "account_nm_en": "Shanghai Lingbo...",
          "seasons": {
            "26S": { "otb": 283860, "cumInbound": 1200, "planned": 282660 },
            "26F": { ... }, "27S": { ... }, "27F": { ... }
          }
        }, ...
      ],
      "MLB KIDS": [...], "DISCOVERY": [...]
    }
  }
"""

import os
import json
import re
from datetime import date
from dateutil.relativedelta import relativedelta
from pathlib import Path

import pandas as pd
import snowflake.connector
from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(dotenv_path=env_path)

BRAND_MAP = {"M": "MLB", "I": "MLB KIDS", "X": "DISCOVERY"}
BRAND_ORDER = ["MLB", "MLB KIDS", "DISCOVERY"]
TARGET_SEASONS = ["26S", "26F", "27S", "27F"]

CSV_PATH = Path(__file__).parent.parent / "OTB_K.csv"
OUTPUT_DIR = Path(__file__).parent.parent / "frontend" / "public" / "data"

# ─── 기준월 계산 ────────────────────────────────
def get_cum_range() -> tuple[str, str, str]:
    """
    누적입고 조회 기간 및 cumLabel 계산.
    시작: 2025-10-01
    종료: 2026년의 마지막 완료월 말 (오늘 기준 전월까지, 최대 2026-12)
    """
    today = date.today()
    last_complete = today.replace(day=1) - relativedelta(months=1)
    # 2026년 데이터만 cumLabel에 표시 (2025년은 누적에만 포함)
    if last_complete.year < 2026:
        # 아직 2026년 데이터 없음 → cumLabel은 None
        cum_label = None
    else:
        end_2026 = min(last_complete, date(2026, 12, 31))
        cum_label = f"26.{end_2026.month:02d}"

    start_dt = "2025-10-01"
    end_month = last_complete + relativedelta(months=1)  # 다음 월 1일 (exclusive)
    end_dt = end_month.strftime("%Y-%m-01")
    return start_dt, end_dt, cum_label


# ─── Snowflake 연결 ─────────────────────────────
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


# ─── 누적입고 쿼리 (의류·대상시즌 필터) ──────────
CUM_INBOUND_QUERY = """
WITH base AS (
    SELECT
        a.brd_cd,
        LPAD(TRIM(CAST(a.sap_shop_cd AS VARCHAR)), 10, '0') AS hq_sap_id,
        SUBSTR(a.prdt_cd, 2, 3)                             AS sesn_cd,
        YEAR(a.pst_dt)                                      AS yr,
        COALESCE(a.tag_sale_amt, 0)                         AS inbound_amt
    FROM FNF.SAP_FNF.dw_cn_copa_d a
    WHERE a.chnl_cd = '84'
      AND a.brd_cd IN ('M', 'I', 'X')
      AND a.prdt_hrrc_cd1 = 'L0100'
      AND SUBSTR(a.prdt_cd, 2, 3) IN ('26S', '26F', '27S', '27F')
      AND a.pst_dt >= DATE '{start_dt}'
      AND a.pst_dt <  DATE '{end_dt}'
),
account_map AS (
    SELECT
        TRIM(hq_sap_id) AS hq_sap_id,
        account_id,
        account_nm_en
    FROM FNF.CHN.mst_account
    WHERE hq_sap_id IS NOT NULL
)
SELECT
    b.brd_cd,
    am.account_id,
    am.account_nm_en,
    b.sesn_cd,
    b.yr,
    SUM(b.inbound_amt) AS inbound_amt
FROM base b
LEFT JOIN account_map am ON b.hq_sap_id = am.hq_sap_id
WHERE am.account_id IS NOT NULL
GROUP BY b.brd_cd, am.account_id, am.account_nm_en, b.sesn_cd, b.yr
ORDER BY am.account_id
"""

ACCOUNT_NAME_QUERY = """
SELECT account_id, account_nm_en
FROM FNF.CHN.mst_account
WHERE account_id IS NOT NULL
"""


def fetch_cum_inbound(conn, start_dt: str, end_dt: str) -> pd.DataFrame:
    df = pd.read_sql(
        CUM_INBOUND_QUERY.format(start_dt=start_dt, end_dt=end_dt), conn
    )
    df.columns = [c.lower() for c in df.columns]
    df["brand_nm"] = df["brd_cd"].map(BRAND_MAP)
    df["inbound_amt"] = df["inbound_amt"] / 1000  # 원 → 천위안
    return df


def fetch_account_names(conn) -> dict:
    df = pd.read_sql(ACCOUNT_NAME_QUERY, conn)
    df.columns = [c.lower() for c in df.columns]
    return dict(zip(df["account_id"], df["account_nm_en"]))


# ─── CSV 읽기 ────────────────────────────────────
def load_otb_csv() -> pd.DataFrame:
    """OTB_K.csv 읽기. 컬럼: brd_cd, sesn, account_id, [중국어명], Amount"""
    df = pd.read_csv(
        CSV_PATH,
        header=0,
        names=["brd_cd", "sesn", "account_id", "name_cn", "amount"],
        dtype=str,
    )
    # Amount 정제: 쉼표·공백·따옴표 제거 → 숫자
    df["amount"] = (
        df["amount"]
        .fillna("0")
        .apply(lambda x: re.sub(r"[,\s\"']", "", str(x)))
    )
    df["amount"] = pd.to_numeric(df["amount"], errors="coerce").fillna(0)

    # 브랜드 필터 & 시즌 필터
    df = df[df["brd_cd"].isin(BRAND_MAP.keys())].copy()
    df = df[df["sesn"].isin(TARGET_SEASONS)].copy()
    df["brand_nm"] = df["brd_cd"].map(BRAND_MAP)

    # 같은 account+sesn 중복 합산
    df = (
        df.groupby(["brand_nm", "account_id", "sesn"], as_index=False)["amount"]
        .sum()
    )
    return df


# ─── 데이터 병합 및 JSON 구성 ─────────────────────
def build_json(
    otb_df: pd.DataFrame,
    cum_df: pd.DataFrame,
    account_names: dict,
    cum_label: str,
) -> dict:
    result = {
        "year": "2026",
        "cumLabel": cum_label or "",
        "brands": {},
    }

    # 누적입고: (brand_nm, account_id, sesn_cd, yr) → inbound_amt
    cum_map: dict[tuple, float] = {}
    for _, row in cum_df.iterrows():
        key = (row["brand_nm"], str(row["account_id"]), str(row["sesn_cd"]), int(row["yr"]))
        cum_map[key] = cum_map.get(key, 0) + row["inbound_amt"]

    for brand in BRAND_ORDER:
        otb_brand = otb_df[otb_df["brand_nm"] == brand]
        cum_brand = cum_df[cum_df["brand_nm"] == brand]

        account_ids = sorted(
            set(otb_brand["account_id"].tolist())
            | set(cum_brand["account_id"].astype(str).tolist())
        )

        # OTB: (account_id, sesn) → amount
        otb_map: dict[tuple, float] = {}
        for _, row in otb_brand.iterrows():
            key = (str(row["account_id"]), str(row["sesn"]))
            otb_map[key] = otb_map.get(key, 0) + row["amount"]

        accounts = []
        for acc_id in account_ids:
            acc_nm = account_names.get(acc_id, acc_id)
            seasons: dict[str, dict] = {}
            for sesn in TARGET_SEASONS:
                otb_val = round(otb_map.get((acc_id, sesn), 0))
                cum_2025 = round(cum_map.get((brand, acc_id, sesn, 2025), 0))
                cum_2026 = round(cum_map.get((brand, acc_id, sesn, 2026), 0))
                planned = otb_val - cum_2025 - cum_2026
                seasons[sesn] = {
                    "otb": otb_val,
                    "cum2025": cum_2025,
                    "cum2026": cum_2026,
                    "planned": planned,
                }
            accounts.append({
                "account_id": acc_id,
                "account_nm_en": acc_nm,
                "seasons": seasons,
            })

        result["brands"][brand] = accounts

    return result


def main():
    print("=== 의류 OTB 전처리 ===\n")

    # 1. 기준월 계산
    start_dt, end_dt, cum_label = get_cum_range()
    print(f"누적입고 기간: {start_dt} ~ {end_dt}")
    print(f"cumLabel: {cum_label}\n")

    # 2. CSV 로드
    print(f"OTB CSV 로드: {CSV_PATH}")
    otb_df = load_otb_csv()
    print(f"  → {len(otb_df)}건 (브랜드·시즌·계정 집계)\n")

    # 3. Snowflake 조회
    print("Snowflake 연결 중...")
    conn = get_connection()
    print("연결 성공\n")

    print("누적입고 조회 중...")
    cum_df = fetch_cum_inbound(conn, start_dt, end_dt)
    print(f"  → {len(cum_df)}건\n")

    print("대리상 영문명 조회 중...")
    account_names = fetch_account_names(conn)
    print(f"  → {len(account_names)}개 계정\n")

    conn.close()

    # 4. JSON 구성
    print("JSON 구성 중...")
    data = build_json(otb_df, cum_df, account_names, cum_label)

    # 5. 저장
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / "app_otb_2026.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"저장 완료: {out_path}")
    print("\n의류 OTB 전처리 완료!")


if __name__ == "__main__":
    main()
