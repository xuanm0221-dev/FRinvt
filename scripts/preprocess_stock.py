"""
FR 재고자산 - 재고잔액 전처리 스크립트

실행:
  python scripts/preprocess_stock.py          # 2025 스킵(있으면), 2026 증분만
  python scripts/preprocess_stock.py --full   # 전년 12월부터 조회 → 카테고리별 기초재고 포함

결과: frontend/public/data/stock_{year}.json

로직 (2025·2026 동일):
  - LEFT JOIN DB_PRDT: 상품마스터 미매칭 시에도 행 누락 없음 (COALESCE로 기타 처리)
  - 전년 12월 = 기초재고, 당해 월별 = 실적월

기초재고 전략:
  --full / 신규 파일 생성 시: 전년 12월 데이터를 메인 쿼리에 포함하여 조회
    → 카테고리별(대분류/중분류) base_stock 자동 산출
  증분(기존 파일 있는 경우): base_stock은 이미 JSON에 존재 → 월별 데이터만 병합
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
BRAND_CD_MAP = {v: k for k, v in BRAND_MAP.items()}

ACC_KIND_MAP = {"Shoes": "신발", "Headwear": "모자", "Bag": "가방", "Acc_etc": "기타"}
ACC_ORDER = ["신발", "모자", "가방", "기타"]
CAT_ORDER = {"의류": 0, "ACC": 1}


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


def get_year_ranges_full() -> dict:
    """--full 모드: 전년 12월부터 시작"""
    last = get_last_complete_yymm()
    ranges = {}
    for year in [2025, 2026]:
        if int(last) < int(f"{year}01"):
            continue
        start = f"{year - 1}12"   # 전년 12월 포함 (기초재고용)
        end_cap = f"{year}12"
        ranges[str(year)] = (start, min(last, end_cap))
    return ranges


def get_incremental_range(output_dir: Path, year: int) -> tuple:
    """(max_month, fetch_start, fetch_end). fetch_start가 None이면 추가할 월 없음."""
    last = get_last_complete_yymm()
    start_yymm = f"{year}01"
    if int(last) < int(start_yymm):
        return (None, None, None)
    path = output_dir / f"stock_{year}.json"
    if not path.exists():
        return (None, start_yymm, last if int(last) <= int(f"{year}12") else f"{year}12")
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


def _apply_category_cols(df: pd.DataFrame) -> pd.DataFrame:
    """대분류/중분류 컬럼 추가. 상품마스터 미매칭 시 parent/prdt_kind_nm이 NaN → 기타로 처리"""
    df = df.copy()
    df["대분류"] = df["parent_prdt_kind_nm"].fillna("기타").replace("", "기타")
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
    """'month' 컬럼 기준 집계 → {int(month): int(value)}"""
    if grp.empty:
        return {}
    return {
        int(m): int(v)
        for m, v in grp.groupby("month")[val_col].sum().items()
    }


def _build_categories_with_base(acc_grp: pd.DataFrame, prev_dec_yymm: str) -> list:
    """
    대분류/중분류 계층 구조 생성 (base_stock 포함).
    acc_grp에는 전년 12월 데이터(기초재고용)와 당해 월 데이터가 섞여 있음.
    """
    categories = []

    for 대분류_nm, cat_grp in acc_grp.groupby("대분류", sort=False):
        대분류_nm = str(대분류_nm)

        # 전년 12월 분리 (기초재고)
        base_cat = cat_grp[cat_grp["yymm"] == prev_dec_yymm]
        # 당해 월 분리
        mon_cat = cat_grp[cat_grp["yymm"] != prev_dec_yymm].copy()
        mon_cat["month"] = mon_cat["yymm"].astype(str).str[-2:].astype(int)

        cat_base_stock = int(base_cat["ending_stock_amt"].sum()) if not base_cat.empty else 0
        cat_months = _months_dict(mon_cat, "ending_stock_amt")

        subcategories = []
        for 중분류_nm, sub_grp in cat_grp.groupby("중분류", sort=False):
            base_sub = sub_grp[sub_grp["yymm"] == prev_dec_yymm]
            mon_sub = sub_grp[sub_grp["yymm"] != prev_dec_yymm].copy()
            mon_sub["month"] = mon_sub["yymm"].astype(str).str[-2:].astype(int)

            sub_base_stock = int(base_sub["ending_stock_amt"].sum()) if not base_sub.empty else 0
            sub_months = _months_dict(mon_sub, "ending_stock_amt")

            subcategories.append({
                "중분류": str(중분류_nm),
                "base_stock": sub_base_stock,
                "months": sub_months,
            })

        if 대분류_nm == "의류":
            subcategories.sort(key=lambda x: sesn_sort_key(x["중분류"]))
        elif 대분류_nm == "ACC":
            acc_order_map = {v: i for i, v in enumerate(ACC_ORDER)}
            subcategories.sort(key=lambda x: acc_order_map.get(x["중분류"], 99))

        categories.append({
            "대분류": 대분류_nm,
            "base_stock": cat_base_stock,
            "months": cat_months,
            "subcategories": subcategories,
        })

    categories.sort(key=lambda x: CAT_ORDER.get(x["대분류"], 99))
    return categories


def _build_categories(acc_grp: pd.DataFrame) -> list:
    """
    증분 merge용 카테고리 구조 생성 (base_stock 없음).
    acc_grp에는 이미 'month' 컬럼이 추가된 상태.
    """
    categories = []
    for 대분류_nm, cat_grp in acc_grp.groupby("대분류", sort=False):
        대분류_nm = str(대분류_nm)
        cat_months = _months_dict(cat_grp, "ending_stock_amt")

        subcategories = []
        for 중분류_nm, sub_grp in cat_grp.groupby("중분류", sort=False):
            sub_months = _months_dict(sub_grp, "ending_stock_amt")
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
    """증분 merge: base_stock은 건드리지 않고 months만 병합"""
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


def merge_new_months(existing: dict, new_df: pd.DataFrame) -> dict:
    """기존 JSON에 새 월 데이터만 병합 (base_stock 유지)"""
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
            new_acc_months = _months_dict(acc_grp, "ending_stock_amt")
            new_cats = _build_categories(acc_grp)

            if acc is None:
                acc = {
                    "account_id": aid,
                    "account_nm_en": str(account_nm_en) if pd.notna(account_nm_en) else aid,
                    "base_stock": 0,
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


# 재고잔액 조회 (2025·2026 동일 로직)
# - LEFT JOIN DB_PRDT: 상품마스터 미매칭(part_cd 없음) 시에도 행 누락 없음
# - COALESCE로 NULL → '기타'/'Acc_etc' 처리하여 전체 재고 합계에 포함
QUERY = """
SELECT
    s.yymm,
    s.brd_cd,
    sm.account_id,
    am.account_nm_en,
    COALESCE(p.parent_prdt_kind_nm, '기타') AS parent_prdt_kind_nm,
    s.sesn,
    COALESCE(p.prdt_kind_nm, 'Acc_etc')     AS prdt_kind_nm,
    SUM(
        COALESCE(s.stock_tag_amt_expected, 0)
      + COALESCE(s.stock_tag_amt_frozen, 0)
      + COALESCE(s.stock_tag_amt_insp, 0)
    ) AS ending_stock_amt
