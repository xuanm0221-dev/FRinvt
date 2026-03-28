"""
FR 재고자산 - 리테일매출 전처리 스크립트 (실제 판매 데이터)

실행:
  python scripts/preprocess_retail.py          # 2026 증분만 (완료월 추가)
  python scripts/preprocess_retail.py --full   # 2026 전기간 재조회 (로직 변경 시)

결과: frontend/public/data/retail_2026.json

대분류/중분류 매핑 (dw_sale + DB_PRDT 조인):
  대분류: parent_prdt_kind_nm (의류/ACC)
  의류 중분류: sesn 컬럼 (24 이상 그대로, 24 미만 → 과시즌)
  ACC 중분류: prdt_kind_nm → Shoes=신발, Headwear=모자, Bag=가방, Acc_etc=기타
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

ACC_KIND_MAP = {"Shoes": "신발", "Headwear": "모자", "Bag": "가방", "Acc_etc": "기타"}
ACC_ORDER = ["신발", "모자", "가방", "기타"]
CAT_ORDER = {"의류": 0, "ACC": 1}

QUERY = """
SELECT
    TO_CHAR(a.sale_dt, 'YYYYMM')              AS yymm,
    a.brd_cd,
    sm.account_id,
    am.account_nm_en,
    COALESCE(p.parent_prdt_kind_nm, '기타')   AS parent_prdt_kind_nm,
    a.sesn,
    COALESCE(p.prdt_kind_nm, '')              AS prdt_kind_nm,
    SUM(COALESCE(a.tag_amt, 0))               AS retail_amt
FROM FNF.CHN.dw_sale a
JOIN FNF.CHN.MST_SHOP_ALL sm
  ON a.shop_id = sm.shop_id
 AND sm.fr_or_cls = 'FR'
LEFT JOIN FNF.CHN.mst_account am
  ON sm.account_id = am.account_id
LEFT JOIN FNF.PRCS.DB_PRDT p
  ON a.part_cd = p.part_cd
WHERE a.brd_cd IN ('M', 'I', 'X')
  AND a.sale_dt >= DATE '{start_dt}'
  AND a.sale_dt <  DATE '{end_dt}'
