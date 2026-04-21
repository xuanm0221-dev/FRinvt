"""
FR 재고자산 - 입고물량 전처리 스크립트 (본사 → 대리상 출고)

실행:
  python scripts/preprocess_inbound.py          # 2025 스킵(있으면), 2026 증분만
  python scripts/preprocess_inbound.py --full   # 2025~2026 전기간 재조회 (로직 변경 시)

결과: frontend/public/data/inbound_{year}.json

대분류/중분류 매핑 (dw_cn_copa_d 자체 컬럼 사용, DB_PRDT 조인 없음):
  prdt_hrrc_cd1: A0100=ACC, L0100=의류
  prdt_hrrc_cd2: A0100A0120=기타, A0100A0130=가방, A0100A0140=모자, A0100A0150=신발
  sesn: prdt_cd 2~4번째 문자 (예: "M25N3AHTB055N" → "25N"), 24 미만 → 과시즌
"""

import os
import json
import argparse
from datetime import date
from dateutil.relativedelta import relativedelta
import pandas as pd
import snowflake.connector
from dotenv import load_dotenv
from pathlib import Path

env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(dotenv_path=env_path)

BRAND_MAP = {"M": "MLB", "I": "MLB KIDS", "X": "DISCOVERY"}
BRAND_ORDER = ["MLB", "MLB KIDS", "DISCOVERY"]

HRRC1_MAP = {"A0100": "ACC", "L0100": "의류"}
HRRC2_MAP = {
    "A0100A0120": "기타",
    "A0100A0130": "가방",
    "A0100A0140": "모자",
    "A0100A0150": "신발",
}
ACC_ORDER = ["신발", "모자", "가방", "기타"]
CAT_ORDER = {"의류": 0, "ACC": 1}


def sesn_to_midclass(sesn: str) -> str:
    """시즌코드 → 중분류명. 유효한 시즌코드는 그대로 유지 (과시즌 그룹핑은 프론트엔드에서 처리)"""
    if not sesn or not str(sesn).strip():
        return "과시즌"
    s = str(sesn).strip()
    try:
        int(s[:2])  # 유효한 시즌코드인지 확인 (예: 24S, 23F)
        return s
    except (ValueError, IndexError):
        return "과시즌"


def sesn_sort_key(s: str) -> tuple:
    """의류 중분류 정렬: 연도 높은 순, 같은 연도면 F→S→N, 과시즌 맨 뒤"""
    if s == "과시즌":
        return (9999, 99)
    try:
        year = int(s[:2])
        suffix = s[2:] if len(s) > 2 else ""
        suffix_order = {"F": 0, "S": 1, "N": 2}.get(suffix, 3)
        return (-year, suffix_order)
    except Exception:
        return (9998, 99)


def get_inbound_categories(row) -> tuple:
    """prdt_hrrc_cd1/2, sesn_cd → (대분류, 중분류)"""
    hrrc1 = str(row.get("prdt_hrrc_cd1", "")).strip()
    hrrc2 = str(row.get("prdt_hrrc_cd2", "")).strip()
    sesn_cd = str(row.get("sesn_cd", "")).strip()

    대분류 = HRRC1_MAP.get(hrrc1, "기타")
    if 대분류 == "ACC":
        중분류 = HRRC2_MAP.get(hrrc2, "기타")
    elif 대분류 == "의류":
        중분류 = sesn_to_midclass(sesn_cd)
    else:
        중분류 = "기타"
    return 대분류, 중분류


def get_last_complete_yymm() -> str:
    today = date.today()
    last = today.replace(day=1) - relativedelta(months=1)
    return last.strftime("%Y%m")


def get_year_ranges_full() -> dict:
    last = get_last_complete_yymm()
    ranges = {}
    for year in [2025, 2026]:
        start = f"{year}01"
        end_cap = f"{year}12"
        if int(last) < int(start):
            continue
        ranges[str(year)] = (start, min(last, end_cap))
    return ranges