FROM FNF.CHN.dw_stock_m s
JOIN FNF.CHN.MST_SHOP_ALL sm
  ON s.shop_id = sm.shop_id
 AND sm.fr_or_cls = 'FR'
LEFT JOIN FNF.CHN.mst_account am
  ON sm.account_id = am.account_id
LEFT JOIN FNF.PRCS.DB_PRDT p
  ON s.part_cd = p.part_cd
WHERE s.yymm BETWEEN '{start}' AND '{end}'
  AND s.brd_cd IN ('M', 'I', 'X')
GROUP BY s.yymm, s.brd_cd, sm.account_id, am.account_nm_en,
         p.parent_prdt_kind_nm, s.sesn, p.prdt_kind_nm
ORDER BY s.brd_cd, s.yymm, sm.account_id
"""


def fetch(conn, start: str, end: str) -> pd.DataFrame:
    df = pd.read_sql(QUERY.format(start=start, end=end), conn)
    df.columns = [c.lower() for c in df.columns]
    return df


def build_json(df: pd.DataFrame, year: str) -> dict:
    """
    df에는 전년 12월(기초재고용) + 당해 연도 월별 데이터가 섞여 있음.
    전년 12월을 분리하여 계정/카테고리별 base_stock 산출.
    """
    result = {"year": year, "brands": {}}
    df = df.copy()
    df["brand_nm"] = df["brd_cd"].map(BRAND_MAP)
    df = _apply_category_cols(df)
    prev_dec_yymm = f"{int(year) - 1}12"

    for brand_nm in BRAND_ORDER:
        brd_cd = BRAND_CD_MAP.get(brand_nm, "")
        brand_df = df[df["brand_nm"] == brand_nm]
        accounts = []

        for (account_id, account_nm_en), acc_grp in brand_df.groupby(
            ["account_id", "account_nm_en"], sort=False
        ):
            aid = str(account_id)

            # 전년 12월 (기초재고)
            base_grp = acc_grp[acc_grp["yymm"] == prev_dec_yymm]
            # 당해 연도 월별
            mon_grp = acc_grp[acc_grp["yymm"] != prev_dec_yymm].copy()
            mon_grp["month"] = mon_grp["yymm"].astype(str).str[-2:].astype(int)

            base_stock = int(base_grp["ending_stock_amt"].sum()) if not base_grp.empty else 0
            account_months = _months_dict(mon_grp, "ending_stock_amt")
            categories = _build_categories_with_base(acc_grp, prev_dec_yymm)

            accounts.append({
                "account_id": aid,
                "account_nm_en": str(account_nm_en) if pd.notna(account_nm_en) else aid,
                "base_stock": base_stock,
                "months": account_months,
                "categories": categories,
            })

        accounts.sort(key=lambda x: x["account_id"])
        result["brands"][brand_nm] = accounts
    return result


def process_year_full(conn, output_dir: Path, year: str, start: str, end: str):
    """start = f"{year-1}12" (전년 12월 포함)"""
    print(f"{year}년 전기간 조회 ({start} ~ {end}) [전년12월=기초재고 포함]")
    df = fetch(conn, start, end)
    print(f"  조회: {len(df)}건")
    data = (
        build_json(df, year)
        if not df.empty
        else {"year": year, "brands": {b: [] for b in BRAND_ORDER}}
    )
    with open(output_dir / f"stock_{year}.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print("  저장 완료")


def process_year_incremental(conn, output_dir: Path, year: int):
    path = output_dir / f"stock_{year}.json"
    if year == 2025 and path.exists():
        print(f"2025년: 이미 존재 → 스킵")
        return

    max_m, fetch_start, fetch_end = get_incremental_range(output_dir, year)
    if fetch_start is None:
        print(f"{year}년: 추가할 완료월 없음 → 스킵")
        return

    if path.exists():
        # 기존 파일 있음 → 증분만 (base_stock은 이미 JSON에 존재)
        with open(path, encoding="utf-8") as f:
            existing = json.load(f)
        print(f"{year}년: 기존 max월={max_m} → {fetch_start}~{fetch_end} 증분")
        df = fetch(conn, fetch_start, fetch_end)
        if df.empty:
            print("  조회 결과 없음")
            return
        print(f"  조회: {len(df)}건")
        data = merge_new_months(existing, df)
    else:
        # 신규 파일 → 전년 12월 포함하여 조회 (카테고리별 기초재고 산출)
        prev_dec = f"{year - 1}12"
        print(f"{year}년: 신규 생성 ({prev_dec}~{fetch_end}, 기초재고 포함)")
        df = fetch(conn, prev_dec, fetch_end)
        if df.empty:
            print("  조회 결과 없음")
            return
        print(f"  조회: {len(df)}건")
        data = build_json(df, str(year))

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print("  저장 완료")


def main():
    parser = argparse.ArgumentParser(description="FR 재고잔액 전처리")
    parser.add_argument(
        "--full", action="store_true",
        help="전년 12월부터 전기간 재조회 (카테고리별 기초재고 포함)"
    )
    args = parser.parse_args()

    output_dir = Path(__file__).parent.parent / "frontend" / "public" / "data"
    output_dir.mkdir(parents=True, exist_ok=True)

    print("Snowflake 연결 중...")
    conn = get_connection()
    print("연결 성공\n")

    if args.full:
        print("[--full] 전기간 재조회 (전년12월 기초재고 포함)\n")
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
    print("\n재고잔액 전처리 완료!")


if __name__ == "__main__":
    main()