GROUP BY 1, 2, 3, 4, 5, 6, 7
ORDER BY 1, 3
"""


def sesn_to_midclass(sesn) -> str:
    """시즌코드 → 중분류명. 유효한 시즌코드는 그대로 유지 (과시즌 그룹핑은 프론트엔드에서 처리)"""
    if pd.isna(sesn) or not str(sesn).strip():
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


def get_incremental_range(output_dir: Path) -> tuple:
    """(max_month, fetch_start, fetch_end). fetch_start가 None이면 추가할 월 없음."""
    last = get_last_complete_yymm()
    start_yymm = "202601"
    if int(last) < int(start_yymm):
        return (None, None, None)

    path = output_dir / "retail_2026.json"
    if not path.exists():
        fetch_end = min(last, "202612")
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

    end_cap = int("202612")
    if max_month >= 12 or int(f"2026{max_month+1:02d}") > min(int(last), end_cap):
        return (str(max_month), None, None)

    next_yymm = f"2026{max_month+1:02d}"
    fetch_end = min(last, "202612")
    return (str(max_month), next_yymm, fetch_end)


def _apply_category_cols(df: pd.DataFrame) -> pd.DataFrame:
    """대분류/중분류 컬럼 추가"""
    df = df.copy()
    df["대분류"] = df["parent_prdt_kind_nm"].fillna("기타")
    df["중분류"] = df.apply(
        lambda r: sesn_to_midclass(r.get("sesn", ""))
        if r["대분류"] == "의류"
        else ACC_KIND_MAP.get(str(r.get("prdt_kind_nm", "")), "기타")
        if r["대분류"] == "ACC"
        else "기타",
        axis=1,
    )
    return df


def _months_dict(grp: pd.DataFrame, val_col: str) -> dict:
    if grp.empty:
        return {}
    return {
        int(m): int(v)
        for m, v in grp.groupby("month")[val_col].sum().items()
    }


def _build_categories(acc_grp: pd.DataFrame) -> list:
    """대분류/중분류 계층 구조 생성 (retail은 base_stock 없음)"""
    categories = []
    for 대분류_nm, cat_grp in acc_grp.groupby("대분류", sort=False):
        대분류_nm = str(대분류_nm)
        cat_months = _months_dict(cat_grp, "retail_amt")

        subcategories = []
        for 중분류_nm, sub_grp in cat_grp.groupby("중분류", sort=False):
            sub_months = _months_dict(sub_grp, "retail_amt")
            subcategories.append({"중분류": str(중분류_nm), "months": sub_months})

        if 대분류_nm == "의류":
            subcategories.sort(key=lambda x: sesn_sort_key(x["중분류"]))
        elif 대분류_nm == "ACC":
            acc_order_map = {v: i for i, v in enumerate(ACC_ORDER)}
            subcategories.sort(key=lambda x: acc_order_map.get(x["중분류"], 99))

        categories.append({"대분류": 대분류_nm, "months": cat_months, "subcategories": subcategories})

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


def fetch(conn, start_yymm: str, end_yymm: str) -> pd.DataFrame:
    start_dt, end_dt = yymm_to_date_range(start_yymm, end_yymm)
    df = pd.read_sql(QUERY.format(start_dt=start_dt, end_dt=end_dt), conn)
    df.columns = [c.lower() for c in df.columns]
    return df


def build_json(df: pd.DataFrame, year: str = "2026") -> dict:
    result = {"year": year, "brands": {}}
    df = df.copy()
    df["brand_nm"] = df["brd_cd"].map(BRAND_MAP)
    df["month"] = df["yymm"].astype(str).str[-2:].astype(int)
    df = _apply_category_cols(df)

    for brand_nm in BRAND_ORDER:
        brand_df = df[df["brand_nm"] == brand_nm]
        accounts = []

        for (account_id, account_nm_en), acc_grp in brand_df.groupby(
            ["account_id", "account_nm_en"], sort=False
        ):
            account_months = _months_dict(acc_grp, "retail_amt")
            categories = _build_categories(acc_grp)
            accounts.append({
                "account_id": str(account_id) if pd.notna(account_id) else "",
                "account_nm_en": str(account_nm_en) if pd.notna(account_nm_en) else str(account_id),
                "sap_shop_cd": "",
                "months": account_months,
                "categories": categories,
            })

        accounts.sort(key=lambda x: x["account_id"])
        result["brands"][brand_nm] = accounts
    return result


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

        for (account_id, account_nm_en), acc_grp in brand_df.groupby(
            ["account_id", "account_nm_en"], sort=False
        ):
            aid = str(account_id)
            acc = acc_by_id.get(aid)
            new_acc_months = _months_dict(acc_grp, "retail_amt")
            new_cats = _build_categories(acc_grp)

            if acc is None:
                acc = {
                    "account_id": aid,
                    "account_nm_en": str(account_nm_en) if pd.notna(account_nm_en) else aid,
                    "sap_shop_cd": "",
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
    parser = argparse.ArgumentParser()
    parser.add_argument("--full", action="store_true", help="2026 전기간 재조회")
    args = parser.parse_args()

    output_dir = Path(__file__).parent.parent / "frontend" / "public" / "data"
    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = output_dir / "retail_2026.json"

    conn = get_connection()
    try:
        if args.full:
            last = get_last_complete_yymm()
            if int(last) < int("202601"):
                print("2026년 데이터 아직 없음")
                return
            fetch_end = min(last, "202612")
            print(f"2026년 전기간 조회: 202601 ~ {fetch_end}")
            df = fetch(conn, "202601", fetch_end)
            print(f"  조회: {len(df)}건")
            data = (
                build_json(df, "2026")
                if not df.empty
                else {"year": "2026", "brands": {b: [] for b in BRAND_ORDER}}
            )
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print("  저장 완료")
        else:
            max_m, fetch_start, fetch_end = get_incremental_range(output_dir)
            if fetch_start is None:
                print("2026년: 추가할 완료월 없음 → 스킵")
                return

            existing = None
            if out_path.exists():
                with open(out_path, encoding="utf-8") as f:
                    existing = json.load(f)
                print(f"2026년: 기존 max월={max_m} → {fetch_start}~{fetch_end} 증분")
            else:
                print(f"2026년: 신규 {fetch_start}~{fetch_end}")

            df = fetch(conn, fetch_start, fetch_end)
            if df.empty:
                print("  조회 결과 없음")
                return

            print(f"  조회: {len(df)}건")
            if existing:
                data = merge_new_months(existing, df)
            else:
                data = build_json(df, "2026")

            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print("  저장 완료")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
