"""
PL탭 실적 전용 전처리 스크립트 — 재고자산 탭(retail_2026.json)과 완전 독립

실행:
  python scripts/preprocess_retail_pl_actual.py          # 증분 (완료월 추가)
  python scripts/preprocess_retail_pl_actual.py --full   # 2026 전기간 재조회

결과: frontend/public/data/retail_store_2026.json

구조:
  brands[brand] → [{ account_id, stores: [{ storeCode, shopNmEn, shopNmCn, storeType, tradeZone,
                      regionCd, regionKr, cityTierNm, months(tag), months_sale(sale) }] }]

데이터 소스:
  - FNF.CHN.dw_sale: tag_amt(Tag), sale_amt(리테일V+)
  - FNF.CHN.MST_SHOP_ALL: shop_id(=store_cd), shop_nm_en, shop_nm_cn, city_tier_nm, anlys_shop_type_nm, trade_zone_nm, sale_region_cd
  - FR수익구조.csv: 地区→region_nm 한국어 매핑
"""

import os
import json
import csv
import argparse
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

QUERY = """
SELECT
    TO_CHAR(a.sale_dt, 'YYYYMM')     AS yymm,
    a.brd_cd,
    sm.account_id,
    sm.shop_id                        AS store_code,
    COALESCE(sm.anlys_shop_type_nm, '')  AS store_type,
    COALESCE(sm.trade_zone_nm, '')       AS trade_zone,
    COALESCE(sm.sale_region_cd, '')      AS region_cd,
    MAX(COALESCE(sm.shop_nm_en, ''))     AS shop_nm_en,
    MAX(COALESCE(sm.shop_nm_cn, ''))     AS shop_nm_cn,
    MAX(COALESCE(sm.city_tier_nm, ''))   AS city_tier_nm,
    SUM(COALESCE(a.tag_amt,  0))      AS tag_amt,
    SUM(COALESCE(a.sale_amt, 0))      AS sale_amt
FROM FNF.CHN.dw_sale a
JOIN FNF.CHN.MST_SHOP_ALL sm
  ON a.shop_id = sm.shop_id
 AND sm.fr_or_cls = 'FR'
WHERE a.brd_cd IN ('M', 'I', 'X')
  AND a.sale_dt >= DATE '{start_dt}'
  AND a.sale_dt <  DATE '{end_dt}'
GROUP BY 1, 2, 3, 4, 5, 6, 7
ORDER BY 1, 3, 4
"""


# ─── 유틸 ──────────────────────────────────────────────────────────

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


def get_last_complete_yymm() -> str:
    today = date.today()
    last = today.replace(day=1) - relativedelta(months=1)
    return last.strftime("%Y%m")


def yymm_to_date_range(start_yymm: str, end_yymm: str) -> tuple[str, str]:
    sy, sm = int(start_yymm[:4]), int(start_yymm[4:])
    ey, em = int(end_yymm[:4]), int(end_yymm[4:])
    start_dt = f"{sy}-{sm:02d}-01"
    end_month = em + 1
    end_year = ey
    if end_month > 12:
        end_month = 1
        end_year += 1
    end_dt = f"{end_year}-{end_month:02d}-01"
    return start_dt, end_dt


def load_region_map(csv_dir: Path) -> dict[str, str]:
    """FR수익구조.csv에서 地区(중국어) → region_nm(한국어) 딕셔너리 빌드."""
    candidates = [
        csv_dir / "FR수익구조.csv",
        csv_dir.parent / "FR수익구조.csv",
        csv_dir.parent.parent / "FR수익구조.csv",
    ]
    for p in candidates:
        if p.exists():
            region_map: dict[str, str] = {}
            with open(p, encoding="utf-8-sig", newline="") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    cd = (row.get("地区") or "").strip()
                    nm = (row.get("region_nm") or "").strip()
                    if cd and nm and cd not in region_map:
                        region_map[cd] = nm
            return region_map
    return {}


