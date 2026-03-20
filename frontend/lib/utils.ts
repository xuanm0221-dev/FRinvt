/** 원단위(위안) 값을 천위안으로 변환하여 천단위 콤마 포맷으로 반환 */
export function fmtAmt(value: number | undefined | null): string {
  if (value == null || value === 0) return "";
  const inThousands = Math.round(value / 1000);
  if (inThousands === 0) return "";
  return inThousands.toLocaleString("ko-KR");
}

/** 월별 합계 계산 */
export function calcTotal(months: Record<number, number>): number {
  return Object.values(months).reduce((s, v) => s + (v || 0), 0);
}
