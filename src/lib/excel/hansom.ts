import {
  readWorkbook,
  getFirstSheet,
  readHeadersFromRow1,
  readRowsAsObjects,
} from "./read";
import { THansomResultMap } from "@/lib/types";

export const buildHansomMap = async (
  arrayBuffer: ArrayBuffer,
): Promise<THansomResultMap> => {
  const wb = await readWorkbook(arrayBuffer);
  const ws = getFirstSheet(wb);
  const headers = readHeadersFromRow1(ws);
  const rows = readRowsAsObjects(ws, headers);

  // 기타 양식의 고객주문번호를 우선 사용하고 기존 결과 양식도 지원합니다.
  const keyField = ["고객주문번호", "거래처주문번호", "상품주문번호"].find(
    (header) => headers.includes(header),
  );

  if (!keyField)
    throw new Error(
      "결과 엑셀에서 주문번호 컬럼을 찾지 못했어요. (고객주문번호/거래처주문번호/상품주문번호)",
    );

  if (!headers.includes("운송장번호"))
    throw new Error("결과 엑셀에서 운송장번호 컬럼을 찾지 못했어요.");

  const map: THansomResultMap = new Map();
  rows.forEach((r) => {
    const k = String(r[keyField] ?? "").trim();
    const t = String(r["운송장번호"] ?? "").trim();
    if (k) map.set(k, t);
  });

  return map;
};