def get_incremental_range(out_path: Path) -> tuple:
    """(max_month, fetch_start, fetch_end). fetch_start가 None이면 추가할 월 없음."""
    last = get_last_complete_yymm()
    start_yymm = "202601"
    if int(last) < int(start_yymm):
        return (None, None, None)

    if not out_path.exists():
        return (None, start_yymm, min(last, "202612"))

    try:
        with open(out_path, encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, IOError):
        return (None, start_yymm, last)

    max_month = 0
    for brand_data in (data.get("brands") or {}).values():
        for acc in brand_data:
            for store in acc.get("stores") or []:
                m = store.get("months") or {}
                if m:
                    max_month = max(max_month, max(int(k) for k in m.keys()))

    end_cap = int("202612")
    if max_month >= 12 or int(f"2026{max_month+1:02d}") > min(int(last), end_cap):
        return (str(max_month), None, None)

    next_yymm = f"2026{max_month+1:02d}"
    fetch_end = min(last, "202612")
    return (str(max_month), next_yymm, fetch_end)


# ─── JSON 빌드 ────────────────────────────────────────────────────

def build_json(df: pd.DataFrame, region_map: dict[str, str], year: str = "2026") -> dict:
    result: dict = {"year": year, "brands": {}}
    df = df.copy()
    df["brand_nm"] = df["brd_cd"].map(BRAND_MAP)
    df["month"] = df["yymm"].astype(str).str[-2:].astype(int)

    for brand_nm in BRAND_ORDER:
        brand_df = df[df["brand_nm"] == brand_nm]
        accounts = []

        for account_id, acc_grp in brand_df.groupby("account_id", sort=False):
            aid = str(account_id) if pd.notna(account_id) else ""
            stores = []

            for _, store_grp in acc_grp.groupby("store_code", sort=False):
                first = store_grp.iloc[0]
                store_code = str(first["store_code"])
                store_type = str(first["store_type"])
                trade_zone = str(first["trade_zone"])
                region_cd  = str(first["region_cd"])
                region_kr  = region_map.get(region_cd, "")
                raw_nm = first["shop_nm_en"] if "shop_nm_en" in first.index else ""
                shop_nm_en = str(raw_nm).strip() if pd.notna(raw_nm) and str(raw_nm).strip() != "nan" else ""
                raw_cn = first["shop_nm_cn"] if "shop_nm_cn" in first.index else ""
                shop_nm_cn = str(raw_cn).strip() if pd.notna(raw_cn) and str(raw_cn).strip() != "nan" else ""
                raw_tier = first["city_tier_nm"] if "city_tier_nm" in first.index else ""
                city_tier_nm = (
                    str(raw_tier).strip()
                    if pd.notna(raw_tier) and str(raw_tier).strip() not in ("", "nan")
                    else ""
                )

                months: dict[str, int] = {}
                months_sale: dict[str, int] = {}
                for _, row in store_grp.iterrows():
                    m = int(row["month"])
                    months[str(m)]      = int(row["tag_amt"])
                    months_sale[str(m)] = int(row["sale_amt"])

                stores.append({
                    "storeCode": store_code,
                    "shopNmEn": shop_nm_en,
                    "shopNmCn": shop_nm_cn,
                    "storeType": store_type,
                    "tradeZone": trade_zone,
                    "regionCd":  region_cd,
                    "regionKr":  region_kr,
                    "cityTierNm": city_tier_nm,
                    "months":      months,
                    "months_sale": months_sale,
                })

            stores.sort(key=lambda x: x["storeCode"])
            accounts.append({"account_id": aid, "stores": stores})

        accounts.sort(key=lambda x: x["account_id"])
        result["brands"][brand_nm] = accounts

    return result


def _merge_months_dict(existing: dict, new: dict) -> dict:
    merged = {int(k): v for k, v in existing.items()}
    for k, v in new.items():
        merged[int(k)] = int(v)
    return {str(k): v for k, v in merged.items()}