def get_incremental_range(output_dir: Path, year: int) -> tuple:
    """(max_month, fetch_start, fetch_end). fetch_start가 None이면 추가할 월 없음."""
    last = get_last_complete_yymm()
    start_yymm = f"{year}01"
    if int(last) < int(start_yymm):
        return (None, None, None)
    path = output_dir / f"inbound_{year}.json"
    if not path.exists():
        fetch_end = min(last, f"{year}12")
        return (None, start_yymm, fetch_end)
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, IOError):
        return (None, start_yymm, last)
    max_month = 0
    for brand_data in (data.get("brands") or {}).values():
        for acc in brand_data:
            m = acc.get("months") or {}
            if m:
                max_month = max(max_month, max(int(k) for k in m.keys()))
    end_cap = int(f"{year}12")
    if max_month >= 12 or int(f"{year}{max_month+1:02d}") > min(int(last), end_cap):
        return (str(max_month), None, None)
    next_yymm = f"{year}{max_month+1:02d}"
    fetch_end = min(last, f"{year}12")
    return (str(max_month), next_yymm, fetch_end)


def _months_dict(grp: pd.DataFrame, val_col: str) -> dict:
    return {
        int(m): int(v)
        for m, v in grp.groupby("month")[val_col].sum().items()
    }


def _build_categories(acc_grp: pd.DataFrame) -> list:
    """대분류 → 중분류 계층 구조 생성"""
    categories = []
    for 대분류_nm, cat_grp in acc_grp.groupby("대분류", sort=False):
        대분류_nm = str(대분류_nm)
        cat_months = _months_dict(cat_grp, "inbound_amt")

        subcategories = []
        for 중분류_nm, sub_grp in cat_grp.groupby("중분류", sort=False):
            sub_months = _months_dict(sub_grp, "inbound_amt")
            subcategories.append({"중분류": str(중분류_nm), "months": sub_months})

        if 대분류_nm == "의류":
            subcategories.sort(key=lambda x: sesn_sort_key(x["중분류"]))
        elif 대분류_nm == "ACC":
            acc_order_map = {v: i for i, v in enumerate(ACC_ORDER)}
            subcategories.sort(key=lambda x: acc_order_map.get(x["중분류"], 99))

        categories.append({
            "대분류": 대분류_nm,
            "months": cat_months,
            "subcategories": subcategories,
        })

    categories.sort(key=lambda x: CAT_ORDER.get(x["대분류"], 99))
    return categories


def _merge_months(existing: dict, new: dict) -> dict:
    result = {int(k): v for k, v in existing.items()}
    for k, v in new.items():
        result[int(k)] = v
    return result


def _merge_categories(existing_cats: list, new_cats: list) -> list:
    cat_map = {c["대분류"]: c for c in existing_cats}
    for new_cat in new_cats:
        dbn = new_cat["대분류"]
        if dbn not in cat_map:
            existing_cats.append(new_cat)
            cat_map[dbn] = new_cat
        else:
            ec = cat_map[dbn]
            ec["months"] = _merge_months(ec.get("months", {}), new_cat["months"])
            sub_map = {s["중분류"]: s for s in ec.get("subcategories", [])}
            for new_sub in new_cat.get("subcategories", []):
                jbn = new_sub["중분류"]
                if jbn not in sub_map:
                    ec.setdefault("subcategories", []).append(new_sub)
                    sub_map[jbn] = new_sub
                else:
                    sub_map[jbn]["months"] = _merge_months(
                        sub_map[jbn].get("months", {}), new_sub["months"]
                    )
            if dbn == "의류":
                ec["subcategories"].sort(key=lambda x: sesn_sort_key(x["중분류"]))
            elif dbn == "ACC":
                acc_order_map = {v: i for i, v in enumerate(ACC_ORDER)}
                ec["subcategories"].sort(key=lambda x: acc_order_map.get(x["중분류"], 99))

    existing_cats.sort(key=lambda x: CAT_ORDER.get(x["대분류"], 99))
    return existing_cats


def _apply_category_cols(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    cats = df.apply(get_inbound_categories, axis=1)
    df["대분류"] = cats.apply(lambda x: x[0])
    df["중분류"] = cats.apply(lambda x: x[1])
    return df


def merge_new_months(existing: dict, new_df: pd.DataFrame) -> dict:
    new_df = new_df.copy()
    new_df["brand_nm"] = new_df["brd_cd"].map(BRAND_MAP)
    new_df["month"] = new_df["yymm"].astype(str).str[-2:].astype(int)
    new_df = _apply_category_cols(new_df)
    existing.setdefault("brands", {})

    for brand_nm in BRAND_ORDER:
        brand_df = new_df[new_df["brand_nm"] == brand_nm]
        if brand_df.empty:
            continue
        accounts = existing["brands"].setdefault(brand_nm, [])
        acc_by_id = {a["account_id"]: a for a in accounts}

        for (account_id, account_nm_en, sap_shop_cd), acc_grp in brand_df.groupby(
            ["account_id", "account_nm_en", "sap_shop_cd"], sort=False
        ):
            aid = str(account_id)
            acc = acc_by_id.get(aid)
            new_acc_months = _months_dict(acc_grp, "inbound_amt")
            new_cats = _build_categories(acc_grp)

            if acc is None:
                acc = {
                    "account_id": aid,
                    "account_nm_en": str(account_nm_en) if pd.notna(account_nm_en) else aid,
                    "sap_shop_cd": str(sap_shop_cd) if pd.notna(sap_shop_cd) else "",
                    "months": new_acc_months,
                    "categories": new_cats,
                }
                accounts.append(acc)
                acc_by_id[aid] = acc
            else:
                acc["months"] = _merge_months(acc.get("months", {}), new_acc_months)
                acc["categories"] = _merge_categories(acc.get("categories", []), new_cats)

        accounts.sort(key=lambda x: x["account_id"])
    return existing


from snowflake_conn import get_connection  # noqa: E402,F401


# prdt_hrrc_cd1, prdt_hrrc_cd2, prdt_cd(2~4번째=시즌) 추가
QUERY = """
WITH base AS (
    SELECT
        TO_CHAR(a.pst_dt, 'YYYYMM')              AS yymm,
        a.brd_cd,
        TRIM(CAST(a.sap_shop_cd AS VARCHAR))      AS sap_shop_cd,
        LPAD(TRIM(CAST(a.sap_shop_cd AS VARCHAR)), 10, '0') AS hq_sap_id,
        COALESCE(a.prdt_hrrc_cd1, '')             AS prdt_hrrc_cd1,
        COALESCE(a.prdt_hrrc_cd2, '')             AS prdt_hrrc_cd2,
        SUBSTR(a.prdt_cd, 2, 3)                   AS sesn_cd,
        COALESCE(a.tag_sale_amt, 0)               AS inbound_amt
    FROM FNF.SAP_FNF.dw_cn_copa_d a
    WHERE a.chnl_cd = '84'
      AND a.brd_cd IN ('M', 'I', 'X')
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
    b.yymm,
    b.brd_cd,
    b.sap_shop_cd,
    am.account_id,
    am.account_nm_en,
    b.prdt_hrrc_cd1,
    b.prdt_hrrc_cd2,
    b.sesn_cd,
    SUM(b.inbound_amt) AS inbound_amt
FROM base b
LEFT JOIN account_map am
  ON b.hq_sap_id = am.hq_sap_id
GROUP BY b.yymm, b.brd_cd, b.sap_shop_cd, am.account_id, am.account_nm_en,
         b.prdt_hrrc_cd1, b.prdt_hrrc_cd2, b.sesn_cd
ORDER BY b.yymm, am.account_id
"""


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


def fetch(conn, start_yymm: str, end_yymm: str) -> pd.DataFrame:
    start_dt, end_dt = yymm_to_date_range(start_yymm, end_yymm)
    df = pd.read_sql(QUERY.format(start_dt=start_dt, end_dt=end_dt), conn)
    df.columns = [c.lower() for c in df.columns]
    return df


def build_json(df: pd.DataFrame, year: str) -> dict:
    result = {"year": year, "brands": {}}
    df = df.copy()
    df["brand_nm"] = df["brd_cd"].map(BRAND_MAP)
    df["month"] = df["yymm"].astype(str).str[-2:].astype(int)
    df = _apply_category_cols(df)

    for brand_nm in BRAND_ORDER:
        brand_df = df[df["brand_nm"] == brand_nm]
        accounts = []

        for (account_id, account_nm_en, sap_shop_cd), acc_grp in brand_df.groupby(
            ["account_id", "account_nm_en", "sap_shop_cd"], sort=False
        ):
            account_months = _months_dict(acc_grp, "inbound_amt")
            categories = _build_categories(acc_grp)
            accounts.append({
                "account_id": str(account_id) if pd.notna(account_id) else "",
                "account_nm_en": str(account_nm_en) if pd.notna(account_nm_en) else str(sap_shop_cd),
                "sap_shop_cd": str(sap_shop_cd) if pd.notna(sap_shop_cd) else "",
                "months": account_months,
                "categories": categories,
            })

        accounts.sort(key=lambda x: x["account_id"])
        result["brands"][brand_nm] = accounts
    return result


def process_year_full(conn, output_dir: Path, year: str, start: str, end: str):
    print(f"{year}년 전기간 조회 ({start} ~ {end})")
    df = fetch(conn, start, end)
    print(f"  조회: {len(df)}건")
    data = (
        build_json(df, year)
        if not df.empty
        else {"year": year, "brands": {b: [] for b in BRAND_ORDER}}
    )
    with open(output_dir / f"inbound_{year}.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print("  저장 완료")


def process_year_incremental(conn, output_dir: Path, year: int):
    path = output_dir / f"inbound_{year}.json"
    if year == 2025 and path.exists():
        print(f"2025년: 이미 존재 → 스킵")
        return

    max_m, fetch_start, fetch_end = get_incremental_range(output_dir, year)
    if fetch_start is None:
        print(f"{year}년: 추가할 완료월 없음 → 스킵")
        return

    existing = None
    if path.exists():
        with open(path, encoding="utf-8") as f:
            existing = json.load(f)
        print(f"{year}년: 기존 max월={max_m} → {fetch_start}~{fetch_end} 증분")
    else:
        print(f"{year}년: 신규 {fetch_start}~{fetch_end}")

    df = fetch(conn, fetch_start, fetch_end)
    if df.empty:
        print("  조회 결과 없음")
        return
    print(f"  조회: {len(df)}건")
    data = merge_new_months(existing, df) if existing else build_json(df, str(year))
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print("  저장 완료")


def main():
    parser = argparse.ArgumentParser(description="FR 입고물량 전처리")
    parser.add_argument("--full", action="store_true", help="2025~2026 전기간 재조회")
    args = parser.parse_args()

    output_dir = Path(__file__).parent.parent / "frontend" / "public" / "data"
    output_dir.mkdir(parents=True, exist_ok=True)

    print("Snowflake 연결 중...")
    conn = get_connection()
    print("연결 성공\n")

    if args.full:
        print("[--full] 전기간 재조회\n")
        for year, (start, end) in get_year_ranges_full().items():
            try:
                process_year_full(conn, output_dir, year, start, end)
            except Exception as e:
                print(f"  오류: {e}")
    else:
        for year in [2025, 2026]:
            try:
                process_year_incremental(conn, output_dir, year)
            except Exception as e:
                print(f"  {year}년 오류: {e}")
        print()

    conn.close()
    print("\n입고물량 전처리 완료!")


if __name__ == "__main__":
    main()