def merge_new_months(existing: dict, df: pd.DataFrame, region_map: dict[str, str]) -> dict:
    new_data = build_json(df, region_map)
    existing.setdefault("brands", {})

    for brand_nm in BRAND_ORDER:
        new_accounts = new_data["brands"].get(brand_nm, [])
        ex_accounts = existing["brands"].setdefault(brand_nm, [])
        acc_by_id: dict[str, dict] = {a["account_id"]: a for a in ex_accounts}

        for new_acc in new_accounts:
            aid = new_acc["account_id"]
            if aid not in acc_by_id:
                ex_accounts.append(new_acc)
                acc_by_id[aid] = new_acc
            else:
                ex_acc = acc_by_id[aid]
                store_by_code: dict[str, dict] = {s["storeCode"]: s for s in ex_acc.get("stores", [])}

                for new_store in new_acc.get("stores", []):
                    sc = new_store["storeCode"]
                    if sc not in store_by_code:
                        ex_acc.setdefault("stores", []).append(new_store)
                        store_by_code[sc] = new_store
                    else:
                        ex_store = store_by_code[sc]
                        ex_store["months"]      = _merge_months_dict(ex_store.get("months", {}),      new_store.get("months", {}))
                        ex_store["months_sale"] = _merge_months_dict(ex_store.get("months_sale", {}), new_store.get("months_sale", {}))
                        # 마스터 속성 갱신 (가장 최신 month 기준)
                        for key in (
                            "storeType",
                            "tradeZone",
                            "regionCd",
                            "regionKr",
                            "shopNmEn",
                            "shopNmCn",
                            "cityTierNm",
                        ):
                            ex_store[key] = new_store[key]

                ex_acc["stores"].sort(key=lambda x: x["storeCode"])

        ex_accounts.sort(key=lambda x: x["account_id"])

    return existing


def fetch(conn, start_yymm: str, end_yymm: str) -> pd.DataFrame:
    start_dt, end_dt = yymm_to_date_range(start_yymm, end_yymm)
    df = pd.read_sql(QUERY.format(start_dt=start_dt, end_dt=end_dt), conn)
    df.columns = [c.lower() for c in df.columns]
    return df


# ─── main ─────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="PL 실적 전처리 (retail_store_2026.json)")
    parser.add_argument("--full", action="store_true", help="2026 전기간 재조회")
    args = parser.parse_args()

    output_dir = Path(__file__).parent.parent / "frontend" / "public" / "data"
    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = output_dir / "retail_store_2026.json"

    region_map = load_region_map(Path(__file__).parent.parent)
    print(f"지역 매핑: {len(region_map)}개 로드 ({', '.join(f'{k}→{v}' for k, v in list(region_map.items())[:5])}{'...' if len(region_map) > 5 else ''})")

    conn = get_connection()
    try:
        if args.full:
            last = get_last_complete_yymm()
            if int(last) < int("202601"):
                print("2026년 데이터 아직 없음")
                return
            fetch_end = min(last, "202612")
            print(f"전기간 조회: 202601 ~ {fetch_end}")
            df = fetch(conn, "202601", fetch_end)
            print(f"  조회: {len(df)}건")
            data = (
                build_json(df, region_map)
                if not df.empty
                else {"year": "2026", "brands": {b: [] for b in BRAND_ORDER}}
            )
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print(f"  저장 완료 → {out_path}")
        else:
            max_m, fetch_start, fetch_end = get_incremental_range(out_path)
            if fetch_start is None:
                print("추가할 완료월 없음 → 스킵")
                return

            existing = None
            if out_path.exists():
                with open(out_path, encoding="utf-8") as f:
                    existing = json.load(f)
                print(f"기존 max월={max_m} → {fetch_start}~{fetch_end} 증분")
            else:
                print(f"신규 {fetch_start}~{fetch_end}")

            df = fetch(conn, fetch_start, fetch_end)
            if df.empty:
                print("  조회 결과 없음")
                return

            print(f"  조회: {len(df)}건")
            if existing:
                data = merge_new_months(existing, df, region_map)
            else:
                data = build_json(df, region_map)

            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print(f"  저장 완료 → {out_path}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
